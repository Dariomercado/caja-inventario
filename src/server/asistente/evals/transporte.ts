import { NextRequest } from 'next/server'
import { GET as obtenerProductos } from '@/app/api/v1/productos/route'
import { GET as obtenerProducto } from '@/app/api/v1/productos/[id]/route'
import { GET as listarVentas, POST as registrarVenta } from '@/app/api/v1/ventas/route'
import { GET as obtenerVenta } from '@/app/api/v1/ventas/[id]/route'
import { GET as cajaDelDia } from '@/app/api/v1/reportes/caja/route'
import { GET as ventasPorDia } from '@/app/api/v1/reportes/ventas-por-dia/route'
import { GET as topProductos } from '@/app/api/v1/reportes/top-productos/route'
import type { Transporte } from '../api'
import type { RespuestaGrabada } from './caso'

/**
 * Offline transports: no server, no network, no cost (S8).
 *
 * Two pieces make the offline tier possible without giving up the real code path:
 *
 * 1. The API transport calls the route handlers in process. The assistant still
 *    builds a `Request` with its token and headers and still receives a `Response`,
 *    so authentication, scopes, rate limiting, Zod validation, idempotency and the
 *    error envelope are exercised for real. A contract change breaks the eval the
 *    same way it would break a production client.
 * 2. The model transport replays a hand-authored fixture body. The loop is
 *    byte-identical to production: `crearClienteModelo` parses the same shape and
 *    `ejecutarTurno` runs the same tool calls.
 *
 * The origin is arbitrary: `crearClienteApi` uses it only to build the URL, and the
 * transport dispatches on the pathname.
 */

export type PeticionObservada = { method: string; pathname: string }
export type ObservadorDePeticiones = (peticion: PeticionObservada) => void

type Despacho = (peticion: NextRequest) => Promise<Response>

/** Routes the assistant can actually reach with its four scopes (T4). */
function despachar(pathname: string, method: string): Despacho | null {
  if (pathname === '/api/v1/productos' && method === 'GET') {
    return (peticion) => obtenerProductos(peticion)
  }

  if (pathname === '/api/v1/ventas') {
    if (method === 'GET') return (peticion) => listarVentas(peticion)
    if (method === 'POST') return (peticion) => registrarVenta(peticion)
  }

  if (pathname === '/api/v1/reportes/caja' && method === 'GET') {
    return (peticion) => cajaDelDia(peticion)
  }

  if (pathname === '/api/v1/reportes/ventas-por-dia' && method === 'GET') {
    return (peticion) => ventasPorDia(peticion)
  }

  if (pathname === '/api/v1/reportes/top-productos' && method === 'GET') {
    return (peticion) => topProductos(peticion)
  }

  const producto = /^\/api\/v1\/productos\/([^/]+)$/.exec(pathname)
  if (producto && method === 'GET') {
    const id = decodeURIComponent(producto[1])
    return (peticion) => obtenerProducto(peticion, { params: Promise.resolve({ id }) })
  }

  const venta = /^\/api\/v1\/ventas\/([^/]+)$/.exec(pathname)
  if (venta && method === 'GET') {
    const id = decodeURIComponent(venta[1])
    return (peticion) => obtenerVenta(peticion, { params: Promise.resolve({ id }) })
  }

  return null
}

/**
 * A transport for `crearClienteApi` that dispatches to the real route handlers.
 *
 * The observer exists so a case can assert how many times a write was attempted
 * without patching anything: `postVentas: 1` is the S7 evidence that a 409 was not
 * retried with invented values.
 */
export function transporteEnProceso(observar?: ObservadorDePeticiones): Transporte {
  return async (peticion) => {
    const url = new URL(peticion.url)
    observar?.({ method: peticion.method, pathname: url.pathname })

    const despacho = despachar(url.pathname, peticion.method)
    if (!despacho) {
      // A route outside the assistant's surface is not silently swallowed: the case
      // that asked for it has to fail with the same envelope the API would return.
      return new Response(
        JSON.stringify({
          error: {
            code: 'no_encontrado',
            message: `La eval pidió ${peticion.method} ${url.pathname}, que no está en la superficie del asistente.`,
          },
        }),
        { status: 404, headers: { 'content-type': 'application/json' } },
      )
    }

    const tieneCuerpo = peticion.method !== 'GET' && peticion.method !== 'HEAD'
    const cuerpo = tieneCuerpo ? await peticion.arrayBuffer() : undefined

    const interna = new NextRequest(url, {
      method: peticion.method,
      headers: new Headers(peticion.headers),
      ...(cuerpo === undefined ? {} : { body: cuerpo }),
    })

    return despacho(interna)
  }
}

export type ReproductorDeFixture = {
  transporte: Transporte
  /** Responses the loop never asked for. A non-zero value means the fixture is stale. */
  restantes: () => number
}

/**
 * A model transport that pops recorded bodies in order.
 *
 * It fails when the loop asks for more turns than the fixture has: returning an
 * empty body there would turn a missing recording into a silent empty answer.
 */
export function reproductorDeFixture(respuestas: RespuestaGrabada[]): ReproductorDeFixture {
  let indice = 0

  return {
    transporte: async () => {
      const cuerpo = respuestas[indice]
      if (!cuerpo) {
        throw new Error(
          `El fixture se quedó sin respuestas después de ${indice}: el loop pidió otra vuelta al modelo.`,
        )
      }
      indice += 1

      return new Response(JSON.stringify(cuerpo), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
    restantes: () => respuestas.length - indice,
  }
}
