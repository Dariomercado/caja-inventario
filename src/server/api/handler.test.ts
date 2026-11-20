import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ScopeApi } from '../../../generated/prisma/enums'

vi.mock('./auth', () => ({ autenticar: vi.fn() }))
vi.mock('./limite', () => ({ consumirCupo: vi.fn() }))

import { autenticar } from './auth'
import { ejecutarAutenticado } from './handler'
import { consumirCupo } from './limite'

const peticion = () => new Request('http://localhost/api/v1/productos')

const TOKEN = { id: 'tok_1', usuarioId: 'usr_1', limitePorMinuto: 60 }

/**
 * El sobre de error es parte del contrato: un cliente ramifica por `code`. Cuando la
 * base falla durante la autenticación o el descuento de cupo, el `try` de la acción
 * no lo atrapaba y el cliente recibía el 500 por defecto de Next, que no es JSON. Eso
 * rompe el contrato exactamente durante el incidente, que es cuando el cliente más
 * necesita un código con el que decidir.
 */
describe('ejecutarAutenticado ante fallos de infraestructura', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('un fallo de base al autenticar devuelve el sobre, no el 500 de Next', async () => {
    vi.mocked(autenticar).mockRejectedValue(new Error('connect ECONNREFUSED'))

    const respuesta = await ejecutarAutenticado(peticion(), ScopeApi.PRODUCTOS_READ, async () => {
      throw new Error('la acción no debería ejecutarse')
    })

    expect(respuesta.status).toBe(500)
    expect(await respuesta.json()).toEqual({ error: { code: 'interno', message: 'Error interno.' } })
  })

  it('un fallo de base al descontar cupo devuelve el mismo sobre', async () => {
    vi.mocked(autenticar).mockResolvedValue({ ok: true, token: TOKEN } as never)
    vi.mocked(consumirCupo).mockRejectedValue(new Error('timeout'))

    const respuesta = await ejecutarAutenticado(peticion(), ScopeApi.PRODUCTOS_READ, async () => {
      throw new Error('la acción no debería ejecutarse')
    })

    expect(respuesta.status).toBe(500)
    expect(await respuesta.json()).toEqual({ error: { code: 'interno', message: 'Error interno.' } })
  })

  it('con la base sana deja pasar la respuesta de la acción', async () => {
    vi.mocked(autenticar).mockResolvedValue({ ok: true, token: TOKEN } as never)
    vi.mocked(consumirCupo).mockResolvedValue({ permitido: true } as never)

    const respuesta = await ejecutarAutenticado(peticion(), ScopeApi.PRODUCTOS_READ, async () =>
      NextResponse.json({ productos: [] }),
    )

    expect(respuesta.status).toBe(200)
    expect(await respuesta.json()).toEqual({ productos: [] })
  })
})
