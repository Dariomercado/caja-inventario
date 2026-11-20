import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { ScopeApi } from '../../../../generated/prisma/enums'
import { emitirToken } from '@/server/api/tokens'
import { crearUsuario } from '@/test/fixtures'
import { GET, POST } from './ventas/route'

const BASE = 'http://localhost/api/v1/ventas'

/**
 * Alcance de un token: la tienda, no el usuario.
 *
 * El esquema no tiene noción de negocio —`Producto` y `Usuario` no cuelgan de nada—
 * así que esto es una sola tienda: un token lee el catálogo y las ventas de todos, y
 * las escrituras quedan atribuidas a su usuario. La caja del día es la del negocio,
 * no la de una persona, y por eso los reportes no filtran.
 *
 * Está declarado en la descripción del documento OpenAPI y clavado acá: el día que
 * haya varias tiendas, este test falla primero y obliga a decidir el filtro a
 * conciencia en lugar de descubrirlo por un dato que falta.
 */
describe('alcance de un token', () => {
  it('lee las ventas que registró otro usuario de la misma tienda', async () => {
    const vendedor = await crearUsuario()
    const cajero = await crearUsuario()
    const producto = await prisma.producto.create({
      data: { sku: 'SKU-ALC-1', nombre: 'Azúcar', precioCentavos: 100_000, stock: 5 },
    })

    const tokenVendedor = await emitirToken({
      usuarioId: vendedor.id,
      nombre: 'vendedor',
      scopes: [ScopeApi.VENTAS_WRITE],
    })
    const tokenCajero = await emitirToken({
      usuarioId: cajero.id,
      nombre: 'cajero',
      scopes: [ScopeApi.VENTAS_READ],
    })

    const alta = await POST(
      new NextRequest(new URL('/api/v1/ventas', BASE), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tokenVendedor.claro}`,
          'content-type': 'application/json',
          'idempotency-key': 'clave-alcance-1',
        },
        body: JSON.stringify({
          items: [{ productoId: producto.id, cantidad: 1 }],
          medioPago: 'EFECTIVO',
        }),
      }),
    )
    expect(alta.status).toBe(201)

    const listado = await GET(
      new NextRequest(new URL('/api/v1/ventas', BASE), {
        headers: { authorization: `Bearer ${tokenCajero.claro}` },
      }),
    )
    expect(listado.status).toBe(200)

    const cuerpo = (await listado.json()) as { ventas: { numero: number }[] }
    expect(cuerpo.ventas.map((venta) => venta.numero)).toEqual([1])
  })
})
