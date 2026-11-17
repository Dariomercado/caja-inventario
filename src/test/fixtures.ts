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
