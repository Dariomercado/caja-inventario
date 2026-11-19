import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { ScopeApi } from '../../../../../generated/prisma/enums'
import { emitirToken } from '@/server/api/tokens'
import { crearUsuario } from '@/test/fixtures'
import { POST as ajustar } from './[id]/ajustes/route'
import { PATCH as actualizar } from './[id]/route'
import { GET, POST } from './route'

const BASE = 'http://localhost/api/v1/productos'

async function tokenCon(scopes: ScopeApi[]): Promise<string> {
  const usuario = await crearUsuario()
  const token = await emitirToken({ usuarioId: usuario.id, nombre: 'prueba', scopes })
  return token.claro
}

function pedido(
  ruta: string,
  opciones: { token?: string; method?: string; body?: unknown } = {},
): NextRequest {
  const headers: Record<string, string> = {}
  if (opciones.token) headers['authorization'] = `Bearer ${opciones.token}`
  if (opciones.body !== undefined) headers['content-type'] = 'application/json'

  return new NextRequest(new URL(ruta, BASE), {
    method: opciones.method ?? 'GET',
    headers,
    ...(opciones.body === undefined ? {} : { body: JSON.stringify(opciones.body) }),
  })
}

describe('GET /api/v1/productos', () => {
  it('responde 401 sin token', async () => {
    const respuesta = await GET(pedido('/api/v1/productos'))

    expect(respuesta.status).toBe(401)
    await expect(respuesta.json()).resolves.toMatchObject({
      error: { code: 'no_autenticado' },
    })
  })

  it('lista el catálogo con un token de lectura', async () => {
    const token = await tokenCon([ScopeApi.PRODUCTOS_READ])
    await prisma.producto.create({
      data: { sku: 'AZU-001', nombre: 'Azúcar', precioCentavos: 180_000, stock: 5 },
    })

    const respuesta = await GET(pedido('/api/v1/productos', { token }))

    expect(respuesta.status).toBe(200)
    await expect(respuesta.json()).resolves.toEqual({
      productos: [
        {
          id: expect.any(String),
          sku: 'AZU-001',
          nombre: 'Azúcar',
          precioCentavos: 180_000,
          stock: 5,
          activo: true,
        },
      ],
      siguienteCursor: null,
    })
  })

  it('rechaza un límite fuera de rango con el campo nombrado', async () => {
    const token = await tokenCon([ScopeApi.PRODUCTOS_READ])

    const respuesta = await GET(pedido('/api/v1/productos?limite=0', { token }))
    const cuerpo = await respuesta.json()

    expect(respuesta.status).toBe(400)
    expect(cuerpo.error.code).toBe('cuerpo_invalido')
    expect(cuerpo.error.message).toContain('limite')
  })
})

describe('POST /api/v1/productos', () => {
  it('crea con un token de escritura y responde 201', async () => {
    const token = await tokenCon([ScopeApi.PRODUCTOS_WRITE])

    const respuesta = await POST(
      pedido('/api/v1/productos', {
        token,
        method: 'POST',
        body: { sku: 'FLA-001', nombre: 'Fideos', precioCentavos: 95_000 },
      }),
    )

    expect(respuesta.status).toBe(201)
    await expect(respuesta.json()).resolves.toMatchObject({ sku: 'FLA-001', stock: 0 })
  })

  it('responde 403 con un token de sólo lectura y no crea nada', async () => {
    const token = await tokenCon([ScopeApi.PRODUCTOS_READ])

    const respuesta = await POST(
      pedido('/api/v1/productos', {
        token,
        method: 'POST',
        body: { sku: 'FLA-002', nombre: 'Fideos', precioCentavos: 95_000 },
      }),
    )

    expect(respuesta.status).toBe(403)
    // El efecto no ocurrió: no alcanza con mirar el status.
    expect(await prisma.producto.count()).toBe(0)
  })

  it('responde 400 si falta un campo obligatorio', async () => {
    const token = await tokenCon([ScopeApi.PRODUCTOS_WRITE])

    const respuesta = await POST(
      pedido('/api/v1/productos', {
        token,
        method: 'POST',
        body: { sku: 'FLA-003', precioCentavos: 1000 },
      }),
    )
    const cuerpo = await respuesta.json()

    expect(respuesta.status).toBe(400)
    expect(cuerpo.error.message).toContain('nombre')
  })

  it('responde 409 con un SKU ya usado', async () => {
    const token = await tokenCon([ScopeApi.PRODUCTOS_WRITE])
    const cuerpo = { sku: 'AZU-001', nombre: 'Azúcar', precioCentavos: 180_000 }

    await POST(pedido('/api/v1/productos', { token, method: 'POST', body: cuerpo }))
    const repetido = await POST(
      pedido('/api/v1/productos', { token, method: 'POST', body: cuerpo }),
    )

    expect(repetido.status).toBe(409)
    await expect(repetido.json()).resolves.toMatchObject({ error: { code: 'conflicto' } })
  })
})

describe('PATCH /api/v1/productos/:id', () => {
  it('actualiza un campo y devuelve el producto', async () => {
    const token = await tokenCon([ScopeApi.PRODUCTOS_WRITE])
    const producto = await prisma.producto.create({
      data: { sku: 'AZU-001', nombre: 'Viejo', precioCentavos: 100, stock: 1 },
    })

    const respuesta = await actualizar(
      pedido(`/api/v1/productos/${producto.id}`, {
        token,
        method: 'PATCH',
        body: { nombre: 'Nuevo' },
      }),
      { params: Promise.resolve({ id: producto.id }) },
    )

    expect(respuesta.status).toBe(200)
    await expect(respuesta.json()).resolves.toMatchObject({ nombre: 'Nuevo' })
  })

  it('responde 404 con un id inexistente', async () => {
    const token = await tokenCon([ScopeApi.PRODUCTOS_WRITE])

    const respuesta = await actualizar(
      pedido('/api/v1/productos/no-existe', { token, method: 'PATCH', body: { nombre: 'X' } }),
      { params: Promise.resolve({ id: 'no-existe' }) },
    )

    expect(respuesta.status).toBe(404)
  })

  it('responde 400 con un cuerpo vacío', async () => {
    const token = await tokenCon([ScopeApi.PRODUCTOS_WRITE])
    const producto = await prisma.producto.create({
      data: { sku: 'AZU-002', nombre: 'Azúcar', precioCentavos: 100 },
    })

    const respuesta = await actualizar(
      pedido(`/api/v1/productos/${producto.id}`, { token, method: 'PATCH', body: {} }),
      { params: Promise.resolve({ id: producto.id }) },
    )

    expect(respuesta.status).toBe(400)
  })
})

describe('POST /api/v1/productos/:id/ajustes', () => {
  it('mueve el stock y devuelve el antes y el después', async () => {
    const token = await tokenCon([ScopeApi.PRODUCTOS_WRITE])
    const producto = await prisma.producto.create({
      data: { sku: 'AZU-003', nombre: 'Azúcar', precioCentavos: 100, stock: 7 },
    })

    const respuesta = await ajustar(
      pedido(`/api/v1/productos/${producto.id}/ajustes`, {
        token,
        method: 'POST',
        body: { tipo: 'ENTRADA', cantidad: 3, motivo: 'Compra' },
      }),
      { params: Promise.resolve({ id: producto.id }) },
    )

    expect(respuesta.status).toBe(200)
    await expect(respuesta.json()).resolves.toEqual({
      productoId: producto.id,
      stockAnterior: 7,
      stock: 10,
    })
  })

  it('responde 409 cuando la salida supera el stock disponible', async () => {
    const token = await tokenCon([ScopeApi.PRODUCTOS_WRITE])
    const producto = await prisma.producto.create({
      data: { sku: 'AZU-004', nombre: 'Azúcar', precioCentavos: 100, stock: 2 },
    })

    const respuesta = await ajustar(
      pedido(`/api/v1/productos/${producto.id}/ajustes`, {
        token,
        method: 'POST',
        body: { tipo: 'SALIDA', cantidad: 5 },
      }),
      { params: Promise.resolve({ id: producto.id }) },
    )

    expect(respuesta.status).toBe(409)
    await expect(respuesta.json()).resolves.toMatchObject({
      error: { code: 'stock_insuficiente' },
    })
  })

  it('responde 403 con token de lectura sin tocar el stock', async () => {
    const token = await tokenCon([ScopeApi.PRODUCTOS_READ])
    const producto = await prisma.producto.create({
      data: { sku: 'AZU-005', nombre: 'Azúcar', precioCentavos: 100, stock: 2 },
    })

    const respuesta = await ajustar(
      pedido(`/api/v1/productos/${producto.id}/ajustes`, {
        token,
        method: 'POST',
        body: { tipo: 'ENTRADA', cantidad: 5 },
      }),
      { params: Promise.resolve({ id: producto.id }) },
    )

    expect(respuesta.status).toBe(403)
    const fila = await prisma.producto.findUniqueOrThrow({ where: { id: producto.id } })
    expect(fila.stock).toBe(2)
    expect(await prisma.movimientoStock.count()).toBe(0)
  })
})
