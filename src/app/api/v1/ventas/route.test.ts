import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { ScopeApi } from '../../../../../generated/prisma/enums'
import { emitirToken } from '@/server/api/tokens'
import { crearUsuario } from '@/test/fixtures'
import { GET as verVenta } from './[id]/route'
import { GET, POST } from './route'

const BASE = 'http://localhost/api/v1/ventas'

async function tokenCon(scopes: ScopeApi[]): Promise<string> {
  const usuario = await crearUsuario()
  const token = await emitirToken({ usuarioId: usuario.id, nombre: 'prueba', scopes })
  return token.claro
}

function pedido(
  ruta: string,
  opciones: { token?: string; method?: string; body?: unknown; clave?: string } = {},
): NextRequest {
  const headers: Record<string, string> = {}
  if (opciones.token) headers['authorization'] = `Bearer ${opciones.token}`
  if (opciones.body !== undefined) headers['content-type'] = 'application/json'
  if (opciones.clave !== undefined) headers['idempotency-key'] = opciones.clave

  return new NextRequest(new URL(ruta, BASE), {
    method: opciones.method ?? 'GET',
    headers,
    ...(opciones.body === undefined ? {} : { body: JSON.stringify(opciones.body) }),
  })
}

async function productoConStock(stock: number, precioCentavos = 100_000) {
  return prisma.producto.create({
    data: { sku: `SKU-${Math.random().toString(36).slice(2, 8)}`, nombre: 'Azúcar', precioCentavos, stock },
  })
}

describe('POST /api/v1/ventas', () => {
  it('exige Idempotency-Key y no registra nada sin ella', async () => {
    const token = await tokenCon([ScopeApi.VENTAS_WRITE])
    const producto = await productoConStock(10)

    const respuesta = await POST(
      pedido('/api/v1/ventas', {
        token,
        method: 'POST',
        body: { items: [{ productoId: producto.id, cantidad: 1 }], medioPago: 'EFECTIVO' },
      }),
    )

    expect(respuesta.status).toBe(400)
    expect(await prisma.venta.count()).toBe(0)
    expect((await prisma.producto.findUniqueOrThrow({ where: { id: producto.id } })).stock).toBe(10)
  })

  it('registra la venta, descuenta stock y responde 201', async () => {
    const token = await tokenCon([ScopeApi.VENTAS_WRITE])
    const producto = await productoConStock(10, 150_000)

    const respuesta = await POST(
      pedido('/api/v1/ventas', {
        token,
        method: 'POST',
        clave: 'intento-1',
        body: { items: [{ productoId: producto.id, cantidad: 2 }], medioPago: 'EFECTIVO' },
      }),
    )

    expect(respuesta.status).toBe(201)
    await expect(respuesta.json()).resolves.toEqual({
      id: expect.any(String),
      numero: expect.any(Number),
      totalCentavos: 300_000,
    })
    expect((await prisma.producto.findUniqueOrThrow({ where: { id: producto.id } })).stock).toBe(8)
  })

  it('un reenvío con la misma clave responde 200 y no descuenta stock dos veces', async () => {
    const token = await tokenCon([ScopeApi.VENTAS_WRITE])
    const producto = await productoConStock(10)
    const cuerpo = { items: [{ productoId: producto.id, cantidad: 2 }], medioPago: 'EFECTIVO' }

    const primera = await POST(
      pedido('/api/v1/ventas', { token, method: 'POST', clave: 'misma', body: cuerpo }),
    )
    const segunda = await POST(
      pedido('/api/v1/ventas', { token, method: 'POST', clave: 'misma', body: cuerpo }),
    )

    expect(primera.status).toBe(201)
    expect(segunda.status).toBe(200)
    // El cuerpo es el mismo: es la misma venta, no una segunda.
    await expect(segunda.json()).resolves.toEqual(await primera.json())
    expect(await prisma.venta.count()).toBe(1)
    expect((await prisma.producto.findUniqueOrThrow({ where: { id: producto.id } })).stock).toBe(8)
  })

  it('reusar la clave con otro carrito responde 409 sin tocar el stock', async () => {
    const token = await tokenCon([ScopeApi.VENTAS_WRITE])
    const producto = await productoConStock(10)

    await POST(
      pedido('/api/v1/ventas', {
        token,
        method: 'POST',
        clave: 'reusada',
        body: { items: [{ productoId: producto.id, cantidad: 1 }], medioPago: 'EFECTIVO' },
      }),
    )
    const otra = await POST(
      pedido('/api/v1/ventas', {
        token,
        method: 'POST',
        clave: 'reusada',
        body: { items: [{ productoId: producto.id, cantidad: 3 }], medioPago: 'EFECTIVO' },
      }),
    )

    expect(otra.status).toBe(409)
    await expect(otra.json()).resolves.toMatchObject({ error: { code: 'clave_reutilizada' } })
    expect((await prisma.producto.findUniqueOrThrow({ where: { id: producto.id } })).stock).toBe(9)
  })

  it('responde 409 con el disponible cuando no alcanza el stock', async () => {
    const token = await tokenCon([ScopeApi.VENTAS_WRITE])
    const producto = await productoConStock(2)

    const respuesta = await POST(
      pedido('/api/v1/ventas', {
        token,
        method: 'POST',
        clave: 'sin-stock',
        body: { items: [{ productoId: producto.id, cantidad: 5 }], medioPago: 'EFECTIVO' },
      }),
    )
    const cuerpo = await respuesta.json()

    expect(respuesta.status).toBe(409)
    expect(cuerpo.error.code).toBe('stock_insuficiente')
    expect(cuerpo.error.message).toContain('2')
    expect(await prisma.venta.count()).toBe(0)
  })

  it('responde 403 con un token de lectura y no vende', async () => {
    const token = await tokenCon([ScopeApi.VENTAS_READ])
    const producto = await productoConStock(5)

    const respuesta = await POST(
      pedido('/api/v1/ventas', {
        token,
        method: 'POST',
        clave: 'sin-permiso',
        body: { items: [{ productoId: producto.id, cantidad: 1 }], medioPago: 'EFECTIVO' },
      }),
    )

    expect(respuesta.status).toBe(403)
    expect(await prisma.venta.count()).toBe(0)
    expect((await prisma.producto.findUniqueOrThrow({ where: { id: producto.id } })).stock).toBe(5)
  })

  it('responde 404 cuando el producto del carrito no existe, no 500', async () => {
    const token = await tokenCon([ScopeApi.VENTAS_WRITE])

    const respuesta = await POST(
      pedido('/api/v1/ventas', {
        token,
        method: 'POST',
        clave: 'producto-fantasma',
        body: { items: [{ productoId: 'no-existe', cantidad: 1 }], medioPago: 'EFECTIVO' },
      }),
    )

    // Un id que el cliente inventó es un dato inválido, no un defecto del servidor:
    // devolver 500 haría que el consumidor reintentara algo que nunca va a funcionar.
    expect(respuesta.status).toBe(404)
    await expect(respuesta.json()).resolves.toMatchObject({ error: { code: 'no_encontrado' } })
    expect(await prisma.venta.count()).toBe(0)
  })

  it('responde 409 cuando el producto está inactivo', async () => {
    const token = await tokenCon([ScopeApi.VENTAS_WRITE])
    const producto = await productoConStock(5)
    await prisma.producto.update({ where: { id: producto.id }, data: { activo: false } })

    const respuesta = await POST(
      pedido('/api/v1/ventas', {
        token,
        method: 'POST',
        clave: 'producto-inactivo',
        body: { items: [{ productoId: producto.id, cantidad: 1 }], medioPago: 'EFECTIVO' },
      }),
    )

    expect(respuesta.status).toBe(409)
    await expect(respuesta.json()).resolves.toMatchObject({ error: { code: 'conflicto' } })
    expect(await prisma.venta.count()).toBe(0)
  })

  it('responde 400 si se mandan pagos y medioPago a la vez', async () => {
    const token = await tokenCon([ScopeApi.VENTAS_WRITE])
    const producto = await productoConStock(5)

    const respuesta = await POST(
      pedido('/api/v1/ventas', {
        token,
        method: 'POST',
        clave: 'ambos',
        body: {
          items: [{ productoId: producto.id, cantidad: 1 }],
          medioPago: 'EFECTIVO',
          pagos: [{ medio: 'EFECTIVO', montoCentavos: 100_000 }],
        },
      }),
    )

    expect(respuesta.status).toBe(400)
  })
})

describe('GET /api/v1/ventas', () => {
  it('lista de la más nueva a la más vieja y pagina por número', async () => {
    const token = await tokenCon([ScopeApi.VENTAS_READ, ScopeApi.VENTAS_WRITE])
    const producto = await productoConStock(10)

    for (let i = 0; i < 3; i += 1) {
      await POST(
        pedido('/api/v1/ventas', {
          token,
          method: 'POST',
          clave: `venta-${i}`,
          body: { items: [{ productoId: producto.id, cantidad: 1 }], medioPago: 'EFECTIVO' },
        }),
      )
    }

    const primera = await GET(pedido('/api/v1/ventas?limite=2', { token }))
    const cuerpo = await primera.json()

    expect(primera.status).toBe(200)
    expect(cuerpo.ventas).toHaveLength(2)
    expect(cuerpo.ventas[0].numero).toBeGreaterThan(cuerpo.ventas[1].numero)
    expect(cuerpo.siguienteCursor).toBe(cuerpo.ventas[1].numero)

    const segunda = await GET(
      pedido(`/api/v1/ventas?limite=2&cursor=${cuerpo.siguienteCursor}`, { token }),
    )
    const resto = await segunda.json()
    expect(resto.ventas).toHaveLength(1)
    expect(resto.siguienteCursor).toBeNull()
  })

  it('responde 400 con un cursor que no es un entero positivo', async () => {
    const token = await tokenCon([ScopeApi.VENTAS_READ])

    const respuesta = await GET(pedido('/api/v1/ventas?cursor=abc', { token }))

    expect(respuesta.status).toBe(400)
  })
})

describe('GET /api/v1/ventas/:id', () => {
  it('devuelve líneas y pagos del comprobante', async () => {
    const token = await tokenCon([ScopeApi.VENTAS_READ, ScopeApi.VENTAS_WRITE])
    const producto = await productoConStock(10, 120_000)

    const creada = await POST(
      pedido('/api/v1/ventas', {
        token,
        method: 'POST',
        clave: 'detalle',
        body: { items: [{ productoId: producto.id, cantidad: 2 }], medioPago: 'TRANSFERENCIA' },
      }),
    )
    const { id } = await creada.json()

    const respuesta = await verVenta(pedido(`/api/v1/ventas/${id}`, { token }), {
      params: Promise.resolve({ id }),
    })
    const venta = await respuesta.json()

    expect(respuesta.status).toBe(200)
    expect(venta.totalCentavos).toBe(240_000)
    expect(venta.lineas).toEqual([
      {
        productoId: producto.id,
        nombre: 'Azúcar',
        cantidad: 2,
        precioUnitarioCentavos: 120_000,
        subtotalCentavos: 240_000,
      },
    ])
    expect(venta.pagos).toEqual([{ medio: 'TRANSFERENCIA', montoCentavos: 240_000 }])
  })

  it('responde 404 con un id inexistente', async () => {
    const token = await tokenCon([ScopeApi.VENTAS_READ])

    const respuesta = await verVenta(pedido('/api/v1/ventas/no-existe', { token }), {
      params: Promise.resolve({ id: 'no-existe' }),
    })

    expect(respuesta.status).toBe(404)
  })
})
