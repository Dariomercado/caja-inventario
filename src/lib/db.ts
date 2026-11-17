import { PrismaPg } from '@prisma/adapter-pg'
// Prisma 7 genera el cliente como fuente TS en generated/prisma; el punto de
// entrada es client.ts, no el directorio (no hay index).
import { PrismaClient } from '../../generated/prisma/client'

// En desarrollo Next.js recarga los módulos en caliente ante cada cambio. Si cada
// recarga creara un PrismaClient nuevo (y con él un pool nuevo), las conexiones de
// Postgres se agotan y las consultas empiezan a colgarse sin ningún error visible.
// Guardar la instancia en globalThis la reutiliza entre recargas. En producción el
// proceso es estable, así que no hace falta.
//
// Prisma 7 ya no lleva la URL dentro del schema: el cliente recibe un driver
// adapter, que es quien realmente abre las conexiones.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

function createClient() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    // Fallar acá y no en la primera consulta: sin esto el error aparece como un
    // timeout críptico en una pantalla, lejos de la causa real.
    throw new Error(
      'DATABASE_URL no está definida. Copiá .env.example a .env y completá la conexión.',
    )
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['warn', 'error'],
  })
}

export const prisma = globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
