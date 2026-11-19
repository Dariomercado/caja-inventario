import { expect, type Page } from '@playwright/test'

// Credenciales del seed de demo (`prisma/seed.ts`). Si cambian allá, cambian acá.
export const USUARIO_DEMO = {
  email: 'admin@caja.local',
  password: 'caja1234',
}

export const NOMBRE_COOKIE_SESION = 'caja_sesion'

/**
 * Login por la pantalla real, que es lo que un e2e tiene que ejercitar: el
 * formulario, el POST a `/api/auth/login` y la cookie que emite.
 */
export async function entrar(page: Page) {
  await page.goto('/login')
  await page.locator('#email').fill(USUARIO_DEMO.email)
  await page.locator('#password').fill(USUARIO_DEMO.password)
  await page.getByRole('button', { name: 'Entrar' }).click()

  // El formulario hace `router.replace('/productos')` al recibir la cookie.
  await expect(page).toHaveURL(/\/productos$/)
}
