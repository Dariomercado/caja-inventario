import { expect, test } from '@playwright/test'
import { entrar } from './ayuda'

const SKU = 'AZU-001'
const CANTIDAD = 2

/** Stock del producto leído de la tabla de /productos, por su SKU. */
async function stockEnProductos(page: import('@playwright/test').Page) {
  await page.goto('/productos')
  const fila = page.getByRole('row').filter({ hasText: SKU })
  await expect(fila).toBeVisible()
  // Columnas: SKU, Producto, Precio, Stock.
  return Number((await fila.getByRole('cell').nth(3).innerText()).trim())
}

test('una venta registrada por la UI descuenta stock y aparece en el reporte del día', async ({
  page,
}) => {
  await entrar(page)

  const stockAntes = await stockEnProductos(page)
  expect(stockAntes).toBeGreaterThan(CANTIDAD)

  await page.goto('/ventas/nueva')
  await page.getByRole('button', { name: '+ Agregar producto' }).click()

  // El producto se elige por su nombre accesible, no por el orden en el documento:
  // si el formulario suma otro select, este test no cambia de destinatario en
  // silencio ni se rompe por un cambio de maquetado.
  const selectorProducto = page.getByRole('combobox', { name: 'Producto' })
  const opciones = await selectorProducto.locator('option').allTextContents()
  const indice = opciones.findIndex((texto) => texto.includes('Azúcar 1kg'))
  expect(indice, 'el seed tiene que ofrecer Azúcar 1kg').toBeGreaterThanOrEqual(0)

  await selectorProducto.selectOption({ index: indice })
  await page.getByLabel('Cantidad').fill(String(CANTIDAD))

  // El total se recalcula en el cliente; se guarda para compararlo con lo que
  // confirma el servidor. Que coincidan es la prueba de que el monto viajó bien.
  // Se ubica por su test id, no por la clase de Tailwind que lo estiliza.
  const total = page.getByTestId('total-venta')
  await expect(total).toHaveText(/\d/)
  const totalMostrado = (await total.innerText()).trim()
  expect(totalMostrado).not.toMatch(/^(\$|\$ )?0[,.]00$/)

  await page.getByRole('button', { name: 'Registrar venta' }).click()

  const confirmacion = page.getByRole('status')
  await expect(confirmacion).toContainText(/Venta #\d+ registrada por/)
  await expect(confirmacion).toContainText(totalMostrado)

  // Efecto observable en otra pantalla, no en el estado del componente: el stock
  // que muestra el catálogo bajó exactamente la cantidad vendida.
  expect(await stockEnProductos(page)).toBe(stockAntes - CANTIDAD)

  // Y la venta entró al reporte. La fila se ubica por el día, no por el monto: el
  // reporte siempre trae la fila de hoy, y buscar por monto se rompe con cualquier
  // otra venta del mismo importe en otro día. Una vez ubicada la fila, el monto sí
  // se compara: es lo que prueba que la venta quedó imputada a este día.
  const hoy = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date())
  await page.goto('/reportes')
  const filaDelDia = page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: hoy, exact: true }) })
  await expect(filaDelDia).toHaveCount(1)
  // Columnas de la tabla: Día, Ventas, Total.
  const ventasDelDia = Number((await filaDelDia.getByRole('cell').nth(1).innerText()).trim())
  expect(ventasDelDia).toBeGreaterThanOrEqual(1)
  await expect(filaDelDia.getByRole('cell').nth(2)).toHaveText(totalMostrado)

  // Y el resumen del período, que es lo que un humano mira primero, cuenta ventas.
  await expect(
    page.getByRole('paragraph').filter({ hasText: 'en el período' }),
  ).toContainText(/[1-9]\d* ventas/)
})
