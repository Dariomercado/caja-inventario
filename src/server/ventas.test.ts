import { describe, expect, it } from 'vitest'
import { prisma } from '../lib/db'
import { crearProducto, crearUsuario } from '../test/fixtures'
import { PagoInconsistenteError, StockInsuficienteError, registrarVenta } from './ventas'

// Los tests verifican efectos observables: el stock que queda, las filas que se
// escriben y las que NO se escriben cuando la venta se rechaza. Nunca miran
// estructuras internas del servicio.

describe('registrarVenta', () => {
  it('descuenta stock y registra la venta, su línea, el pago y el movimiento', async () => {
    const usuario = await crearUsuario()
    const producto = await crearProducto({ precioCentavos: 150_000, stock: 10 })

    const venta = await registrarVenta({
      usuarioId: usuario.id,
      items: [{ productoId: producto.id, cantidad: 3 }],
      pagos: [{ medio: 'EFECTIVO', montoCentavos: 450_000 }],
    })

    expect(venta.totalCentavos).toBe(450_000)

    const productoDespues = await prisma.producto.findUniqueOrThrow({
      where: { id: producto.id },
    })
    expect(productoDespues.stock).toBe(7)

    const lineas = await prisma.lineaVenta.findMany({ where: { ventaId: venta.id } })
    expect(lineas).toHaveLength(1)
    expect(lineas[0]).toMatchObject({
      cantidad: 3,
      precioUnitarioCentavos: 150_000,
      subtotalCentavos: 450_000,
    })

    const pagos = await prisma.pago.findMany({ where: { ventaId: venta.id } })
    expect(pagos).toHaveLength(1)
    expect(pagos[0]).toMatchObject({ medio: 'EFECTIVO', montoCentavos: 450_000 })

    const movimientos = await prisma.movimientoStock.findMany({
      where: { ventaId: venta.id },
    })
    expect(movimientos).toHaveLength(1)
    expect(movimientos[0]).toMatchObject({ tipo: 'SALIDA', cantidad: 3, stockLuego: 7 })
  })

  it('rechaza stock insuficiente sin escribir nada', async () => {
    const usuario = await crearUsuario()
    const producto = await crearProducto({ stock: 2, precioCentavos: 100_000 })

    await expect(
      registrarVenta({
        usuarioId: usuario.id,
        items: [{ productoId: producto.id, cantidad: 3 }],
        pagos: [{ medio: 'EFECTIVO', montoCentavos: 300_000 }],
      }),
    ).rejects.toBeInstanceOf(StockInsuficienteError)

    // El rollback tiene que dejar la base exactamente como estaba.
    expect(await prisma.venta.count()).toBe(0)
    expect(await prisma.lineaVenta.count()).toBe(0)
    expect(await prisma.movimientoStock.count()).toBe(0)
    expect(await prisma.pago.count()).toBe(0)

    const productoDespues = await prisma.producto.findUniqueOrThrow({
      where: { id: producto.id },
    })
    expect(productoDespues.stock).toBe(2)
  })

  it('no deja stock negativo cuando dos ventas simultáneas pelean por el último ítem', async () => {
    const usuario = await crearUsuario()
    const producto = await crearProducto({ stock: 1, precioCentavos: 100_000 })

    const intentar = () =>
      registrarVenta({
        usuarioId: usuario.id,
        items: [{ productoId: producto.id, cantidad: 1 }],
        pagos: [{ medio: 'EFECTIVO', montoCentavos: 100_000 }],
      })

    const resultados = await Promise.allSettled([intentar(), intentar()])

    const exitos = resultados.filter((r) => r.status === 'fulfilled')
    const fallos = resultados.filter((r) => r.status === 'rejected')

    expect(exitos).toHaveLength(1)
    expect(fallos).toHaveLength(1)
    expect((fallos[0] as PromiseRejectedResult).reason).toBeInstanceOf(StockInsuficienteError)

    const productoDespues = await prisma.producto.findUniqueOrThrow({
      where: { id: producto.id },
    })
    expect(productoDespues.stock).toBe(0)
    expect(await prisma.venta.count()).toBe(1)
  })

  it('no se traba cuando dos ventas tocan los mismos productos en orden inverso', async () => {
    const usuario = await crearUsuario()
    const a = await crearProducto({ stock: 5 })
    const b = await crearProducto({ stock: 5 })

    const ventaUno = registrarVenta({
      usuarioId: usuario.id,
      items: [
        { productoId: a.id, cantidad: 1 },
        { productoId: b.id, cantidad: 1 },
      ],
      pagos: [{ medio: 'EFECTIVO', montoCentavos: 200_000 }],
    })
    const ventaDos = registrarVenta({
      usuarioId: usuario.id,
      items: [
        { productoId: b.id, cantidad: 1 },
        { productoId: a.id, cantidad: 1 },
      ],
      pagos: [{ medio: 'EFECTIVO', montoCentavos: 200_000 }],
    })

    const resultados = await Promise.allSettled([ventaUno, ventaDos])

    // Si el servicio bloqueara las filas en el orden en que llegan los ítems,
    // estas dos ventas se esperarían mutuamente hasta el timeout.
    expect(resultados.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled'])
    expect((await prisma.producto.findUniqueOrThrow({ where: { id: a.id } })).stock).toBe(3)
    expect((await prisma.producto.findUniqueOrThrow({ where: { id: b.id } })).stock).toBe(3)
  })

  it('congela el precio unitario aunque después cambie el del producto', async () => {
    const usuario = await crearUsuario()
    const producto = await crearProducto({ precioCentavos: 100_000, stock: 5 })

    const venta = await registrarVenta({
      usuarioId: usuario.id,
      items: [{ productoId: producto.id, cantidad: 1 }],
      pagos: [{ medio: 'EFECTIVO', montoCentavos: 100_000 }],
    })

    await prisma.producto.update({
      where: { id: producto.id },
      data: { precioCentavos: 500_000 },
    })

    const linea = await prisma.lineaVenta.findFirstOrThrow({ where: { ventaId: venta.id } })
    expect(linea.precioUnitarioCentavos).toBe(100_000)
    expect(linea.subtotalCentavos).toBe(100_000)
  })

  it('rechaza una venta cuyos pagos no suman el total', async () => {
    const usuario = await crearUsuario()
    const producto = await crearProducto({ precioCentavos: 100_000, stock: 5 })

    await expect(
      registrarVenta({
        usuarioId: usuario.id,
        items: [{ productoId: producto.id, cantidad: 2 }],
        pagos: [{ medio: 'EFECTIVO', montoCentavos: 100_000 }],
      }),
    ).rejects.toBeInstanceOf(PagoInconsistenteError)

    expect(await prisma.venta.count()).toBe(0)
    const productoDespues = await prisma.producto.findUniqueOrThrow({
      where: { id: producto.id },
    })
    expect(productoDespues.stock).toBe(5)
  })
})
