import { z } from 'zod'

/**
 * Contratos de entrada de la API, en un solo lugar.
 *
 * Son la única fuente de verdad: el Route Handler valida con ellos y el documento
 * OpenAPI de `/api/v1/openapi.json` se genera desde los mismos objetos. Un contrato
 * escrito dos veces se desactualiza en la mitad que nadie mira.
 */

export const esquemaNuevoProducto = z.object({
  sku: z
    .string()
    .min(1)
    .max(40)
    // Se restringe el alfabeto del SKU: es una clave que termina en una URL y en un
    // comprobante, y un espacio o una barra ahí rompe a alguien más adelante.
    .regex(/^[A-Za-z0-9._-]+$/, 'sólo letras, números, punto, guion y guion bajo'),
  nombre: z.string().min(1).max(120),
  precioCentavos: z.number().int().positive(),
  stock: z.number().int().min(0).default(0),
})

export const esquemaEditarProducto = z
  .object({
    nombre: z.string().min(1).max(120).optional(),
    precioCentavos: z.number().int().positive().optional(),
    activo: z.boolean().optional(),
  })
  .refine((cambios) => Object.keys(cambios).length > 0, {
    message: 'hay que enviar al menos un campo para modificar',
  })

export const esquemaAjusteStock = z.object({
  tipo: z.enum(['ENTRADA', 'SALIDA', 'AJUSTE']),
  cantidad: z.number().int().min(0),
  motivo: z.string().min(1).max(200).optional(),
})

export const esquemaListado = z.object({
  cursor: z.string().min(1).optional(),
  limite: z.coerce.number().int().min(1).max(100).optional(),
  soloActivos: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((valor) => valor === true || valor === 'true')
    .optional(),
})

export const esquemaListadoVentas = z.object({
  // El cursor es el `numero` de la última venta recibida: único y monótono, así que
  // una venta nueva no descoloca la página siguiente.
  cursor: z.coerce.number().int().min(1).optional(),
  limite: z.coerce.number().int().min(1).max(100).optional(),
})

const MEDIOS_DE_PAGO = ['EFECTIVO', 'TRANSFERENCIA', 'TARJETA'] as const

export const esquemaNuevaVenta = z
  .object({
    items: z
      .array(
        z.object({
          productoId: z.string().min(1),
          cantidad: z.number().int().positive(),
        }),
      )
      .min(1),
    // Exactamente uno de los dos, igual que el servicio: o se detallan los pagos, o
    // se indica un medio y el monto lo calcula el servidor con el precio real.
    medioPago: z.enum(MEDIOS_DE_PAGO).optional(),
    pagos: z
      .array(
        z.object({
          medio: z.enum(MEDIOS_DE_PAGO),
          montoCentavos: z.number().int().positive(),
        }),
      )
      .min(1)
      .optional(),
  })
  .refine((venta) => (venta.pagos === undefined) !== (venta.medioPago === undefined), {
    message: 'indicá pagos o medioPago, pero no ambos ni ninguno',
  })

/**
 * Clave de idempotencia del header `Idempotency-Key`.
 * Se acota a un alfabeto seguro porque este valor termina en un índice único y en
 * un log: un salto de línea o un byte nulo ahí es un problema, no un dato.
 */
export const esquemaIdempotencyKey = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_.:-]+$/, 'sólo letras, números, punto, dos puntos, guion y guion bajo')

export type EntradaNuevaVenta = z.infer<typeof esquemaNuevaVenta>

/**
 * Fecha de calendario en `YYYY-MM-DD`.
 *
 * No alcanza con el formato: `new Date('2026-02-30')` no falla, normaliza al 2 de
 * marzo. Comparar la fecha de vuelta con la de entrada es lo que detecta el 30 de
 * febrero y el 31 de abril, que es exactamente el error que un consumidor comete al
 * armar un rango con aritmética propia.
 */
export const fechaISO = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'formato YYYY-MM-DD')
  .refine((valor) => {
    const fecha = new Date(`${valor}T00:00:00Z`)
    return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor
  }, 'no es una fecha del calendario')

export const esquemaRango = z
  .object({ desde: fechaISO, hasta: fechaISO })
  .refine((rango) => rango.desde <= rango.hasta, {
    message: 'no puede ser posterior a "hasta"',
    path: ['desde'],
  })

export const esquemaTopProductosQuery = z
  .object({
    desde: fechaISO,
    hasta: fechaISO,
    limite: z.coerce.number().int().min(1).max(100).optional(),
  })
  .refine((rango) => rango.desde <= rango.hasta, {
    message: 'no puede ser posterior a "hasta"',
    path: ['desde'],
  })

export const esquemaCajaQuery = z.object({ fecha: fechaISO })

export type EntradaNuevoProducto = z.infer<typeof esquemaNuevoProducto>
export type EntradaEditarProducto = z.infer<typeof esquemaEditarProducto>
export type EntradaAjusteStock = z.infer<typeof esquemaAjusteStock>

/**
 * Resume los problemas de validación en una línea legible.
 *
 * `path` es el nombre del campo tal como lo mandó el cliente, que es lo único que
 * necesita para corregir: el resto del mensaje de Zod es ruido de implementación.
 */
export function mensajeDeValidacion(error: z.ZodError): string {
  return error.issues
    .map((problema) => {
      const campo = problema.path.join('.') || 'cuerpo'
      return `${campo}: ${problema.message}`
    })
    .join('; ')
}
