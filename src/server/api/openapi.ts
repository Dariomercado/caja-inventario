import { z } from 'zod'
import {
  esquemaAjusteStock,
  esquemaAjusteStockRespuesta,
  esquemaCajaDelDia,
  esquemaCajaQuery,
  esquemaEditarProducto,
  esquemaError,
  esquemaListado,
  esquemaListadoVentas,
  esquemaNuevaVenta,
  esquemaNuevoProducto,
  esquemaPaginaProductos,
  esquemaPaginaVentas,
  esquemaProducto,
  esquemaRango,
  esquemaResumenDia,
  esquemaTopProducto,
  esquemaTopProductosQuery,
  esquemaVentaDetalle,
} from './esquemas'

/**
 * Documento OpenAPI de la API, generado desde los mismos esquemas Zod que validan
 * los pedidos.
 *
 * No hay un `openapi.yaml` escrito a mano en el repo a propósito: un contrato
 * duplicado se desactualiza en la mitad que nadie lee, y la mitad que nadie lee es
 * siempre la documentación. Acá, si un esquema cambia, el documento cambia.
 *
 * Se emite OpenAPI 3.1 porque sus `schemas` son JSON Schema 2020-12, que es
 * exactamente lo que produce `z.toJSONSchema` con `target: 'openapi-3.1'`. Con 3.0
 * habría que convertir a mano `nullable` y las composiciones, y ese es el tipo de
 * traducción que introduce mentiras silenciosas.
 */

type Metodo = 'get' | 'post' | 'patch'

type RespuestaDocumentada = {
  description: string
  schema?: z.ZodType
}

type OperacionDocumentada = {
  method: Metodo
  path: string
  summary: string
  scope: string
  parameters?: z.ZodType
  body?: z.ZodType
  respuesta: RespuestaDocumentada
  /** Códigos de error que el endpoint puede devolver además del 500 genérico. */
  errores?: number[]
}

/**
 * JSON Schema de un esquema Zod, con el lado que corresponde.
 *
 * `io: 'input'` para lo que el cliente manda (parámetros y cuerpos) y `'output'` para
 * lo que recibe: un `.transform()` no se puede representar en JSON Schema, y el
 * documento tiene que describir la forma que viaja por el cable, no la que existe
 * adentro del servidor después de transformar. `unrepresentable: 'any'` es la red de
 * seguridad: un detalle no representable degrada ese campo, no rompe el documento
 * entero.
 */
function jsonSchema(schema: z.ZodType, io: 'input' | 'output' = 'input') {
  return z.toJSONSchema(schema, { target: 'openapi-3.1', io, unrepresentable: 'any' })
}

function cuerpo(schema: z.ZodType) {
  return {
    required: true,
    content: {
      'application/json': { schema: jsonSchema(schema, 'input') },
    },
  }
}

function respuestas(operacion: OperacionDocumentada) {
  const json = (registro: RespuestaDocumentada) => ({
    description: registro.description,
    ...(registro.schema
      ? {
          content: {
            'application/json': {
              schema: jsonSchema(registro.schema, 'output'),
            },
          },
        }
      : {}),
  })

  const codigos = [200, ...(operacion.errores ?? [])]
  const salida: Record<string, unknown> = {
    [codigos[0]!]: json(operacion.respuesta),
  }

  if (operacion.errores?.includes(400)) {
    salida[400] = { description: 'Entrada inválida.', ...cuerpoError() }
  }
  if (operacion.errores?.includes(401)) {
    salida[401] = { description: 'Falta el token o no es válido.', ...cuerpoError() }
  }
  if (operacion.errores?.includes(403)) {
    salida[403] = { description: 'El token no tiene el scope necesario.', ...cuerpoError() }
  }
  if (operacion.errores?.includes(404)) {
    salida[404] = { description: 'El recurso no existe.', ...cuerpoError() }
  }
  if (operacion.errores?.includes(409)) {
    salida[409] = {
      description: 'Conflicto de estado: stock insuficiente, SKU repetido o clave reutilizada.',
      ...cuerpoError(),
    }
  }
  if (operacion.errores?.includes(429)) {
    salida[429] = {
      description: 'Se excedió el cupo del token. Mirar el header Retry-After.',
      ...cuerpoError(),
    }
  }
  salida[500] = { description: 'Error interno, sin detalle.', ...cuerpoError() }

  return salida
}

function cuerpoError() {
  return {
    content: {
      'application/json': {
        schema: jsonSchema(esquemaError, 'output'),
      },
    },
  }
}

const OPERACIONES: OperacionDocumentada[] = [
  {
    method: 'get',
    path: '/productos',
    summary: 'Lista el catálogo con paginación por cursor.',
    scope: 'productos:read',
    parameters: esquemaListado,
    respuesta: { description: 'Página de productos.', schema: esquemaPaginaProductos },
    errores: [400, 401, 403, 429],
  },
  {
    method: 'post',
    path: '/productos',
    summary: 'Crea un producto.',
    scope: 'productos:write',
    body: esquemaNuevoProducto,
    respuesta: { description: 'Producto creado.', schema: esquemaProducto },
    errores: [400, 401, 403, 409, 429],
  },
  {
    method: 'get',
    path: '/productos/{id}',
    summary: 'Devuelve un producto por id.',
    scope: 'productos:read',
    parameters: z.object({ id: z.string() }),
    respuesta: { description: 'El producto.', schema: esquemaProducto },
    errores: [401, 403, 404, 429],
  },
  {
    method: 'patch',
    path: '/productos/{id}',
    summary: 'Modifica nombre, precio o estado activo de un producto.',
    scope: 'productos:write',
    parameters: z.object({ id: z.string() }),
    body: esquemaEditarProducto,
    respuesta: { description: 'Producto actualizado.', schema: esquemaProducto },
    errores: [400, 401, 403, 404, 429],
  },
  {
    method: 'post',
    path: '/productos/{id}/ajustes',
    summary:
      'Mueve el stock. ENTRADA suma, SALIDA resta sin permitir negativos, AJUSTE fija el valor absoluto.',
    scope: 'productos:write',
    parameters: z.object({ id: z.string() }),
    body: esquemaAjusteStock,
    respuesta: { description: 'Stock antes y después.', schema: esquemaAjusteStockRespuesta },
    errores: [400, 401, 403, 404, 409, 429],
  },
  {
    method: 'get',
    path: '/ventas',
    summary: 'Lista las ventas de la más nueva a la más vieja.',
    scope: 'ventas:read',
    parameters: esquemaListadoVentas,
    respuesta: { description: 'Página de ventas.', schema: esquemaPaginaVentas },
    errores: [400, 401, 403, 429],
  },
  {
    method: 'post',
    path: '/ventas',
    summary:
      'Registra una venta. Requiere el header Idempotency-Key: un reenvío con la misma clave devuelve la misma venta y no descuenta stock otra vez.',
    scope: 'ventas:write',
    body: esquemaNuevaVenta,
    respuesta: {
      description:
        '201 si la venta es nueva, 200 si es el reenvío de la misma clave. El cuerpo es idéntico.',
      schema: esquemaVentaDetalle,
    },
    errores: [400, 401, 403, 409, 429],
  },
  {
    method: 'get',
    path: '/ventas/{id}',
    summary: 'Devuelve una venta con sus líneas y pagos.',
    scope: 'ventas:read',
    parameters: z.object({ id: z.string() }),
    respuesta: { description: 'La venta con su detalle.', schema: esquemaVentaDetalle },
    errores: [401, 403, 404, 429],
  },
  {
    method: 'get',
    path: '/reportes/ventas-por-dia',
    summary: 'Total y cantidad de ventas por día, incluidos los días sin ventas.',
    scope: 'reportes:read',
    parameters: esquemaRango,
    respuesta: {
      description: 'Un elemento por día del rango.',
      schema: z.object({ dias: z.array(esquemaResumenDia) }),
    },
    errores: [400, 401, 403, 429],
  },
  {
    method: 'get',
    path: '/reportes/top-productos',
    summary: 'Productos más vendidos en el rango.',
    scope: 'reportes:read',
    parameters: esquemaTopProductosQuery,
    respuesta: {
      description: 'Productos ordenados por cantidad vendida.',
      schema: z.object({ productos: z.array(esquemaTopProducto) }),
    },
    errores: [400, 401, 403, 429],
  },
  {
    method: 'get',
    path: '/reportes/caja',
    summary: 'Caja de un día, agrupada por medio de pago.',
    scope: 'reportes:read',
    parameters: esquemaCajaQuery,
    respuesta: { description: 'Totales por medio y gran total.', schema: esquemaCajaDelDia },
    errores: [400, 401, 403, 429],
  },
]

/** Los paths que el documento declara. El test cruza esta lista con el árbol de rutas. */
export const PATHS_DOCUMENTADOS = OPERACIONES.map((operacion) => ({
  method: operacion.method,
  path: operacion.path,
  scope: operacion.scope,
}))

function parametros(schema: z.ZodType, donde: 'query' | 'path') {
  const json = z.toJSONSchema(schema, { target: 'openapi-3.1', io: 'input', unrepresentable: 'any' }) as {
    properties?: Record<string, Record<string, unknown>>
    required?: string[]
  }
  const requeridos = new Set(json.required ?? [])

  return Object.entries(json.properties ?? {}).map(([nombre, definicion]) => ({
    name: nombre,
    in: donde,
    required: donde === 'path' ? true : requeridos.has(nombre),
    // `describe` de Zod viaja como description, así que el documento explica cada
    // parámetro con el mismo texto que el validador.
    schema: definicion,
  }))
}

export function documentoOpenAPI(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {}

  for (const operacion of OPERACIONES) {
    const entrada = (paths[operacion.path] ??= {})
    const esPath = operacion.path.includes('{')
    const parametrosDocumentados = operacion.parameters
      ? parametros(operacion.parameters, esPath ? 'path' : 'query')
      : undefined

    entrada[operacion.method] = {
      summary: operacion.summary,
      description: `Requiere el scope \`${operacion.scope}\`.`,
      ...(parametrosDocumentados && parametrosDocumentados.length > 0
        ? { parameters: parametrosDocumentados }
        : {}),
      ...(operacion.body ? { requestBody: cuerpo(operacion.body) } : {}),
      ...(operacion.scope === 'ventas:write'
        ? {
            parameters: [
              ...(parametrosDocumentados ?? []),
              {
                name: 'Idempotency-Key',
                in: 'header',
                required: true,
                description:
                  'Identifica el intento. Un reenvío con la misma clave no registra una segunda venta.',
                schema: { type: 'string', maxLength: 200 },
              },
            ],
          }
        : {}),
      responses: respuestas(operacion),
    }
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'caja-inventario API',
      version: '1.0.0',
      description:
        'API de caja e inventario. El dinero se expresa siempre en centavos enteros. ' +
        'Todos los errores comparten la forma { error: { code, message } } y `code` es estable.',
    },
    servers: [{ url: '/api/v1' }],
    security: [{ bearer: [] }],
    components: {
      securitySchemes: {
        bearer: {
          type: 'http',
          scheme: 'bearer',
          description:
            'Token emitido con `npm run token:emitir`. Se envía como `Authorization: Bearer <token>`. ' +
            'Es independiente de la cookie de sesión del panel.',
        },
      },
    },
    paths,
  }
}
