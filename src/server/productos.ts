import { prisma } from '@/lib/db'
import { StockInsuficienteError } from './ventas'

/**
 * Productos y su stock.
 *
 * El catálogo lo leen tanto la UI como la API, así que la consulta vive acá y no en
 * cada consumidor. El precio se maneja siempre en centavos enteros, igual que en el
 * resto del sistema: no hay un lugar donde un float se cuele.
 */

export class ProductoNoEncontradoError extends Error {
  constructor(readonly productoId: string) {
    super(`El producto ${productoId} no existe`)
    this.name = 'ProductoNoEncontradoError'
  }
}

export class SkuDuplicadoError extends Error {
  constructor(readonly sku: string) {
    super(`Ya existe un producto con el SKU ${sku}`)
    this.name = 'SkuDuplicadoError'
  }
}

export type ProductoResumen = {
  id: string
  sku: string
  nombre: string
  precioCentavos: number
  stock: number
  activo: boolean
}

export const PAGINA_POR_DEFECTO = 20
export const PAGINA_MAXIMA = 100

/** Campos que salen del servicio. Se mapea a mano para no publicar columnas internas. */
const CAMPOS = {
  id: true,
  sku: true,
  nombre: true,
  precioCentavos: true,
  stock: true,
  activo: true,
} as const

/**
 * Lista el catálogo ordenado por id, con paginación por cursor.
 *
 * El cursor es el `id` del último elemento recibido y no un número de página: con
 * un offset, un producto creado entre dos pedidos corre la lista y un elemento se
 * repite o se pierde. Un cursor inexistente devuelve una lista vacía en lugar de
 * fallar: el cliente ya no puede pedir más desde ahí.
 */
export async function listarProductos(opciones: {
  cursor?: string
  limite?: number
  soloActivos?: boolean
} = {}): Promise<{ productos: ProductoResumen[]; siguienteCursor: string | null }> {
  const cantidad = Math.min(Math.max(1, opciones.limite ?? PAGINA_POR_DEFECTO), PAGINA_MAXIMA)

  const filas = await prisma.producto.findMany({
    where: opciones.soloActivos ? { activo: true } : {},
    orderBy: { id: 'asc' },
    // Un elemento de más para saber si hay página siguiente sin una segunda consulta.
    take: cantidad + 1,
    ...(opciones.cursor ? { cursor: { id: opciones.cursor }, skip: 1 } : {}),
    select: CAMPOS,
  })

  const hayMas = filas.length > cantidad
  const productos = hayMas ? filas.slice(0, cantidad) : filas

  return {
    productos,
    siguienteCursor: hayMas ? (productos.at(-1)?.id ?? null) : null,
  }
}

/** Todos los productos activos, para la pantalla del panel (que no pagina). */
export async function listarProductosActivos(): Promise<ProductoResumen[]> {
  return prisma.producto.findMany({
    where: { activo: true },
    orderBy: { nombre: 'asc' },
    select: CAMPOS,
  })
}

export async function obtenerProducto(id: string): Promise<ProductoResumen | null> {
  return prisma.producto.findUnique({ where: { id }, select: CAMPOS })
}

export async function crearProducto(entrada: {
  sku: string
  nombre: string
  precioCentavos: number
  stock?: number
}): Promise<ProductoResumen> {
  if (!Number.isInteger(entrada.precioCentavos) || entrada.precioCentavos <= 0) {
    throw new Error(`Precio inválido: ${entrada.precioCentavos}`)
  }
  const stock = entrada.stock ?? 0
  if (!Number.isInteger(stock) || stock < 0) {
    throw new Error(`Stock inválido: ${stock}`)
  }

  // El SKU duplicado se detecta por el índice único, no con un SELECT previo: entre
  // el chequeo y el INSERT hay una ventana en la que otro pedido puede crearlo.
  const existente = await prisma.producto.findUnique({
    where: { sku: entrada.sku },
    select: { id: true },
  })
  if (existente) throw new SkuDuplicadoError(entrada.sku)

  try {
    return await prisma.producto.create({
      data: {
        sku: entrada.sku,
        nombre: entrada.nombre,
        precioCentavos: entrada.precioCentavos,
        stock,
      },
      select: CAMPOS,
    })
  } catch (error) {
    if (esViolacionDeUnico(error)) throw new SkuDuplicadoError(entrada.sku)
    throw error
  }
}

export async function actualizarProducto(
  id: string,
  cambios: { nombre?: string; precioCentavos?: number; activo?: boolean },
): Promise<ProductoResumen> {
  if (
    cambios.precioCentavos !== undefined &&
    (!Number.isInteger(cambios.precioCentavos) || cambios.precioCentavos <= 0)
  ) {
    throw new Error(`Precio inválido: ${cambios.precioCentavos}`)
  }

  const existente = await prisma.producto.findUnique({ where: { id }, select: { id: true } })
  if (!existente) throw new ProductoNoEncontradoError(id)

  return prisma.producto.update({ where: { id }, data: cambios, select: CAMPOS })
}

/**
 * Mueve el stock y deja el asiento en el libro mayor.
 *
 * Semántica del tipo: `ENTRADA` suma, `SALIDA` resta (y no puede dejar el stock
 * negativo), `AJUSTE` fija el valor absoluto, que es lo que se usa al contar el
 * inventario físico.
 *
 * El bloqueo con `FOR UPDATE` es el mismo que usa la venta y por la misma razón: sin
 * él, dos ajustes simultáneos leen el mismo stock y el segundo pisa al primero.
 */
export async function ajustarStock(entrada: {
  productoId: string
  tipo: 'ENTRADA' | 'SALIDA' | 'AJUSTE'
  cantidad: number
  motivo?: string
}): Promise<{ productoId: string; stock: number; stockLuego: number }> {
  if (!Number.isInteger(entrada.cantidad) || entrada.cantidad < 0) {
    throw new Error(`Cantidad inválida: ${entrada.cantidad}`)
  }
  if (entrada.tipo === 'SALIDA' && entrada.cantidad === 0) {
    throw new Error('Una salida de 0 no registra ningún movimiento')
  }

  return prisma.$transaction(async (tx) => {
    const filas = await tx.$queryRaw<{ id: string; nombre: string; stock: number; activo: boolean }[]>`
      SELECT "id", "nombre", "stock", "activo"
      FROM "Producto"
      WHERE "id" = ${entrada.productoId}
      FOR UPDATE
    `
    const producto = filas[0]
    if (!producto) throw new ProductoNoEncontradoError(entrada.productoId)
    if (!producto.activo) {
      throw new Error(`El producto ${producto.nombre} está inactivo`)
    }

    const stockLuego =
      entrada.tipo === 'ENTRADA'
        ? producto.stock + entrada.cantidad
        : entrada.tipo === 'SALIDA'
          ? producto.stock - entrada.cantidad
          : entrada.cantidad

    if (stockLuego < 0) {
      throw new StockInsuficienteError(entrada.productoId, producto.stock, entrada.cantidad)
    }

    await tx.producto.update({ where: { id: entrada.productoId }, data: { stock: stockLuego } })

    await tx.movimientoStock.create({
      data: {
        productoId: entrada.productoId,
        tipo: entrada.tipo,
        cantidad: entrada.cantidad,
        stockLuego,
        motivo: entrada.motivo ?? null,
      },
    })

    return { productoId: entrada.productoId, stock: producto.stock, stockLuego }
  })
}

/** `P2002` es el código de Prisma para violación de constraint único. */
function esViolacionDeUnico(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002'
}
