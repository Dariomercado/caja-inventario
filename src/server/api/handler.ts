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
 */
export async function ejecutarAutenticado(
  request: Request,
  scope: ScopeApi,
  accion: (token: TokenResuelto) => Promise<NextResponse>,
): Promise<NextResponse> {
  const autenticacion = await autenticar(request, scope)
  if (!autenticacion.ok) return autenticacion.respuesta

  const cupo = await consumirCupo(autenticacion.token.id, autenticacion.token.limitePorMinuto)
  if (!cupo.permitido) {
    return errorJson('rate_limit_excedido', 'Demasiados pedidos con este token.', {
      headers: { 'Retry-After': String(cupo.reintentarEnSegundos) },
    })
  }

  try {
    return await accion(autenticacion.token)
  } catch (error) {
    return respuestaDeErrorDeDominio(error)
  }
}
