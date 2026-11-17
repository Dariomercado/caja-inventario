// Prisma 7 sacó la URL del schema: la conexión para migraciones vive acá.
// El runtime de la aplicación NO usa este archivo, usa el driver adapter de
// src/lib/db.ts. Son dos caminos distintos a propósito: el CLI migra, la app consulta.
import 'dotenv/config'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // Prisma 7 ignora el bloque "prisma" de package.json: el seed se declara acá.
    // Con la config vieja, `migrate dev` no siembra y no avisa que no sembró.
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // En producción la provee la plataforma de hosting; en local, .env.
    url: process.env['DATABASE_URL'],
  },
})
