import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { ScopeApi } from '../../../../../../../generated/prisma/enums'
import { emitirToken } from '@/server/api/tokens'
import { crearProducto, crearUsuario } from '@/test/fixtures'
import { POST } from './route'

const BASE = 'http://localhost/api/v1/productos'

async function tokenDeEscritura(): Promise<string> {
  const usuario = await crearUsuario()
  const token = await emitirToken({
    usuarioId: usuario.id,
    nombre: 'ajustes',
    scopes: [ScopeApi.PRODUCTOS_WRITE],
  })
  return token.claro
}

function ajuste(productoId: string, token: string, cuerpo: unknown): NextRequest {
  return new NextRequest(new URL(`${BASE}/${productoId}/ajustes`, BASE), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(cuerpo),
  })
}

/**
 * Un ajuste de 0 es un error del cliente, no del servidor.
 *
 * `ENTRADA` y `SALIDA` con cantidad 0 no mueven nada y dejarían un `MovimientoStock`
 * en cero, así que se rechazan con 400. `AJUSTE` con 0 es legítimo: fijar el stock en
 * cero es una operación real de inventario.
 */
describe('POST /api/v1/productos/{id}/ajustes con cantidad 0', () => {
  it('rechaza una salida de 0 con 400 y no deja movimiento', async () => {
    const token = await tokenDeEscritura()
    const producto = await crearProducto({ precioCentavos: 100_000, stock: 5 })

    const respuesta = await POST(ajuste(producto.id, token, { tipo: 'SALIDA', cantidad: 0 }), {
      params: Promise.resolve({ id: producto.id }),
    })

    expect(respuesta.status).toBe(400)
    expect(await respuesta.json()).toMatchObject({
      error: { code: 'cuerpo_invalido' },
    })
    expect(await prisma.movimientoStock.count()).toBe(0)
    expect((await prisma.producto.findUniqueOrThrow({ where: { id: producto.id } })).stock).toBe(5)
  })

  it('rechaza una entrada de 0 con 400', async () => {
    const token = await tokenDeEscritura()
    const producto = await crearProducto({ precioCentavos: 100_000, stock: 5 })

    const respuesta = await POST(ajuste(producto.id, token, { tipo: 'ENTRADA', cantidad: 0 }), {
      params: Promise.resolve({ id: producto.id }),
    })

    expect(respuesta.status).toBe(400)
    expect(await prisma.movimientoStock.count()).toBe(0)
  })

  it('acepta un ajuste a 0: fijar el stock en cero es una operación real', async () => {
    const token = await tokenDeEscritura()
    const producto = await crearProducto({ precioCentavos: 100_000, stock: 5 })

    const respuesta = await POST(ajuste(producto.id, token, { tipo: 'AJUSTE', cantidad: 0 }), {
      params: Promise.resolve({ id: producto.id }),
    })

    expect(respuesta.status).toBe(200)
    expect(await respuesta.json()).toMatchObject({ stockAnterior: 5, stock: 0 })
    expect(await prisma.movimientoStock.count()).toBe(1)
  })
})
