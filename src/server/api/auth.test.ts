import { describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { crearUsuario } from '@/test/fixtures'
import { ScopeApi } from '../../../generated/prisma/enums'
import { autenticar } from './auth'
import { emitirToken, revocarToken } from './tokens'

async function emitir(scopes: ScopeApi[]) {
  const usuario = await crearUsuario()
  return emitirToken({ usuarioId: usuario.id, nombre: 'prueba', scopes })
}

function pedido(token?: string): Request {
  return new Request('http://localhost/api/v1/productos', {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  })
}

describe('autenticar', () => {
  it('acepta un token con el scope pedido y devuelve su dueño', async () => {
    const token = await emitir([ScopeApi.PRODUCTOS_READ])

    const resultado = await autenticar(pedido(token.claro), ScopeApi.PRODUCTOS_READ)

    expect(resultado.ok).toBe(true)
    if (resultado.ok) expect(resultado.token.id).toBe(token.id)
  })

  it('responde 401 sin token, con el esquema Bearer anunciado', async () => {
    const resultado = await autenticar(pedido(), ScopeApi.PRODUCTOS_READ)

    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    expect(resultado.respuesta.status).toBe(401)
    expect(resultado.respuesta.headers.get('www-authenticate')).toBe('Bearer')
    await expect(resultado.respuesta.json()).resolves.toEqual({
      error: { code: 'no_autenticado', message: expect.any(String) },
    })
  })

  it('responde 403 cuando el token es válido pero no alcanza el scope', async () => {
    const token = await emitir([ScopeApi.PRODUCTOS_READ])

    // El caso que protege S4: un token de lectura no puede operar una escritura.
    const resultado = await autenticar(pedido(token.claro), ScopeApi.PRODUCTOS_WRITE)

    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    expect(resultado.respuesta.status).toBe(403)
    await expect(resultado.respuesta.json()).resolves.toEqual({
      error: { code: 'scope_insuficiente', message: expect.any(String) },
    })
  })

  it('responde 401, no 403, cuando el token fue revocado', async () => {
    const token = await emitir([ScopeApi.PRODUCTOS_WRITE])
    await revocarToken(token.id)

    const resultado = await autenticar(pedido(token.claro), ScopeApi.PRODUCTOS_WRITE)

    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    // Un token revocado no está "autorizado de menos": ya no es una identidad.
    expect(resultado.respuesta.status).toBe(401)
  })

  it('responde 401 cuando el token venció, aunque el scope alcance', async () => {
    const token = await emitir([ScopeApi.PRODUCTOS_READ])
    await prisma.tokenApi.update({
      where: { id: token.id },
      data: { expiraEn: new Date(Date.now() - 1) },
    })

    const resultado = await autenticar(pedido(token.claro), ScopeApi.PRODUCTOS_READ)

    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    expect(resultado.respuesta.status).toBe(401)
  })

  it('responde 401 con un token de otro formato y no filtra el motivo', async () => {
    const resultado = await autenticar(pedido('no-es-un-token'), ScopeApi.PRODUCTOS_READ)

    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    const cuerpo = await resultado.respuesta.text()
    expect(resultado.respuesta.status).toBe(401)
    // El mensaje es el mismo para todas las causas: no se revela cuál falló.
    expect(cuerpo).not.toContain('vencido')
    expect(cuerpo).not.toContain('revocado')
    expect(cuerpo).not.toContain('hash')
  })
})
