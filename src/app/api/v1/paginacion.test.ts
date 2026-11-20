import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { ScopeApi } from '../../../../generated/prisma/enums'
import { emitirToken } from '@/server/api/tokens'
import { crearProducto, crearUsuario } from '@/test/fixtures'
import { GET } from './productos/route'

const BASE = 'http://localhost/api/v1/productos'

/**
 * El hallazgo decía que un cursor vencido devuelve el 500 genérico de Next. La
 * consulta ya devuelve página vacía, así que esto lo verifica en el borde donde el
 * cliente lo vería: 200, lista vacía y sin `siguienteCursor`.
 */
describe('GET /api/v1/productos con un cursor que ya no existe', () => {
  it('responde 200 con la página vacía', async () => {
    const usuario = await crearUsuario()
    const token = await emitirToken({
      usuarioId: usuario.id,
      nombre: 'paginacion',
      scopes: [ScopeApi.PRODUCTOS_READ],
    })
    await crearProducto({ precioCentavos: 100_000, stock: 1 })

    const respuesta = await GET(
      new NextRequest(new URL(`${BASE}?cursor=no-existe`, BASE), {
        headers: { authorization: `Bearer ${token.claro}` },
      }),
    )

    expect(respuesta.status).toBe(200)
    expect(await respuesta.json()).toEqual({ productos: [], siguienteCursor: null })
  })
})
