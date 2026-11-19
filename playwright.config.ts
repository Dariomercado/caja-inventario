import { defineConfig, devices } from '@playwright/test'

// Los e2e manejan la aplicación compilada, igual que en producción: `next start`
// sobre un `next build`. Correrlos contra `next dev` daría un ciclo de vida
// distinto (recarga en caliente, compilación por ruta) y taparía fallos que sólo
// aparecen en el build.
const PUERTO = 3100
const BASE_URL = `http://127.0.0.1:${PUERTO}`

// Guard de seguridad antes que nada: este archivo se evalúa también cuando
// alguien invoca `playwright test` a mano, sin pasar por `npm run test:e2e`. Los
// e2e crean ventas y descuentan stock, así que sólo pueden apuntar a una base local
// cuyo nombre termine en `_e2e`. El `.env` de este repo apunta a Supabase de
// producción: el chequeo no es teórico.
const urlBase = process.env['DATABASE_URL'] ?? ''
const { hostBase, nombreBase } = (() => {
  try {
    const url = new URL(urlBase)
    return { hostBase: url.hostname, nombreBase: url.pathname.replace(/^\//, '') }
  } catch {
    return { hostBase: '', nombreBase: '' }
  }
})()

const HOSTS_LOCALES = ['127.0.0.1', 'localhost', '::1']

if (!HOSTS_LOCALES.includes(hostBase) || !nombreBase.endsWith('_e2e')) {
  throw new Error(
    `Los e2e necesitan una base local terminada en _e2e y DATABASE_URL apunta a ` +
      `"${hostBase || '(sin definir)'}/${nombreBase || '?'}".\n` +
      'Usá `npm run test:e2e`, que prepara esa base antes de arrancar.',
  )
}

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
    reuseExistingServer: !process.env['CI'],
    timeout: 300_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
