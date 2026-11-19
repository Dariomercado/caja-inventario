import { afterEach, describe, expect, it } from 'vitest'

// `playwright.config.ts` evalúa el guard de la base antes de nada, y es la única
// puerta que no pasa por `scripts/e2e.mjs`: quien corre `npx playwright test` a
// mano nunca ve el `fallar()` del script. Este test fija que las dos puertas
// expliquen el rechazo con el mismo formato —mensaje `[e2e]` y qué hacer— en lugar
// de una traza cruda.
const URL_REMOTA = 'postgres://caja:caja@db.supabase.co:5432/caja_e2e'

describe('guard de la base de los e2e', () => {
  const original = process.env['DATABASE_URL']

  afterEach(() => {
    if (original === undefined) delete process.env['DATABASE_URL']
    else process.env['DATABASE_URL'] = original
  })

  it('el config de Playwright rechaza una base remota con el mensaje del script', async () => {
    process.env['DATABASE_URL'] = URL_REMOTA

    await expect(import('../../playwright.config')).rejects.toThrow(
      /\[e2e\] DATABASE_URL apunta a "db\.supabase\.co"/,
    )
  })
})
