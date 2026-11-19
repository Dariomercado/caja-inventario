import { expect, test } from '@playwright/test'
import { USUARIO_DEMO, NOMBRE_COOKIE_SESION, entrar } from './ayuda'

const RUTAS_PROTEGIDAS = ['/productos', '/ventas/nueva', '/reportes']

test('sin sesión, las rutas del panel mandan a /login sin filtrar datos', async ({ page }) => {
  for (const ruta of RUTAS_PROTEGIDAS) {
    const respuesta = await page.goto(ruta)

    // El middleware redirige antes de renderizar. El 200 del final corresponde a
    // /login: lo que importa es que la cadena incluyó un 307.
    expect([200, 307]).toContain(respuesta?.status())
    await expect(page).toHaveURL(/\/login$/)

    // El motivo por el que el guard vive en middleware y no en el layout: si el
    // HTML del panel llegara en el cuerpo de la redirección, la protección sería
    // cosmética. Un SKU del catálogo no puede aparecer en una pantalla anónima.
    const cuerpo = await page.content()
    expect(cuerpo).not.toContain('AZU-001')
    expect(cuerpo).not.toContain('Azúcar 1kg')
  }
})

test('credenciales inválidas muestran el error y no abren sesión', async ({ page }) => {
  await page.goto('/login')
  await page.locator('#email').fill(USUARIO_DEMO.email)
  await page.locator('#password').fill('esto-no-es-la-clave')
  await page.getByRole('button', { name: 'Entrar' }).click()

  // Next inyecta su propio `<div role="alert">` para anunciar cambios de ruta
  // (`__next-route-announcer__`), así que el rol solo no alcanza: se filtra por el
  // texto que tiene que mostrar el formulario.
  await expect(
    page.getByRole('alert').filter({ hasText: 'Email o contraseña incorrectos.' }),
  ).toBeVisible()
  await expect(page).toHaveURL(/\/login$/)

  // No alcanza con seguir en /login: lo que no tiene que haber pasado es que se
  // emita la cookie.
  const cookies = await page.context().cookies()
  expect(cookies.find((c) => c.name === NOMBRE_COOKIE_SESION)).toBeUndefined()
})

test('el login válido abre el panel y deja una cookie httpOnly', async ({ page }) => {
  await entrar(page)

  for (const enlace of ['Productos', 'Registrar venta', 'Reportes']) {
    await expect(page.getByRole('link', { name: enlace })).toBeVisible()
  }

  const cookie = (await page.context().cookies()).find((c) => c.name === NOMBRE_COOKIE_SESION)
  expect(cookie).toBeDefined()
  expect(cookie?.httpOnly).toBe(true)
})
