import type { EntradaNuevaVenta } from '@/server/api/esquemas'
import type { ProductoResumen } from '@/server/productos'
import type { CajaDelDia, ResumenDia, TopProducto } from '@/server/reportes'
import type { VentaDetalle, VentaResumen } from '@/server/ventasConsulta'

/**
 * Cliente de `/api/v1` (S4).
 *
 * El asistente no lee la base ni reusa los servicios del panel: entra por el mismo
 * contrato HTTP que cualquier otro consumidor, con un token de scopes acotados. Es
 * lo que hace que el contrato se pruebe de verdad: si `/api/v1` cambia, el
 * asistente se rompe igual que un cliente externo.
 *
 * El transporte es inyectable para que las evals offline puedan hablarle a los
 * route handlers en proceso, sin red y sin servidor levantado, sin dejar de pasar
 * por el armado de la petición ni por el parseo de la respuesta.
 */

export type Transporte = (peticion: Request) => Promise<Response>

export const RUTA_API = '/api/v1'

export class ErrorDeApi extends Error {
  readonly estado: number
  readonly codigo: string

  constructor(estado: number, codigo: string, mensaje: string) {
    super(mensaje)
    this.name = 'ErrorDeApi'
    this.estado = estado
    this.codigo = codigo
  }
}

export class ErrorDeRed extends Error {
  constructor(mensaje: string, readonly causa?: unknown) {
    super(mensaje)
    this.name = 'ErrorDeRed'
  }
}

export type PaginaProductos = {
  productos: ProductoResumen[]
  siguienteCursor: string | null
}

export type PaginaVentas = {
  ventas: VentaResumen[]
  siguienteCursor: number | null
}

export type VentaCreada = {
  id: string
  numero: number
  totalCentavos: number
  /** `false` cuando la clave de idempotencia ya había registrado esta venta (200). */
  creada: boolean
}

export type ClienteApi = {
  listarProductos(consulta?: { limite?: number; cursor?: string; soloActivos?: boolean }): Promise<PaginaProductos>
  verProducto(id: string): Promise<ProductoResumen>
  listarVentas(consulta?: { limite?: number; cursor?: number }): Promise<PaginaVentas>
  verVenta(id: string): Promise<VentaDetalle>
  registrarVenta(entrada: EntradaNuevaVenta, claveIdempotencia: string): Promise<VentaCreada>
  cajaDelDia(fecha: string): Promise<CajaDelDia>
  ventasPorDia(consulta: { desde: string; hasta: string }): Promise<{ dias: ResumenDia[] }>
  topProductos(consulta: { desde: string; hasta: string; limite?: number }): Promise<{ productos: TopProducto[] }>
}

export function crearClienteApi(opciones: {
  baseUrl: string
  token: string
  transporte?: Transporte
}): ClienteApi {
  const { baseUrl, token } = opciones
  const transporte: Transporte = opciones.transporte ?? ((peticion) => fetch(peticion))

  const url = (ruta: string, consulta?: Record<string, string | number | boolean | undefined>) => {
    const destino = new URL(`${baseUrl.replace(/\/+$/, '')}${RUTA_API}${ruta}`)
    for (const [clave, valor] of Object.entries(consulta ?? {})) {
      if (valor !== undefined) destino.searchParams.set(clave, String(valor))
    }
    return destino
  }

  async function pedir<T>(
    metodo: string,
    ruta: string,
    opcionesPedido: {
      consulta?: Record<string, string | number | boolean | undefined>
      cuerpo?: unknown
      claveIdempotencia?: string
    } = {},
  ): Promise<{ cuerpo: T; estado: number }> {
    const encabezados: Record<string, string> = {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
    }
    if (opcionesPedido.cuerpo !== undefined) encabezados['content-type'] = 'application/json'
    // La clave viaja en el header y no en el cuerpo: es una propiedad del pedido, no
    // del recurso que se quiere crear (misma razón que en el Route Handler).
    if (opcionesPedido.claveIdempotencia) {
      encabezados['idempotency-key'] = opcionesPedido.claveIdempotencia
    }

    const peticion = new Request(url(ruta, opcionesPedido.consulta), {
      method: metodo,
      headers: encabezados,
      ...(opcionesPedido.cuerpo === undefined
        ? {}
        : { body: JSON.stringify(opcionesPedido.cuerpo) }),
    })

    let respuesta: Response
    try {
      respuesta = await transporte(peticion)
    } catch (causa) {
      throw new ErrorDeRed(
        `No se pudo hablar con la API (${metodo} ${ruta}): ${causa instanceof Error ? causa.message : 'error de red'}`,
        causa,
      )
    }

    if (!respuesta.ok) throw await errorDeRespuesta(respuesta, metodo, ruta)

    return { cuerpo: (await respuesta.json()) as T, estado: respuesta.status }
  }

  return {
    async listarProductos(consulta = {}) {
      const { cuerpo } = await pedir<PaginaProductos>('GET', '/productos', {
        consulta: {
          limite: consulta.limite,
          cursor: consulta.cursor,
          soloActivos: consulta.soloActivos,
        },
      })
      return cuerpo
    },

    async verProducto(id) {
      const { cuerpo } = await pedir<ProductoResumen>('GET', `/productos/${encodeURIComponent(id)}`)
      return cuerpo
    },

    async listarVentas(consulta = {}) {
      const { cuerpo } = await pedir<PaginaVentas>('GET', '/ventas', {
        consulta: { limite: consulta.limite, cursor: consulta.cursor },
      })
      return cuerpo
    },

    async verVenta(id) {
      const { cuerpo } = await pedir<VentaDetalle>('GET', `/ventas/${encodeURIComponent(id)}`)
      return cuerpo
    },

    async registrarVenta(entrada, claveIdempotencia) {
      const { cuerpo, estado } = await pedir<{ id: string; numero: number; totalCentavos: number }>(
        'POST',
        '/ventas',
        { cuerpo: entrada, claveIdempotencia },
      )
      // 201 = la creó esta llamada; 200 = devolvió la que ya existía con esa clave.
      return { ...cuerpo, creada: estado === 201 }
    },

    async cajaDelDia(fecha) {
      const { cuerpo } = await pedir<CajaDelDia>('GET', '/reportes/caja', { consulta: { fecha } })
      return cuerpo
    },

    async ventasPorDia(consulta) {
      const { cuerpo } = await pedir<{ dias: ResumenDia[] }>('GET', '/reportes/ventas-por-dia', {
        consulta: { desde: consulta.desde, hasta: consulta.hasta },
      })
      return cuerpo
    },

    async topProductos(consulta) {
      const { cuerpo } = await pedir<{ productos: TopProducto[] }>('GET', '/reportes/top-productos', {
        consulta: { desde: consulta.desde, hasta: consulta.hasta, limite: consulta.limite },
      })
      return cuerpo
    },
  }
}

/**
 * Traduce una respuesta de error al mismo sobre que devuelve la API.
 *
 * El `code` es lo que el loop le muestra al modelo: un `409 stock_insuficiente`
 * tiene que llegar tal cual, con su mensaje y su número disponible, para que la
 * respuesta al usuario sea informar y no inventar otro valor (S7).
 */
async function errorDeRespuesta(respuesta: Response, metodo: string, ruta: string): Promise<ErrorDeApi> {
  let codigo = 'interno'
  let mensaje = `${metodo} ${ruta} devolvió ${respuesta.status}`

  try {
    const cuerpo: unknown = await respuesta.json()
    if (esSobreDeError(cuerpo)) {
      codigo = cuerpo.error.code
      mensaje = cuerpo.error.message
    }
  } catch {
    // Un error sin cuerpo JSON no cambia el diagnóstico: queda el mensaje armado.
  }

  return new ErrorDeApi(respuesta.status, codigo, mensaje)
}

function esSobreDeError(cuerpo: unknown): cuerpo is { error: { code: string; message: string } } {
  if (typeof cuerpo !== 'object' || cuerpo === null) return false
  const error = (cuerpo as { error?: unknown }).error
  if (typeof error !== 'object' || error === null) return false
  const { code, message } = error as { code?: unknown; message?: unknown }
  return typeof code === 'string' && typeof message === 'string'
}
