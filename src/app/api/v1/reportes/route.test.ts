import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { ScopeApi } from '../../../../../generated/prisma/enums'
import { emitirToken } from '@/server/api/tokens'
import { crearProducto, crearUsuario, crearVentaDirecta } from '@/test/fixtures'
import { GET as caja } from './caja/route'
import { GET as top } from './top-productos/route'
import { GET as porDia } from './ventas-por-dia/route'

const BASE = 'http://localhost/api/v1/reportes'

async function tokenCon(scopes: ScopeApi[]): Promise<string> {
  const usuario = await crearUsuario()
  const token = await emitirToken({ usuarioId: usuario.id, nombre: 'prueba', scopes })
  return token.claro
}

function pedido(ruta: string, token?: string): NextRequest {
  return new NextRequest(new URL(ruta, BASE), {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
}

describe('GET /api/v1/reportes/ventas-por-dia', () => {
  it('responde 401 sin token y 403 sin el scope de reportes', async () => {
    const sinToken = await porDia(pedido('/api/v1/reportes/ventas-por-dia?desde=2026-03-01&hasta=2026-03-02'))
    expect(sinToken.status).toBe(401)

    const soloProductos = await tokenCon([ScopeApi.PRODUCTOS_READ])
    const sinScope = await porDia(
      pedido('/api/v1/reportes/ventas-por-dia?desde=2026-03-01&hasta=2026-03-02', soloProductos),
    )
    expect(sinScope.status).toBe(403)
  })

  it('devuelve los días del rango, incluidos los que no tuvieron ventas', async () => {
    const token = await tokenCon([ScopeApi.REPORTES_READ])
    const usuario = await crearUsuario()
    const producto = await crearProducto({ precioCentavos: 100_000 })
    await crearVentaDirecta({
      usuarioId: usuario.id,
      creadaEn: '2026-03-02T15:00:00.000Z',
      lineas: [{ productoId: producto.id, cantidad: 2, precioUnitarioCentavos: 100_000 }],
    })

    const respuesta = await porDia(
      pedido('/api/v1/reportes/ventas-por-dia?desde=2026-03-01&hasta=2026-03-03', token),
    )
    const cuerpo = await respuesta.json()

    expect(respuesta.status).toBe(200)
    expect(cuerpo.dias).toEqual([
      { fecha: '2026-03-01', cantidadVentas: 0, totalCentavos: 0 },
      { fecha: '2026-03-02', cantidadVentas: 1, totalCentavos: 200_000 },
      { fecha: '2026-03-03', cantidadVentas: 0, totalCentavos: 0 },
    ])
  })

  it('rechaza una fecha que no existe en el calendario', async () => {
    const token = await tokenCon([ScopeApi.REPORTES_READ])

    const respuesta = await porDia(
      pedido('/api/v1/reportes/ventas-por-dia?desde=2026-02-30&hasta=2026-03-02', token),
    )
    const cuerpo = await respuesta.json()

    expect(respuesta.status).toBe(400)
    expect(cuerpo.error.message).toContain('desde')
  })

  it('rechaza un rango invertido', async () => {
    const token = await tokenCon([ScopeApi.REPORTES_READ])

    const respuesta = await porDia(
      pedido('/api/v1/reportes/ventas-por-dia?desde=2026-03-05&hasta=2026-03-01', token),
    )

    expect(respuesta.status).toBe(400)
  })

  it('rechaza un formato de fecha con barras', async () => {
    const token = await tokenCon([ScopeApi.REPORTES_READ])

    const respuesta = await porDia(
      pedido('/api/v1/reportes/ventas-por-dia?desde=01/03/2026&hasta=2026-03-02', token),
    )

    expect(respuesta.status).toBe(400)
  })
})

describe('GET /api/v1/reportes/top-productos', () => {
  it('ordena por cantidad vendida y respeta el límite', async () => {
    const token = await tokenCon([ScopeApi.REPORTES_READ])
    const usuario = await crearUsuario()
    const poco = await crearProducto({ nombre: 'Poco', precioCentavos: 100 })
    const mucho = await crearProducto({ nombre: 'Mucho', precioCentavos: 100 })

    await crearVentaDirecta({
      usuarioId: usuario.id,
      creadaEn: '2026-03-02T15:00:00.000Z',
      lineas: [
        { productoId: poco.id, cantidad: 1, precioUnitarioCentavos: 100 },
        { productoId: mucho.id, cantidad: 5, precioUnitarioCentavos: 100 },
      ],
    })

    const respuesta = await top(
      pedido('/api/v1/reportes/top-productos?desde=2026-03-01&hasta=2026-03-31&limite=1', token),
    )
    const cuerpo = await respuesta.json()

    expect(respuesta.status).toBe(200)
    expect(cuerpo.productos).toHaveLength(1)
    expect(cuerpo.productos[0]).toMatchObject({ nombre: 'Mucho', cantidadVendida: 5 })
  })
})

describe('GET /api/v1/reportes/caja', () => {
  it('agrupa los pagos por medio y suma el gran total', async () => {
    const token = await tokenCon([ScopeApi.REPORTES_READ])
    const usuario = await crearUsuario()
    const producto = await crearProducto({ precioCentavos: 50_000 })

    await crearVentaDirecta({
      usuarioId: usuario.id,
      creadaEn: '2026-03-02T15:00:00.000Z',
      lineas: [{ productoId: producto.id, cantidad: 2, precioUnitarioCentavos: 50_000 }],
      medio: 'EFECTIVO',
    })
    await crearVentaDirecta({
      usuarioId: usuario.id,
      creadaEn: '2026-03-02T18:00:00.000Z',
      lineas: [{ productoId: producto.id, cantidad: 1, precioUnitarioCentavos: 50_000 }],
      medio: 'TARJETA',
    })

    const respuesta = await caja(pedido('/api/v1/reportes/caja?fecha=2026-03-02', token))
    const cuerpo = await respuesta.json()

    expect(respuesta.status).toBe(200)
    expect(cuerpo).toEqual({
      fecha: '2026-03-02',
      medios: [
        { medio: 'EFECTIVO', cantidadPagos: 1, totalCentavos: 100_000 },
        { medio: 'TARJETA', cantidadPagos: 1, totalCentavos: 50_000 },
      ],
      cantidadPagos: 2,
      granTotalCentavos: 150_000,
    })
  })

  it('exige el parámetro fecha', async () => {
    const token = await tokenCon([ScopeApi.REPORTES_READ])

    const respuesta = await caja(pedido('/api/v1/reportes/caja', token))

    expect(respuesta.status).toBe(400)
  })
})
