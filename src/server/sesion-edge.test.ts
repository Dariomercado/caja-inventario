import { beforeAll, describe, expect, it } from 'vitest'
import { firmarSesion } from './auth'
import { leerSesionEdge } from './sesion-edge'

// El middleware firma/valida con Web Crypto (runtime Edge) y el resto de la app con
// node:crypto. Si los dos formatos se separan, el login emite tokens que el guard
// rechaza y nadie puede entrar. Este test cruza las dos implementaciones.
beforeAll(() => {
  process.env.SESSION_SECRET = 'b'.repeat(64)
})

describe('leerSesionEdge contra la firma de auth.ts (node:crypto)', () => {
  it('acepta un token emitido por el firmador de Node', async () => {
    const valor = firmarSesion('usuario-1')
    await expect(leerSesionEdge(valor)).resolves.toEqual({ userId: 'usuario-1' })
  })

  it('rechaza un payload válido con firma ajena', async () => {
    const [, firma] = firmarSesion('usuario-1').split('.')
    const payloadFalso = Buffer.from(
      JSON.stringify({ sub: 'usuario-2', exp: Date.now() + 60_000 }),
    ).toString('base64url')

    await expect(leerSesionEdge(`${payloadFalso}.${firma}`)).resolves.toBeNull()
  })

  it('rechaza un token vencido', async () => {
    const hace8Horas = Date.now() - 8 * 60 * 60 * 1000
    const valor = firmarSesion('usuario-1', { duracionMs: 60_000, ahora: hace8Horas })

    await expect(leerSesionEdge(valor)).resolves.toBeNull()
  })

  it('rechaza basura sin lanzar', async () => {
    await expect(leerSesionEdge('')).resolves.toBeNull()
    await expect(leerSesionEdge('sin.puntos')).resolves.toBeNull()
    await expect(leerSesionEdge('a.b.c')).resolves.toBeNull()
  })

  it('falla cerrado sin secreto', async () => {
    const valor = firmarSesion('usuario-1')
    const original = process.env.SESSION_SECRET
    delete process.env.SESSION_SECRET
    try {
      await expect(leerSesionEdge(valor)).resolves.toBeNull()
    } finally {
      process.env.SESSION_SECRET = original
    }
  })
})
