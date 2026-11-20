import { z } from 'zod'
import { MEDIOS_DE_PAGO } from '@/server/api/esquemas'
import { ErrorDeApi, ErrorDeRed, type ClienteApi } from './api'

/**
 * Herramientas del asistente: la superficie concreta de `/api/v1` (S4).
 *
 * Tres decisiones estructurales, no de prompt:
 *
 * 1. `registrar_venta` no tiene ningún campo de dinero. El modelo no puede mandar un
 *    precio ni un total porque el esquema no lo acepta: el servidor calcula con el
 *    precio real de la base (S3). Pedirlo por instrucción sería confiar en que
 *    obedezca.
 * 2. La `Idempotency-Key` no es un argumento de la herramienta. La maneja el loop
 *    por intento, así el modelo no puede "arreglar" un conflicto inventando otra
 *    clave (S5, S7).
 * 3. No hay herramientas de escritura de catálogo: el token del asistente no tiene
 *    `productos:write` (S4).
 */

export type DefinicionHerramienta = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export type ResultadoHerramienta =
  | { ok: true; datos: unknown; ventaRegistrada?: boolean }
  | { ok: false; error: { code: string; message: string } }

export type ContextoHerramienta = { claveIdempotencia: string }

export type OpcionesHerramientas = { maxProductos: number }

export type JuegoDeHerramientas = {
  definiciones: DefinicionHerramienta[]
  ejecutar(
    nombre: string,
    argumentos: unknown,
    contexto: ContextoHerramienta,
  ): Promise<ResultadoHerramienta>
}

const fechaISO = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'formato YYYY-MM-DD')
  .describe('Fecha de calendario en formato YYYY-MM-DD.')

const esquemaListarProductos = z.object({
  limite: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Cuántos productos traer. Si se omite, el tope configurado.'),
  cursor: z
    .string()
    .min(1)
    .optional()
    .describe('Cursor que trajo la respuesta anterior. Omitilo para empezar de nuevo.'),
  solo_activos: z
    .boolean()
    .optional()
    .describe('Si es true, omite los productos desactivados.'),
})

const esquemaVerProducto = z.object({
  producto_id: z
    .string()
    .min(1)
    .describe('El campo `id` del producto. No es el `sku`: la API rechaza el SKU.'),
})

const esquemaRegistrarVenta = z.object({
  items: z
    .array(
      z.object({
        producto_id: z
          .string()
          .min(1)
          .describe('El campo `id` del producto, no el `sku`. Sale de listar_productos.'),
        cantidad: z.number().int().positive().describe('Cantidad de unidades.'),
      }),
    )
    .min(1)
    .describe('Un renglón por producto. Sin precios ni subtotales: los calcula el servidor.'),
  medio_pago: z
    .enum(MEDIOS_DE_PAGO)
    .describe(
      'Medio de pago del total. El monto lo calcula el servidor con el precio real: no se manda.',
    ),
})

const esquemaVerVenta = z.object({
  venta_id: z.string().min(1).describe('id de la venta.'),
})

const esquemaListarVentas = z.object({
  limite: z.number().int().min(1).optional().describe('Cuántas ventas traer.'),
  cursor: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Número de la última venta recibida, para pedir la página siguiente.'),
})

const esquemaCajaDelDia = z.object({
  fecha: fechaISO.describe('Día de la caja, en formato YYYY-MM-DD.'),
})

const esquemaRango = z.object({
  desde: fechaISO,
  hasta: fechaISO,
})

const esquemaTopProductos = z.object({
  desde: fechaISO,
  hasta: fechaISO,
  limite: z.number().int().min(1).optional().describe('Cuántos productos devolver.'),
})

class ArgumentosInvalidosError extends Error {
  constructor(readonly detalle: string) {
    super(detalle)
    this.name = 'ArgumentosInvalidosError'
  }
}

function parsear<T>(esquema: z.ZodType<T>, argumentos: unknown): T {
  const datos = esquema.safeParse(argumentos)
  if (!datos.success) {
    const detalle = datos.error.issues
      .map((problema) => `${problema.path.join('.') || 'argumentos'}: ${problema.message}`)
      .join('; ')
    throw new ArgumentosInvalidosError(detalle)
  }
  return datos.data
}

/**
 * El JSON Schema de cada herramienta se genera desde el mismo Zod que valida los
 * argumentos. Es la misma razón por la que el documento OpenAPI sale de los
 * esquemas: un contrato escrito dos veces se desactualiza en la mitad que nadie
 * mira.
 */
function parametrosDe(esquema: z.ZodType): Record<string, unknown> {
  const json = {
    ...z.toJSONSchema(esquema, { io: 'input', unrepresentable: 'any' }),
  } as Record<string, unknown>
  delete json.$schema
  return json
}

type Herramienta = {
  nombre: string
  descripcion: string
  esquema: z.ZodType
  correr(
    argumentos: unknown,
    cliente: ClienteApi,
    contexto: ContextoHerramienta,
    opciones: OpcionesHerramientas,
  ): Promise<ResultadoHerramienta>
}

const HERRAMIENTAS: Herramienta[] = [
  {
    nombre: 'listar_productos',
    descripcion:
      'Lista el catálogo con stock y precio. Usala para encontrar el producto antes de vender o para responder qué hay.',
    esquema: esquemaListarProductos,
    async correr(argumentos, cliente, _contexto, opciones) {
      const datos = parsear(esquemaListarProductos, argumentos)
      // El tope de contexto lo impone el diseño, no el proveedor (S11): se pide como
      // máximo lo configurado y se recorta igual por si la API devolviera más.
      const limite = Math.min(datos.limite ?? opciones.maxProductos, opciones.maxProductos)
      const pagina = await cliente.listarProductos({
        limite,
        cursor: datos.cursor,
        soloActivos: datos.solo_activos,
      })
      const productos = pagina.productos.slice(0, opciones.maxProductos)
      return {
        ok: true,
        datos: {
          productos,
          siguienteCursor: pagina.siguienteCursor,
          truncados: pagina.productos.length - productos.length,
        },
      }
    },
  },

  {
    nombre: 'ver_producto',
    descripcion: 'Devuelve un producto por id, con su stock y su precio actuales.',
    esquema: esquemaVerProducto,
    async correr(argumentos, cliente) {
      const datos = parsear(esquemaVerProducto, argumentos)
      return { ok: true, datos: await cliente.verProducto(datos.producto_id) }
    },
  },

  {
    nombre: 'registrar_venta',
    descripcion:
      'Registra una venta cobrada. El servidor calcula el total con el precio real: no mandes montos. El reintento seguro ya está resuelto, no hace falta repetirla.',
    esquema: esquemaRegistrarVenta,
    async correr(argumentos, cliente, contexto) {
      const datos = parsear(esquemaRegistrarVenta, argumentos)
      const venta = await cliente.registrarVenta(
        {
          items: datos.items.map((item) => ({
            productoId: item.producto_id,
            cantidad: item.cantidad,
          })),
          medioPago: datos.medio_pago,
        },
        contexto.claveIdempotencia,
      )
      return {
        ok: true,
        datos: venta,
        // El loop renueva la clave recién acá: mientras el intento esté vivo, un
        // "dale" del usuario vuelve con la misma clave y no duplica la venta (S5).
        ventaRegistrada: venta.creada,
      }
    },
  },

  {
    nombre: 'ver_venta',
    descripcion: 'Devuelve una venta con sus renglones y sus pagos.',
    esquema: esquemaVerVenta,
    async correr(argumentos, cliente) {
      const datos = parsear(esquemaVerVenta, argumentos)
      return { ok: true, datos: await cliente.verVenta(datos.venta_id) }
    },
  },

  {
    nombre: 'listar_ventas',
    descripcion:
      'Lista las ventas de la más nueva a la más vieja. Sirve para responder "qué se vendió hoy".',
    esquema: esquemaListarVentas,
    async correr(argumentos, cliente) {
      const datos = parsear(esquemaListarVentas, argumentos)
      return {
        ok: true,
        datos: await cliente.listarVentas({ limite: datos.limite, cursor: datos.cursor }),
      }
    },
  },

  {
    nombre: 'caja_del_dia',
    descripcion: 'Totales de caja de un día, agrupados por medio de pago.',
    esquema: esquemaCajaDelDia,
    async correr(argumentos, cliente) {
      const datos = parsear(esquemaCajaDelDia, argumentos)
      return { ok: true, datos: await cliente.cajaDelDia(datos.fecha) }
    },
  },

  {
    nombre: 'ventas_por_dia',
    descripcion: 'Total y cantidad de ventas por día en un rango de fechas.',
    esquema: esquemaRango,
    async correr(argumentos, cliente) {
      const datos = parsear(esquemaRango, argumentos)
      return {
        ok: true,
        datos: await cliente.ventasPorDia({ desde: datos.desde, hasta: datos.hasta }),
      }
    },
  },

  {
    nombre: 'top_productos',
    descripcion: 'Productos más vendidos en un rango de fechas, por cantidad.',
    esquema: esquemaTopProductos,
    async correr(argumentos, cliente) {
      const datos = parsear(esquemaTopProductos, argumentos)
      return {
        ok: true,
        datos: await cliente.topProductos({
          desde: datos.desde,
          hasta: datos.hasta,
          limite: datos.limite,
        }),
      }
    },
  },
]

export function crearHerramientas(cliente: ClienteApi, opciones: OpcionesHerramientas): JuegoDeHerramientas {
  const porNombre = new Map(HERRAMIENTAS.map((herramienta) => [herramienta.nombre, herramienta]))

  return {
    definiciones: HERRAMIENTAS.map((herramienta) => ({
      type: 'function',
      function: {
        name: herramienta.nombre,
        description: herramienta.descripcion,
        parameters: parametrosDe(herramienta.esquema),
      },
    })),

    async ejecutar(nombre, argumentos, contexto) {
      const herramienta = porNombre.get(nombre)
      if (!herramienta) {
        // Un modelo que inventa una herramienta recibe un error explícito y sigue;
        // el pedido no se cae por eso.
        return {
          ok: false,
          error: {
            code: 'herramienta_desconocida',
            message: `No existe la herramienta "${nombre}". Disponibles: ${[...porNombre.keys()].join(', ')}.`,
          },
        }
      }

      try {
        return await herramienta.correr(argumentos, cliente, contexto, opciones)
      } catch (causa) {
        if (causa instanceof ArgumentosInvalidosError) {
          return { ok: false, error: { code: 'argumentos_invalidos', message: causa.detalle } }
        }
        if (causa instanceof ErrorDeApi) {
          // Se informa el código de la API tal cual y no se reintenta: reintentar con
          // otros valores inventados es lo que S7 prohíbe.
          return { ok: false, error: { code: causa.codigo, message: causa.message } }
        }
        if (causa instanceof ErrorDeRed) {
          return { ok: false, error: { code: 'sin_respuesta', message: causa.message } }
        }
        throw causa
      }
    },
  }
}
