import { NextResponse } from 'next/server'
import {
  ClaveIdempotenciaReutilizadaError,
  PagoInconsistenteError,
  StockInsuficienteError,
} from '@/server/ventas'

/**
 * Forma única de todos los errores de la API.
 *
 * `code` es lo que un consumidor programa; `message` es lo que un humano lee.
 * El código no cambia nunca aunque cambie el mensaje, así que un cliente puede
 * ramificar sobre él sin parsear prosa.
 *
 * Nada de lo que sale de acá puede contener un stack, un mensaje de Prisma o un
 * nombre de tabla: los detalles van al log del servidor, no a la respuesta.
 */
export type CodigoError =
  | 'no_autenticado'
  | 'scope_insuficiente'
  | 'cuerpo_invalido'
  | 'no_encontrado'
  | 'stock_insuficiente'
  | 'pago_inconsistente'
  | 'clave_reutilizada'
  | 'rate_limit_excedido'
  | 'interno'

const STATUS: Record<CodigoError, number> = {
  no_autenticado: 401,
  scope_insuficiente: 403,
  cuerpo_invalido: 400,
  no_encontrado: 404,
  stock_insuficiente: 409,
  pago_inconsistente: 409,
  clave_reutilizada: 409,
  rate_limit_excedido: 429,
  interno: 500,
}

export function errorJson(
  code: CodigoError,
  message: string,
  opciones: { headers?: Record<string, string> } = {},
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status: STATUS[code], headers: opciones.headers })
}

/**
 * Traduce los errores de dominio a la respuesta HTTP que les corresponde.
 *
 * Sólo se reconocen los errores que el dominio declara como tales. Cualquier otra
 * excepción es un defecto del servidor y sale como 500 genérico: adivinar un status
 * a partir de un mensaje de texto es cómo una API termina devolviendo 400 cuando el
 * problema era la base.
 *
 * `StockInsuficienteError` lleva el disponible, que es información que el dueño del
 * token ya puede ver por `GET /productos`: no revela nada nuevo y evita un viaje.
 */
export function respuestaDeErrorDeDominio(error: unknown): NextResponse {
  if (error instanceof StockInsuficienteError) {
    return errorJson(
      'stock_insuficiente',
      `Sin stock suficiente: quedan ${error.disponible} y se pidieron ${error.pedido}.`,
    )
  }

  if (error instanceof PagoInconsistenteError) {
    return errorJson('pago_inconsistente', 'El pago no coincide con el total de la venta.')
  }

  if (error instanceof ClaveIdempotenciaReutilizadaError) {
    return errorJson(
      'clave_reutilizada',
      'La clave de idempotencia ya se usó con otros datos. Usá una clave nueva para una venta nueva.',
    )
  }

  console.error('Error no contemplado en la API', error)
  return errorJson('interno', 'Error interno.')
}
