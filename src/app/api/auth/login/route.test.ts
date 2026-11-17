import { beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../../../../lib/db'
import { crearUsuario } from '../../../../test/fixtures'
import { hashPassword, leerSesion } from '../../../../server/auth'
import { POST as login } from './route'
import { POST as logout } from '../../auth/logout/route'

beforeAll(() => {
  process.env.SESSION_SECRET = 'a'.repeat(64)
})

function peticion(cuerpo: unknown): Request {
  return new Request('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
  })
}

async function usuarioConClave(email: string, password: string) {
  const usuario = await crearUsuario({ email })
  await prisma.usuario.update({
    where: { id: usuario.id },
    data: { passwordHash: await hashPassword(password) },
  })
  return usuario
}

describe('POST /api/auth/login', () => {
  it('responde 200 y emite una cookie de sesión válida', async () => {
    const usuario = await usuarioConClave('admin@caja.local', 'caja1234')

    const respuesta = await login(peticion({ email: 'admin@caja.local', password: 'caja1234' }))
    const cuerpo = await respuesta.json()

    expect(respuesta.status).toBe(200)
    expect(cuerpo.usuario).toEqual({
      id: usuario.id,
      email: 'admin@caja.local',
      nombre: usuario.nombre,
    })

    const cookie = respuesta.headers.get('set-cookie')
    expect(cookie).toContain('caja_sesion=')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=lax')

    // La cookie emitida tiene que servir para autenticar: se valida con el mismo
    // lector que usaría un pedido posterior.
    const valor = cookie!.match(/caja_sesion=([^;]+)/)![1]
    expect(leerSesion(valor)).toEqual({ userId: usuario.id })
  })

  it('responde 401 sin emitir cookie con contraseña incorrecta', async () => {
    await usuarioConClave('admin@caja.local', 'caja1234')

    const respuesta = await login(peticion({ email: 'admin@caja.local', password: 'otra' }))

    expect(respuesta.status).toBe(401)
    expect(respuesta.headers.get('set-cookie')).toBeNull()
    expect(await respuesta.json()).toEqual({ error: 'Credenciales inválidas' })
  })

  it('responde 401 con un email que no existe', async () => {
    const respuesta = await login(peticion({ email: 'nadie@caja.local', password: 'caja1234' }))

    expect(respuesta.status).toBe(401)
    expect(respuesta.headers.get('set-cookie')).toBeNull()
  })

  it('responde 400 si falta la contraseña', async () => {
    const respuesta = await login(peticion({ email: 'admin@caja.local' }))

    expect(respuesta.status).toBe(400)
    expect(respuesta.headers.get('set-cookie')).toBeNull()
  })

  it('responde 400 si el cuerpo no es JSON', async () => {
    const respuesta = await login(
      new Request('http://localhost/api/auth/login', { method: 'POST', body: 'no soy json' }),
    )

    expect(respuesta.status).toBe(400)
  })
})

describe('POST /api/auth/logout', () => {
  it('expira la cookie de sesión', async () => {
    const respuesta = await logout()

    expect(respuesta.status).toBe(200)
    const cookie = respuesta.headers.get('set-cookie')
    expect(cookie).toContain('caja_sesion=')
    expect(cookie).toMatch(/Max-Age=0/i)
  })
})
