import type { NextResponse } from 'next/server'
import type { ScopeApi } from '../../../generated/prisma/enums'
import { errorJson } from './errores'
import { resolverToken, tieneScope, type TokenResuelto } from './tokens'

/**
 * Puerta de entrada de la API.
 *
 * A diferencia del panel, este camino no usa `requerirUsuario()`: esa función lee la
 * cookie con `next/headers` y redirige a /login, que es exactamente lo que no
 * queremos en una API. Devuelve 401, no un redirect, y no toca la sesión del panel.
 */
export type AutenticacionOk = { ok: true; token: TokenResuelto }
export type AutenticacionFallida = { ok: false; respuesta: NextResponse }
export type Autenticacion = AutenticacionOk | AutenticacionFallida

/**
 * Resuelve el token del pedido y comprueba que alcance para el scope pedido.
 *
 * El orden importa: primero se identifica y después se autoriza. Un token inválido
 * recibe 401 sin importar qué scope pedía, así que la respuesta no revela qué
 * scopes existen ni cuáles le faltan a una credencial que no es válida.
 */
export async function autenticar(request: Request, scope: ScopeApi): Promise<Autenticacion> {
  const token = await resolverToken(request.headers.get('authorization'))

  if (token === null) {
    return {
      ok: false,
      respuesta: errorJson('no_autenticado', 'Falta el token o no es válido.', {
        headers: { 'WWW-Authenticate': 'Bearer' },
      }),
    }
  }

  if (!tieneScope(token, scope)) {
    return {
      ok: false,
      respuesta: errorJson('scope_insuficiente', 'El token no tiene el scope necesario para esta operación.'),
    }
  }

  return { ok: true, token }
}
