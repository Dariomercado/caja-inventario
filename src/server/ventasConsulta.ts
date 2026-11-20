import { prisma } from '@/lib/db'

/**
 * Lectura de ventas para la API.
 *
 * Vive separado de `ventas.ts` a propósito: ese archivo es la transacción que
 * descuenta stock y es la pieza que no se quiere tocar por agregar un listado. Acá
 * sólo se lee.
 *
 * El orden es por `numero` descendente, que es lo que un consumidor quiere (primero
 * lo último) y además es un cursor natural: `numero` es único, entero y monótono,
 * así que una venta nueva nunca descoloca la página siguiente.
 */

const CAMPOS = {
  id: true,
  numero: true,
  totalCentavos: true,
  createdAt: true,
} as const

export type VentaResumen = {
  id: string
  numero: number
  totalCentavos: number
  /** ISO 8601 en UTC. El cliente decide cómo mostrarlo. */
  creadaEn: string
}

export type LineaDetalle = {
  productoId: string
  nombre: string
  cantidad: number
  precioUnitarioCentavos: number
  subtotalCentavos: number
}

export type PagoDetalle = {
  medio: string
  montoCentavos: number
}

export type VentaDetalle = VentaResumen & {
  lineas: LineaDetalle[]
  pagos: PagoDetalle[]
}

export const PAGINA_POR_DEFECTO = 20
export const PAGINA_MAXIMA = 100

export async function listarVentas(opciones: { cursor?: number; limite?: number } = {}): Promise<{
  ventas: VentaResumen[]
  siguienteCursor: number | null
}> {
  const cantidad = Math.min(Math.max(1, opciones.limite ?? PAGINA_POR_DEFECTO), PAGINA_MAXIMA)

  const filas = await prisma.venta.findMany({
    orderBy: { numero: 'desc' },
    take: cantidad + 1,
    ...(opciones.cursor ? { cursor: { numero: opciones.cursor }, skip: 1 } : {}),
    select: CAMPOS,
  })

  const hayMas = filas.length > cantidad
  const pagina = hayMas ? filas.slice(0, cantidad) : filas

  return {
    ventas: pagina.map(({ createdAt, ...resto }) => ({ ...resto, creadaEn: createdAt.toISOString() })),
    siguienteCursor: hayMas ? (pagina.at(-1)?.numero ?? null) : null,
  }
}

export async function obtenerVenta(id: string): Promise<VentaDetalle | null> {
  const venta = await prisma.venta.findUnique({
    where: { id },
    select: {
      ...CAMPOS,
      lineas: {
        select: {
          productoId: true,
          cantidad: true,
          precioUnitarioCentavos: true,
          subtotalCentavos: true,
          // El nombre se lee del producto actual: el precio ya está congelado en la
          // línea, pero renombrar un producto no debería reescribir el comprobante
          // con un nombre viejo. Si el producto se borrara, la FK lo impide.
          producto: { select: { nombre: true } },
        },
      },
      pagos: { select: { medio: true, montoCentavos: true } },
    },
  })

  if (!venta) return null

  const { createdAt, lineas, pagos, ...resto } = venta

  return {
    ...resto,
    creadaEn: createdAt.toISOString(),
    lineas: lineas.map((linea) => ({
      productoId: linea.productoId,
      nombre: linea.producto.nombre,
      cantidad: linea.cantidad,
      precioUnitarioCentavos: linea.precioUnitarioCentavos,
      subtotalCentavos: linea.subtotalCentavos,
    })),
    pagos,
  }
}
