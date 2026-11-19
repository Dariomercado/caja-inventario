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
