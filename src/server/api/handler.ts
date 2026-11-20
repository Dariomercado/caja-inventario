import type { NextResponse } from 'next/server'
import type { ScopeApi } from '../../../generated/prisma/enums'
import { autenticar } from './auth'
import { errorJson, respuestaDeErrorDeDominio } from './errores'
import { consumirCupo } from './limite'
import type { TokenResuelto } from './tokens'

/**
 * Envoltorio único de los endpoints: identifica, cobra cupo, ejecuta y traduce errores.
 *
 * Existe para que ningún handler pueda olvidarse de una de las cuatro. Un endpoint
 * nuevo que se acuerde de autenticar pero no de descontar cupo sería un agujero
 * silencioso, y ese es exactamente el tipo de defecto que no aparece en un test de
 * camino feliz.
 *
 * El orden es: autenticación (401), autorización (403), cupo (429), acción. Un pedido
 * que no llega a identificarse no consume cupo de nadie.
 *
 * El `try` cubre las cuatro etapas, no sólo la acción. Si la base falla mientras se
 * autentica o se descuenta cupo, el cliente tiene que recibir el mismo sobre
 * `{ error: { code: 'interno' } }` que ante cualquier otro error del servidor: el 500
 * por defecto de Next no es JSON parseable, y un cliente que ramifica por `code` se
 * queda sin nada justo durante el incidente.
 */
export async function ejecutarAutenticado(
  request: Request,
  scope: ScopeApi,
  accion: (token: TokenResuelto) => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    const autenticacion = await autenticar(request, scope)
    if (!autenticacion.ok) return autenticacion.respuesta

    const cupo = await consumirCupo(autenticacion.token.id, autenticacion.token.limitePorMinuto)
    if (!cupo.permitido) {
      return errorJson('rate_limit_excedido', 'Demasiados pedidos con este token.', {
        headers: { 'Retry-After': String(cupo.reintentarEnSegundos) },
      })
    }

    return await accion(autenticacion.token)
  } catch (error) {
    return respuestaDeErrorDeDominio(error)
  }
}
