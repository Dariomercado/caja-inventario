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
    // En producción (Supabase, Neon y compañía) hay dos URLs distintas: la poolada
    // para la aplicación y la directa para migrar, porque el pooler no soporta los
    // locks que necesitan las migraciones. Sin variable directa, cae a la de siempre
    // y el desarrollo local sigue funcionando sin configurar nada extra.
    url: process.env['DIRECT_URL'] ?? process.env['DATABASE_URL'],
  },
})
