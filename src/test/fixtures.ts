import { prisma } from '../lib/db'

let contador = 0

function unico(prefijo: string) {
  contador += 1
  return `${prefijo}-${Date.now()}-${contador}`
}

export async function crearUsuario(datos: { email?: string } = {}) {
  const email = datos.email ?? `${unico('user')}@test.local`
  return prisma.usuario.create({
    data: { email, nombre: 'Usuario de test', passwordHash: 'hash-de-mentira' },
  })
}

export async function crearProducto(
  datos: { nombre?: string; precioCentavos?: number; stock?: number } = {},
) {
  const sku = unico('SKU')
  return prisma.producto.create({
    data: {
      sku,
      nombre: datos.nombre ?? `Producto ${sku}`,
      precioCentavos: datos.precioCentavos ?? 100_000,
      stock: datos.stock ?? 10,
    },
  })
}

/**
 * Inserta una venta con fecha explícita, sin pasar por registrarVenta.
 *
 * Los reportes se prueban contra días concretos, y `registrarVenta` siempre usa
 * `now()`: no hay forma de pedirle "una venta del 16 a las 23:30". Esta es la
 * única razón por la que los tests escriben ventas directamente.
 */
export async function crearVentaDirecta(datos: {
  usuarioId: string
  creadaEn: string
  lineas: { productoId: string; cantidad: number; precioUnitarioCentavos: number }[]
  medio?: 'EFECTIVO' | 'TRANSFERENCIA' | 'TARJETA'
}) {
  const lineas = datos.lineas.map((linea) => ({
    ...linea,
    subtotalCentavos: linea.precioUnitarioCentavos * linea.cantidad,
  }))
  const totalCentavos = lineas.reduce((suma, l) => suma + l.subtotalCentavos, 0)
  const creadaEn = new Date(datos.creadaEn)

  return prisma.venta.create({
    data: {
      usuarioId: datos.usuarioId,
      totalCentavos,
      createdAt: creadaEn,
      lineas: { create: lineas },
      pagos: {
        create: [
          {
            medio: datos.medio ?? 'EFECTIVO',
            montoCentavos: totalCentavos,
            createdAt: creadaEn,
          },
        ],
      },
    },
  })
}
