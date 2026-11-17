import { beforeEach } from 'vitest'
import { prisma } from '../lib/db'
import { assertTestDatabase } from './guard'

assertTestDatabase()

// Un solo TRUNCATE para todas las tablas: el orden de borrado entre tablas con
// claves foráneas se resuelve con CASCADE, y RESTART IDENTITY evita que el
// contador de `Venta.numero` se arrastre de un test a otro.
beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "LineaVenta", "Pago", "MovimientoStock", "Venta", "Producto", "Usuario" RESTART IDENTITY CASCADE',
  )
})
