// Datos de demostración. Idempotente: correrlo dos veces no duplica nada, así que
// se puede usar como `npm run db:seed` las veces que haga falta.
import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { prisma } from '../src/lib/db'

// Credenciales de demo. Van acá sólo porque es un entorno de demostración local;
// en una aplicación real esto no se escribe en ningún archivo del repo.
const USUARIO_DEMO = {
  email: 'admin@caja.local',
  nombre: 'Dario',
  password: 'caja1234',
}

const CATALOGO = [
  { sku: 'YER-001', nombre: 'Yerba mate 1kg', precioCentavos: 450_000, stockInicial: 40 },
  { sku: 'CAF-001', nombre: 'Café molido 500g', precioCentavos: 620_000, stockInicial: 25 },
  { sku: 'AZU-001', nombre: 'Azúcar 1kg', precioCentavos: 180_000, stockInicial: 60 },
  { sku: 'LEC-001', nombre: 'Leche entera 1L', precioCentavos: 135_000, stockInicial: 30 },
  { sku: 'PAN-001', nombre: 'Pan lactal', precioCentavos: 240_000, stockInicial: 20 },
  { sku: 'GAL-001', nombre: 'Galletitas surtidas', precioCentavos: 175_000, stockInicial: 45 },
]

async function main() {
  const passwordHash = await bcrypt.hash(USUARIO_DEMO.password, 12)

  const usuario = await prisma.usuario.upsert({
    where: { email: USUARIO_DEMO.email },
    update: { nombre: USUARIO_DEMO.nombre, passwordHash },
    create: {
      email: USUARIO_DEMO.email,
      nombre: USUARIO_DEMO.nombre,
      passwordHash,
    },
  })
  console.log(`usuario listo: ${usuario.email}`)

  for (const item of CATALOGO) {
    const producto = await prisma.producto.upsert({
      where: { sku: item.sku },
      // El update no toca `stock` a propósito: si ya hay ventas, reescribir el
      // stock acá dejaría el libro mayor mintiendo.
      update: { nombre: item.nombre, precioCentavos: item.precioCentavos },
      create: {
        sku: item.sku,
        nombre: item.nombre,
        precioCentavos: item.precioCentavos,
        stock: item.stockInicial,
      },
    })

    const entradas = await prisma.movimientoStock.count({
      where: { productoId: producto.id, tipo: 'ENTRADA' },
    })

    if (entradas === 0) {
      await prisma.movimientoStock.create({
        data: {
          productoId: producto.id,
          tipo: 'ENTRADA',
          cantidad: item.stockInicial,
          stockLuego: producto.stock,
          motivo: 'Carga inicial',
        },
      })
    }

    console.log(`${producto.sku} · stock ${producto.stock}`)
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
