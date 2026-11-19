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

  // El primer combobox del formulario es el de producto de la línea; el de medio
  // de pago aparece después en el documento.
  const selectorProducto = page.getByRole('combobox').first()
  const opciones = await selectorProducto.locator('option').allTextContents()
  const indice = opciones.findIndex((texto) => texto.includes('Azúcar 1kg'))
  expect(indice, 'el seed tiene que ofrecer Azúcar 1kg').toBeGreaterThanOrEqual(0)

  await selectorProducto.selectOption({ index: indice })
  await page.getByLabel('Cantidad').fill(String(CANTIDAD))

  // El total se recalcula en el cliente; se guarda para compararlo con lo que
  // confirma el servidor. Que coincidan es la prueba de que el monto viajó bien.
  const total = page.locator('p.text-2xl')
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

  // Y la venta entró al reporte. El rango por defecto son los últimos siete días y
  // las filas van del día más viejo al más nuevo, así que la fila de hoy es la
  // última: se afirma el monto en cualquier celda y el resumen del período, que es
  // lo que un humano mira primero.
  await page.goto('/reportes')
  await expect(page.getByRole('cell', { name: totalMostrado })).toBeVisible()
  await expect(
    page.getByRole('paragraph').filter({ hasText: 'en el período' }),
  ).toContainText(/[1-9]\d* ventas/)
})
