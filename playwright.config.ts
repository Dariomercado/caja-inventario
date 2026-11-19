import { defineConfig, devices } from '@playwright/test'
import { validarBaseE2E, PUERTO_E2E } from './e2e/base-e2e.mjs'

// Los e2e manejan la aplicación compilada, igual que en producción: `next start`
// sobre un `next build`. Correrlos contra `next dev` daría un ciclo de vida
// distinto (recarga en caliente, compilación por ruta) y taparía fallos que sólo
// aparecen en el build.
const PUERTO = PUERTO_E2E
const BASE_URL = `http://127.0.0.1:${PUERTO}`

// Guard de seguridad antes que nada: este archivo se evalúa también cuando alguien
// invoca `playwright test` a mano, sin pasar por `npm run test:e2e`. La regla vive
// en `e2e/base-e2e.mjs` para que no haya dos versiones de la misma guarda.
validarBaseE2E(process.env['DATABASE_URL'] ?? '')

export default defineConfig({
  testDir: './e2e',
  // Las pruebas comparten la base sembrada: una venta de un test cambia el stock
  // que ve el siguiente. En serie el orden es explícito y los datos son estables.
  fullyParallel: false,
  workers: 1,
  // En CI, un `test.only` olvidado tiene que fallar, no pasar como verde.
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: process.env['CI'] ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // El build tarda; el timeout cubre compilar y arrancar en un runner frío.
    command: `npm run build && npx next start -p ${PUERTO}`,
    url: `${BASE_URL}/login`,
    // Nunca reutilizar un servidor ya levantado: el guard de arriba valida la base
    // de ESTE proceso, no la que usa un servidor ajeno escuchando en el puerto. Un
    // `npm run dev` olvidado apuntando a producción convertiría el test de venta en
    // una venta real. Si el puerto está ocupado, el runner falla antes de arrancar
    // (ver `scripts/e2e.mjs`) y Playwright no se engancha a nada.
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
