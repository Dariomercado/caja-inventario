import { describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { crearProducto as fixture } from '@/test/fixtures'
import { StockInsuficienteError } from './ventas'
import {
  ProductoNoEncontradoError,
  SkuDuplicadoError,
  actualizarProducto,
  ajustarStock,
  crearProducto,
  listarProductos,
  listarProductosActivos,
  obtenerProducto,
} from './productos'

describe('crearProducto', () => {
  it('crea con stock 0 por defecto y devuelve sólo los campos del contrato', async () => {
    const producto = await crearProducto({
      sku: 'AZU-001',
      nombre: 'Azúcar 1 kg',
      precioCentavos: 180_000,
    })

    expect(producto).toEqual({
      id: expect.any(String),
      sku: 'AZU-001',
      nombre: 'Azúcar 1 kg',
      precioCentavos: 180_000,
      stock: 0,
      activo: true,
    })
  })

  it('rechaza un SKU repetido con un error de conflicto, no con un 500', async () => {
    await crearProducto({ sku: 'AZU-001', nombre: 'Primero', precioCentavos: 100 })

    await expect(
      crearProducto({ sku: 'AZU-001', nombre: 'Segundo', precioCentavos: 100 }),
    ).rejects.toBeInstanceOf(SkuDuplicadoError)
  })

  it('rechaza un precio que no es entero positivo', async () => {
    await expect(
      crearProducto({ sku: 'FLA-001', nombre: 'Fideos', precioCentavos: 12.5 }),
    ).rejects.toThrow(/Precio inválido/)
  })

  it('rechaza stock negativo', async () => {
    await expect(
      crearProducto({ sku: 'FLA-002', nombre: 'Fideos', precioCentavos: 100, stock: -1 }),
    ).rejects.toThrow(/Stock inválido/)
  })
})

describe('listarProductos', () => {
  it('pagina con cursor sin repetir ni saltear elementos', async () => {
    for (let i = 0; i < 5; i += 1) {
      await crearProducto({ sku: `SKU-${i}`, nombre: `Producto ${i}`, precioCentavos: 100 })
    }

    const primera = await listarProductos({ limite: 2 })
    expect(primera.productos).toHaveLength(2)
    expect(primera.siguienteCursor).not.toBeNull()

    const segunda = await listarProductos({ limite: 2, cursor: primera.siguienteCursor! })
    expect(segunda.productos).toHaveLength(2)

    const tercera = await listarProductos({ limite: 2, cursor: segunda.siguienteCursor! })
    expect(tercera.productos).toHaveLength(1)
    expect(tercera.siguienteCursor).toBeNull()

    const skus = [...primera.productos, ...segunda.productos, ...tercera.productos].map((p) => p.sku)
    expect(new Set(skus).size).toBe(5)
  })

  it('un alta entre dos páginas no descoloca el cursor', async () => {
    for (let i = 0; i < 3; i += 1) {
      await crearProducto({ sku: `SKU-${i}`, nombre: `Producto ${i}`, precioCentavos: 100 })
    }

    const primera = await listarProductos({ limite: 2 })
    // Con `skip`/`take` esto insertaría un elemento delante y la segunda página
    // repetiría el último de la primera. Con cursor, no.
    await crearProducto({ sku: 'SKU-9', nombre: 'Producto 9', precioCentavos: 100 })

    const segunda = await listarProductos({ limite: 2, cursor: primera.siguienteCursor! })
    const ids = new Set([...primera.productos, ...segunda.productos].map((p) => p.id))
    expect(ids.size).toBe(primera.productos.length + segunda.productos.length)
  })

  it('acota el límite a la página máxima y no acepta un límite de cero', async () => {
    await crearProducto({ sku: 'SKU-1', nombre: 'Uno', precioCentavos: 100 })

    const porDefecto = await listarProductos({ limite: 0 })
    expect(porDefecto.productos).toHaveLength(1)
  })

  it('lista sólo los activos cuando se lo pide', async () => {
    const activo = await fixture({ nombre: 'Activo' })
    const inactivo = await fixture({ nombre: 'Inactivo' })
    await prisma.producto.update({ where: { id: inactivo.id }, data: { activo: false } })

    const { productos } = await listarProductos({ soloActivos: true })

    expect(productos.map((p) => p.id)).toEqual([activo.id])
  })
})

describe('listarProductosActivos', () => {
  it('ordena por nombre, que es lo que necesita la tabla del panel', async () => {
    await fixture({ nombre: 'Zapallo' })
    await fixture({ nombre: 'Aceite' })

    const nombres = (await listarProductosActivos()).map((p) => p.nombre)

    expect(nombres).toEqual(['Aceite', 'Zapallo'])
  })
})

describe('actualizarProducto', () => {
  it('cambia sólo lo que se le pide', async () => {
    const producto = await fixture({ nombre: 'Viejo', precioCentavos: 500 })

    const actualizado = await actualizarProducto(producto.id, { nombre: 'Nuevo' })

    expect(actualizado.nombre).toBe('Nuevo')
    expect(actualizado.precioCentavos).toBe(500)
  })

  it('lanza un error de no encontrado con un id inexistente', async () => {
    await expect(actualizarProducto('no-existe', { nombre: 'X' })).rejects.toBeInstanceOf(
      ProductoNoEncontradoError,
    )
  })

  it('desactivar lo saca del listado de activos pero no lo borra', async () => {
    const producto = await fixture({ nombre: 'Temporal' })

    await actualizarProducto(producto.id, { activo: false })

    expect(await listarProductosActivos()).toHaveLength(0)
    expect(await obtenerProducto(producto.id)).not.toBeNull()
  })
})

describe('ajustarStock', () => {
  it('ENTRADA suma y deja el asiento con el stock resultante', async () => {
    const producto = await fixture({ stock: 10 })

    const resultado = await ajustarStock({
      productoId: producto.id,
      tipo: 'ENTRADA',
      cantidad: 5,
      motivo: 'Compra',
    })

    expect(resultado).toEqual({ productoId: producto.id, stock: 10, stockLuego: 15 })

    const [movimiento] = await prisma.movimientoStock.findMany({ where: { productoId: producto.id } })
    expect(movimiento).toMatchObject({ tipo: 'ENTRADA', cantidad: 5, stockLuego: 15, motivo: 'Compra' })
  })

  it('SALIDA resta', async () => {
    const producto = await fixture({ stock: 10 })

    const resultado = await ajustarStock({ productoId: producto.id, tipo: 'SALIDA', cantidad: 4 })

    expect(resultado.stockLuego).toBe(6)
  })

  it('SALIDA sin stock falla y no deja rastro: ni movimiento ni stock movido', async () => {
    const producto = await fixture({ stock: 3 })

    await expect(
      ajustarStock({ productoId: producto.id, tipo: 'SALIDA', cantidad: 4 }),
    ).rejects.toBeInstanceOf(StockInsuficienteError)

    expect(await prisma.movimientoStock.count()).toBe(0)
    expect((await obtenerProducto(producto.id))!.stock).toBe(3)
  })

  it('AJUSTE fija el valor absoluto, incluso para abajo', async () => {
    const producto = await fixture({ stock: 40 })

    const resultado = await ajustarStock({ productoId: producto.id, tipo: 'AJUSTE', cantidad: 12 })

    expect(resultado.stockLuego).toBe(12)
  })

  it('rechaza un producto inexistente y uno inactivo', async () => {
    await expect(
      ajustarStock({ productoId: 'no-existe', tipo: 'ENTRADA', cantidad: 1 }),
    ).rejects.toBeInstanceOf(ProductoNoEncontradoError)

    const inactivo = await fixture({ stock: 1 })
    await prisma.producto.update({ where: { id: inactivo.id }, data: { activo: false } })

    await expect(
      ajustarStock({ productoId: inactivo.id, tipo: 'ENTRADA', cantidad: 1 }),
    ).rejects.toThrow(/inactivo/)
  })

  it('dos salidas simultáneas no dejan el stock negativo', async () => {
    const producto = await fixture({ stock: 10 })

    // Bloqueo de fila: la segunda espera y ve el stock ya descontado por la primera.
    const resultados = await Promise.allSettled([
      ajustarStock({ productoId: producto.id, tipo: 'SALIDA', cantidad: 6 }),
      ajustarStock({ productoId: producto.id, tipo: 'SALIDA', cantidad: 6 }),
    ])

    const exitos = resultados.filter((r) => r.status === 'fulfilled')
    const fallos = resultados.filter((r) => r.status === 'rejected')

    expect(exitos).toHaveLength(1)
    expect(fallos).toHaveLength(1)
    expect((fallos[0] as PromiseRejectedResult).reason).toBeInstanceOf(StockInsuficienteError)
    expect((await obtenerProducto(producto.id))!.stock).toBe(4)
  })
})
