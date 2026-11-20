/**
 * Errores de dominio de productos.
 *
 * Viven en su propio módulo y no en `productos.ts` porque los usan tanto ese
 * servicio como `ventas.ts`, que no puede importar de `productos.ts`: ese archivo ya
 * importa `StockInsuficienteError` de `ventas.ts`, y el import circular funcionaría
 * hasta el día en que uno de los dos se cargue primero y el `instanceof` falle en
 * silencio. Las clases de error son la peor pieza para tener en un ciclo.
 */

export class ProductoNoEncontradoError extends Error {
  constructor(readonly productoId: string) {
    super(`El producto ${productoId} no existe`)
    this.name = 'ProductoNoEncontradoError'
  }
}

export class ProductoInactivoError extends Error {
  constructor(readonly nombre: string) {
    super(`El producto ${nombre} está inactivo`)
    this.name = 'ProductoInactivoError'
  }
}

export class SkuDuplicadoError extends Error {
  constructor(readonly sku: string) {
    super(`Ya existe un producto con el SKU ${sku}`)
    this.name = 'SkuDuplicadoError'
  }
}
