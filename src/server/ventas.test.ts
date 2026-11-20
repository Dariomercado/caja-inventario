import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { prisma } from '../lib/db'
import { crearProducto, crearUsuario } from '../test/fixtures'
import {
  ClaveIdempotenciaReutilizadaError,
  PagoInconsistenteError,
  StockInsuficienteError,
  registrarVenta,
} from './ventas'

// Los tests verifican efectos observables: el stock que queda, las filas que se
// escriben y las que NO se escriben cuando la venta se rechaza. Nunca miran
// estructuras internas del servicio.

describe('registrarVenta', () => {
  it('descuenta stock y registra la venta, su línea, el pago y el movimiento', async () => {
    const usuario = await crearUsuario()
    const producto = await crearProducto({ precioCentavos: 150_000, stock: 10 })

    const venta = await registrarVenta({
      usuarioId: usuario.id,
      claveIdempotencia: randomUUID(),
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
        claveIdempotencia: randomUUID(),
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
        claveIdempotencia: randomUUID(),
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
      claveIdempotencia: randomUUID(),
      items: [
        { productoId: a.id, cantidad: 1 },
        { productoId: b.id, cantidad: 1 },
      ],
      pagos: [{ medio: 'EFECTIVO', montoCentavos: 200_000 }],
    })
    const ventaDos = registrarVenta({
      usuarioId: usuario.id,
      claveIdempotencia: randomUUID(),
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
      claveIdempotencia: randomUUID(),
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

  it('cobra el total calculado en la transacción cuando se indica un solo medio', async () => {
    const usuario = await crearUsuario()
    const producto = await crearProducto({ precioCentavos: 150_000, stock: 5 })

    const venta = await registrarVenta({
      usuarioId: usuario.id,
      claveIdempotencia: randomUUID(),
      items: [{ productoId: producto.id, cantidad: 2 }],
      medioPago: 'TRANSFERENCIA',
    })

    // El monto lo decide el servidor con el precio real, no el cliente.
    expect(venta.totalCentavos).toBe(300_000)
    const pagos = await prisma.pago.findMany({ where: { ventaId: venta.id } })
    expect(pagos).toHaveLength(1)
    expect(pagos[0]).toMatchObject({ medio: 'TRANSFERENCIA', montoCentavos: 300_000 })
  })

  it('exige pagos o medio de pago, pero no ambos', async () => {
    const usuario = await crearUsuario()
    const producto = await crearProducto({ stock: 5 })

    await expect(
      registrarVenta({
        usuarioId: usuario.id,
        claveIdempotencia: randomUUID(),
        items: [{ productoId: producto.id, cantidad: 1 }],
      }),
    ).rejects.toThrow(/pagos o un único medio/)
  })

  it('rechaza una venta cuyos pagos no suman el total', async () => {
    const usuario = await crearUsuario()
    const producto = await crearProducto({ precioCentavos: 100_000, stock: 5 })

    await expect(
      registrarVenta({
        usuarioId: usuario.id,
        claveIdempotencia: randomUUID(),
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

  it('registra una sola venta cuando la misma clave llega dos veces', async () => {
    const usuario = await crearUsuario()
    const producto = await crearProducto({ precioCentavos: 100_000, stock: 10 })
    const clave = randomUUID()

    const intento = {
      usuarioId: usuario.id,
      claveIdempotencia: clave,
      items: [{ productoId: producto.id, cantidad: 2 }],
      medioPago: 'EFECTIVO' as const,
    }

    const primera = await registrarVenta(intento)
    const segunda = await registrarVenta(intento)

    // El segundo envío no es un error: devuelve la venta que ya existe.
    expect(segunda.numero).toBe(primera.numero)
    expect(segunda.totalCentavos).toBe(200_000)

    expect(await prisma.venta.count()).toBe(1)
    expect(await prisma.lineaVenta.count()).toBe(1)
    expect(await prisma.movimientoStock.count()).toBe(1)

    // El efecto que un doble clic rompía: el stock se descuenta una sola vez.
    const productoDespues = await prisma.producto.findUniqueOrThrow({ where: { id: producto.id } })
    expect(productoDespues.stock).toBe(8)
  })

  it('ocho envíos simultáneos con la misma clave devuelven todos la misma venta', async () => {
    const usuario = await crearUsuario()
    const producto = await crearProducto({ precioCentavos: 100_000, stock: 10 })
    const intento = {
      usuarioId: usuario.id,
      claveIdempotencia: randomUUID(),
      items: [{ productoId: producto.id, cantidad: 2 }],
      medioPago: 'EFECTIVO' as const,
    }

    // Ocho a la vez, no dos: la carrera depende de que varios lleguen al INSERT antes
    // de que el ganador confirme. Un reintento del cliente después de un timeout de
    // red es exactamente esto, y recibir un 500 en un pedido cuyo efecto sí ocurrió
    // es peor que recibir la venta.
    const resultados = await Promise.all(Array.from({ length: 8 }, () => registrarVenta(intento)))

    expect(new Set(resultados.map((venta) => venta.numero)).size).toBe(1)
    expect(await prisma.venta.count()).toBe(1)
    expect(await prisma.lineaVenta.count()).toBe(1)
    expect(await prisma.movimientoStock.count()).toBe(1)
    expect(
      (await prisma.producto.findUniqueOrThrow({ where: { id: producto.id } })).stock,
    ).toBe(8)
  })

  it('un reintento con la misma clave devuelve la venta, y con otro carrito la rechaza', async () => {
    const usuario = await crearUsuario()
    // Stock justo: la primera venta lo agota, así que un reintento no llega nunca al
    // índice único, falla antes en la validación de stock.
    const producto = await crearProducto({ precioCentavos: 100_000, stock: 2 })
    const intento = {
      usuarioId: usuario.id,
      claveIdempotencia: randomUUID(),
      items: [{ productoId: producto.id, cantidad: 2 }],
      medioPago: 'EFECTIVO' as const,
    }

    const primera = await registrarVenta(intento)
    expect((await registrarVenta(intento)).numero).toBe(primera.numero)

    // Devolver el comprobante viejo sería reportar como vendido un carrito que nunca
    // se registró: su stock no se descontaría y la venta se perdería en silencio.
    await expect(
      registrarVenta({ ...intento, items: [{ productoId: producto.id, cantidad: 1 }] }),
    ).rejects.toBeInstanceOf(ClaveIdempotenciaReutilizadaError)
    // El mismo carrito con otro medio: el total no cambia, comparar importes no alcanza.
    await expect(registrarVenta({ ...intento, medioPago: 'TARJETA' })).rejects.toBeInstanceOf(
      ClaveIdempotenciaReutilizadaError,
    )

    expect(await prisma.venta.count()).toBe(1)
    const despues = await prisma.producto.findUniqueOrThrow({ where: { id: producto.id } })
    expect(despues.stock).toBe(0)
  })

  it('no descuenta stock dos veces cuando dos envíos simultáneos comparten la clave', async () => {
    const usuario = await crearUsuario()
    const producto = await crearProducto({ precioCentavos: 100_000, stock: 10 })
    const clave = randomUUID()

    const intento = {
      usuarioId: usuario.id,
      claveIdempotencia: clave,
      items: [{ productoId: producto.id, cantidad: 2 }],
      medioPago: 'EFECTIVO' as const,
    }

    // Acá el respaldo real es el índice único: no hay ventana entre consultar y
    // escribir que dos peticiones puedan aprovechar.
    const resultados = await Promise.all([registrarVenta(intento), registrarVenta(intento)])

    expect(resultados[0].numero).toBe(resultados[1].numero)
    expect(await prisma.venta.count()).toBe(1)

    const productoDespues = await prisma.producto.findUniqueOrThrow({ where: { id: producto.id } })
    expect(productoDespues.stock).toBe(8)
  })

  it('registra dos ventas cuando las claves son distintas', async () => {
    const usuario = await crearUsuario()
    const producto = await crearProducto({ precioCentavos: 100_000, stock: 10 })

    const base = {
      usuarioId: usuario.id,
      items: [{ productoId: producto.id, cantidad: 2 }],
      medioPago: 'EFECTIVO' as const,
    }

    const uno = await registrarVenta({ ...base, claveIdempotencia: randomUUID() })
    const dos = await registrarVenta({ ...base, claveIdempotencia: randomUUID() })

    // Dos ventas idénticas en contenido son legítimas: son dos clientes distintos.
    expect(dos.numero).not.toBe(uno.numero)
    expect(await prisma.venta.count()).toBe(2)

    const productoDespues = await prisma.producto.findUniqueOrThrow({ where: { id: producto.id } })
    expect(productoDespues.stock).toBe(6)
  })

  it('exige una clave de idempotencia', async () => {
    const usuario = await crearUsuario()
    const producto = await crearProducto({ stock: 5 })

    await expect(
      registrarVenta({
        usuarioId: usuario.id,
        claveIdempotencia: '   ',
        items: [{ productoId: producto.id, cantidad: 1 }],
        medioPago: 'EFECTIVO',
      }),
    ).rejects.toThrow(/clave de idempotencia/)

    expect(await prisma.venta.count()).toBe(0)
  })
})
