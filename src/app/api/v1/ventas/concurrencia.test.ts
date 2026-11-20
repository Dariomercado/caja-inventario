import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { ScopeApi } from '../../../../../generated/prisma/enums'
import { documentoOpenAPI } from '@/server/api/openapi'
import { esquemaVentaRegistrada } from '@/server/api/esquemas'
import { emitirToken } from '@/server/api/tokens'
import { crearUsuario } from '@/test/fixtures'
import { POST } from './route'

const BASE = 'http://localhost/api/v1/ventas'

/**
 * La carrera que importa: un cliente que reintenta después de un timeout de red.
 *
 * La garantía de S5 no es "no se duplica la venta" —de eso se encarga el índice
 * único— sino que el reintento reciba **la venta que ya existe** y no un 500. Un 5xx
 * en un pedido cuyo efecto sí ocurrió deja al cliente sin forma de distinguir "no
 * pasó nada" de "pasó y no te lo puedo decir".
 */
describe('POST /api/v1/ventas bajo concurrencia', () => {
  it('ocho reintentos simultáneos con la misma clave no devuelven ningún 5xx', async () => {
    const usuario = await crearUsuario()
    const token = await emitirToken({
      usuarioId: usuario.id,
      nombre: 'concurrencia',
      scopes: [ScopeApi.VENTAS_WRITE],
    })
    const producto = await prisma.producto.create({
      data: { sku: 'SKU-CONC-1', nombre: 'Azúcar', precioCentavos: 100_000, stock: 10 },
    })
    const cuerpo = JSON.stringify({
      items: [{ productoId: producto.id, cantidad: 2 }],
      medioPago: 'EFECTIVO',
    })

    const respuestas = await Promise.all(
      Array.from({ length: 8 }, () =>
        POST(
          new NextRequest(new URL('/api/v1/ventas', BASE), {
            method: 'POST',
            headers: {
              authorization: `Bearer ${token.claro}`,
              'content-type': 'application/json',
              'idempotency-key': 'clave-concurrente-1',
            },
            body: cuerpo,
          }),
        ),
      ),
    )

    const estados = respuestas.map((respuesta) => respuesta.status)

    expect(estados.filter((estado) => estado >= 500)).toEqual([])
    // Uno crea (201) y los demás devuelven la misma venta (200).
    expect([...new Set(estados)].sort()).toEqual([200, 201])

    const numeros = await Promise.all(
      respuestas.map(async (respuesta) => ((await respuesta.json()) as { numero: number }).numero),
    )
    expect(new Set(numeros).size).toBe(1)

    expect(await prisma.venta.count()).toBe(1)
    expect(await prisma.movimientoStock.count()).toBe(1)
    expect(
      (await prisma.producto.findUniqueOrThrow({ where: { id: producto.id } })).stock,
    ).toBe(8)
  })

  it('el documento declara exactamente el cuerpo que el endpoint devuelve', async () => {
    const usuario = await crearUsuario()
    const token = await emitirToken({
      usuarioId: usuario.id,
      nombre: 'documento',
      scopes: [ScopeApi.VENTAS_WRITE],
    })
    const producto = await prisma.producto.create({
      data: { sku: 'SKU-DOC-1', nombre: 'Azúcar', precioCentavos: 100_000, stock: 4 },
    })

    const respuesta = await POST(
      new NextRequest(new URL('/api/v1/ventas', BASE), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token.claro}`,
          'content-type': 'application/json',
          'idempotency-key': 'clave-documento-1',
        },
        body: JSON.stringify({
          items: [{ productoId: producto.id, cantidad: 1 }],
          medioPago: 'EFECTIVO',
        }),
      }),
    )

    expect(respuesta.status).toBe(201)
    const cuerpo = (await respuesta.json()) as Record<string, unknown>

    // El esquema de salida tiene que aceptar el cuerpo real: si el handler agrega o
    // quita un campo, esto falla.
    expect(esquemaVentaRegistrada.safeParse(cuerpo).success).toBe(true)

    // Y el documento publicado tiene que declarar esas mismas propiedades. Antes
    // declaraba `esquemaVentaDetalle` y prometía `lineas` y `pagos` que el endpoint
    // nunca manda; el test cruzaba rutas, no cuerpos, así que mentía en silencio.
    const documento = documentoOpenAPI() as {
      paths: Record<
        string,
        {
          post: {
            responses: Record<
              string,
              { content: Record<string, { schema: { properties?: Record<string, unknown> } }> }
            >
          }
        }
      >
    }
    const declarado =
      documento.paths['/ventas'].post.responses['201'].content['application/json'].schema

    expect(Object.keys(declarado.properties ?? {}).sort()).toEqual(
      Object.keys(cuerpo).sort(),
    )
  })
})
