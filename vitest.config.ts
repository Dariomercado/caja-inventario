import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    // Los tests de este proyecto son de base de datos y de servicios, no de
    // componentes: necesitan APIs de Node (fs, crypto) y no un DOM.
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Guard de base *_test + limpieza de tablas antes de cada caso.
    setupFiles: ['./src/test/setup.ts'],
    // Las pruebas de concurrencia abren transacciones reales contra Postgres.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Cada archivo de test abre conexiones propias; correrlos en secuencia evita
    // que se pisen los datos sembrados.
    fileParallelism: false,
  },
})
