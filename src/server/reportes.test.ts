import { describe, expect, it } from 'vitest'
import { prisma } from '../lib/db'
import { crearProducto, crearUsuario, crearVentaDirecta } from '../test/fixtures'
import { cajaDelDia, resumenPorDia, topProductos } from './reportes'

// Todas las fechas son locales de Argentina (UTC-3). 23:30 del 16 local ya es el
// 17 en UTC, y ahí está la trampa que estos tests vigilan.

describe('resumenPorDia', () => {
  it('agrupa por día local e incluye los días sin ventas', async () => {
    const usuario = await crearUsuario()
    const producto = await crearProducto({ precioCentavos: 100_000 })

    await crearVentaDirecta({
      usuarioId: usuario.id,
      creadaEn: '2026-11-16T10:00:00-03:00',
      lineas: [{ productoId: producto.id, cantidad: 2, precioUnitarioCentavos: 100_000 }],
    })
    await crearVentaDirecta({
      usuarioId: usuario.id,
      creadaEn: '2026-11-16T18:00:00-03:00',
      lineas: [{ productoId: producto.id, cantidad: 1, precioUnitarioCentavos: 100_000 }],
    })
    await crearVentaDirecta({
      usuarioId: usuario.id,
      creadaEn: '2026-11-18T09:00:00-03:00',
      lineas: [{ productoId: producto.id, cantidad: 5, precioUnitarioCentavos: 100_000 }],
    })

    const resumen = await resumenPorDia({ desde: '2026-11-16', hasta: '2026-11-18' })

    expect(resumen).toEqual([
      { fecha: '2026-11-16', cantidadVentas: 2, totalCentavos: 300_000 },
      { fecha: '2026-11-17', cantidadVentas: 0, totalCentavos: 0 },
      { fecha: '2026-11-18', cantidadVentas: 1, totalCentavos: 500_000 },
    ])
  })

  it('ubica una venta de las 23:30 en el día local y no en el día UTC siguiente', async () => {
    const usuario = await crearUsuario()
    const producto = await crearProducto({ precioCentavos: 100_000 })

    // 2026-11-17T02:30Z es el 16 a las 23:30 en Buenos Aires.
    await crearVentaDirecta({
      usuarioId: usuario.id,
      creadaEn: '2026-11-16T23:30:00-03:00',
      lineas: [{ productoId: producto.id, cantidad: 1, precioUnitarioCentavos: 100_000 }],
    })

    const delDieciseis = await resumenPorDia({ desde: '2026-11-16', hasta: '2026-11-16' })
    const delDiecisiete = await resumenPorDia({ desde: '2026-11-17', hasta: '2026-11-17' })

    expect(delDieciseis).toEqual([
      { fecha: '2026-11-16', cantidadVentas: 1, totalCentavos: 100_000 },
    ])
    expect(delDiecisiete).toEqual([
      { fecha: '2026-11-17', cantidadVentas: 0, totalCentavos: 0 },
    ])
  })
})

describe('topProductos', () => {
  it('suma cantidades y centavos, ordena y respeta el límite', async () => {
    const usuario = await crearUsuario()
    const yerba = await crearProducto({ nombre: 'Yerba', precioCentavos: 100_000 })
    const cafe = await crearProducto({ nombre: 'Café', precioCentavos: 100_000 })
    const azucar = await crearProducto({ nombre: 'Azúcar', precioCentavos: 100_000 })

    await crearVentaDirecta({
      usuarioId: usuario.id,
      creadaEn: '2026-11-16T10:00:00-03:00',
      lineas: [
        { productoId: yerba.id, cantidad: 2, precioUnitarioCentavos: 100_000 },
        { productoId: cafe.id, cantidad: 5, precioUnitarioCentavos: 100_000 },
      ],
    })
    await crearVentaDirecta({
      usuarioId: usuario.id,
      creadaEn: '2026-11-17T10:00:00-03:00',
      lineas: [
        { productoId: yerba.id, cantidad: 1, precioUnitarioCentavos: 100_000 },
        { productoId: azucar.id, cantidad: 1, precioUnitarioCentavos: 100_000 },
      ],
    })

    const top = await topProductos({ desde: '2026-11-16', hasta: '2026-11-17' })

    expect(top).toEqual([
      { productoId: cafe.id, nombre: 'Café', cantidadVendida: 5, totalCentavos: 500_000 },
      { productoId: yerba.id, nombre: 'Yerba', cantidadVendida: 3, totalCentavos: 300_000 },
      { productoId: azucar.id, nombre: 'Azúcar', cantidadVendida: 1, totalCentavos: 100_000 },
    ])

    const soloDos = await topProductos({ desde: '2026-11-16', hasta: '2026-11-17', limite: 2 })
    expect(soloDos).toHaveLength(2)
  })
})

describe('cajaDelDia', () => {
  it('agrupa por medio de pago y calcula el gran total del día local', async () => {
    const usuario = await crearUsuario()
    const producto = await crearProducto({ precioCentavos: 100_000 })

    await crearVentaDirecta({
      usuarioId: usuario.id,
      creadaEn: '2026-11-16T09:00:00-03:00',
      medio: 'EFECTIVO',
      lineas: [{ productoId: producto.id, cantidad: 2, precioUnitarioCentavos: 100_000 }],
    })
    await crearVentaDirecta({
      usuarioId: usuario.id,
      creadaEn: '2026-11-16T15:00:00-03:00',
      medio: 'EFECTIVO',
      lineas: [{ productoId: producto.id, cantidad: 1, precioUnitarioCentavos: 100_000 }],
    })
    await crearVentaDirecta({
      usuarioId: usuario.id,
      creadaEn: '2026-11-16T20:00:00-03:00',
      medio: 'TRANSFERENCIA',
      lineas: [{ productoId: producto.id, cantidad: 4, precioUnitarioCentavos: 100_000 }],
    })
    // Día siguiente: no debe entrar en la caja del 16.
    await crearVentaDirecta({
      usuarioId: usuario.id,
      creadaEn: '2026-11-17T00:10:00-03:00',
      medio: 'EFECTIVO',
      lineas: [{ productoId: producto.id, cantidad: 9, precioUnitarioCentavos: 100_000 }],
    })

    const caja = await cajaDelDia({ fecha: '2026-11-16' })

    expect(caja).toEqual({
      fecha: '2026-11-16',
      medios: [
        { medio: 'EFECTIVO', cantidadPagos: 2, totalCentavos: 300_000 },
        { medio: 'TRANSFERENCIA', cantidadPagos: 1, totalCentavos: 400_000 },
      ],
      cantidadPagos: 3,
      granTotalCentavos: 700_000,
    })
  })

  it('devuelve una caja vacía cuando no hubo ventas', async () => {
    const caja = await cajaDelDia({ fecha: '2026-11-20' })

    expect(caja).toEqual({
      fecha: '2026-11-20',
      medios: [],
      cantidadPagos: 0,
      granTotalCentavos: 0,
    })
  })
})

describe('los reportes no arrastran ventas de otro día', () => {
  it('la venta de las 00:10 del 17 no aparece en la caja del 16', async () => {
    const usuario = await crearUsuario()
    const producto = await crearProducto({ precioCentavos: 100_000 })

    await crearVentaDirecta({
      usuarioId: usuario.id,
      creadaEn: '2026-11-17T00:10:00-03:00',
      lineas: [{ productoId: producto.id, cantidad: 1, precioUnitarioCentavos: 100_000 }],
    })

    expect(await prisma.venta.count()).toBe(1)
    const caja = await cajaDelDia({ fecha: '2026-11-16' })
    expect(caja.granTotalCentavos).toBe(0)
  })
})
