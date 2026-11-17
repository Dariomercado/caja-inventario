import { beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../lib/db'
import { crearUsuario } from '../test/fixtures'
import {
  firmarSesion,
  hashPassword,
  leerSesion,
  opcionesCookie,
  verificarCredenciales,
  verificarPassword,
} from './auth'

// Secreto de test: 64 caracteres hex, igual que el que genera `openssl rand -hex 32`.
const SECRETO_TEST = 'a'.repeat(64)

beforeAll(() => {
  process.env.SESSION_SECRET = SECRETO_TEST
})

describe('hashPassword / verificarPassword', () => {
  it('nunca guarda ni devuelve la contraseña en claro', async () => {
    const hash = await hashPassword('caja1234')

    expect(hash).not.toContain('caja1234')
    expect(hash).toMatch(/^\$2[aby]\$/)
    await expect(verificarPassword('caja1234', hash)).resolves.toBe(true)
  })

  it('rechaza una contraseña distinta', async () => {
    const hash = await hashPassword('caja1234')
    await expect(verificarPassword('caja12345', hash)).resolves.toBe(false)
  })

  it('genera hashes distintos para la misma contraseña (sal por hash)', async () => {
    const uno = await hashPassword('caja1234')
    const otro = await hashPassword('caja1234')
    expect(uno).not.toBe(otro)
  })
})

describe('verificarCredenciales', () => {
  it('devuelve el usuario con credenciales correctas', async () => {
    const usuario = await crearUsuario({ email: 'admin@caja.local' })
    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { passwordHash: await hashPassword('caja1234') },
    })

    const autenticado = await verificarCredenciales('admin@caja.local', 'caja1234')

    expect(autenticado).toEqual({
      id: usuario.id,
      email: 'admin@caja.local',
      nombre: usuario.nombre,
    })
    // La contraseña no viaja en la respuesta.
    expect(JSON.stringify(autenticado)).not.toContain('caja1234')
  })

  it('devuelve null con contraseña incorrecta', async () => {
    const usuario = await crearUsuario({ email: 'admin@caja.local' })
    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { passwordHash: await hashPassword('caja1234') },
    })

    await expect(verificarCredenciales('admin@caja.local', 'otra')).resolves.toBeNull()
  })

  it('devuelve null con un email que no existe, sin lanzar', async () => {
    await expect(
      verificarCredenciales('nadie@caja.local', 'caja1234'),
    ).resolves.toBeNull()
  })

  it('devuelve null si el usuario está inactivo', async () => {
    const usuario = await crearUsuario({ email: 'baja@caja.local' })
    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { passwordHash: await hashPassword('caja1234'), activo: false },
    })

    await expect(verificarCredenciales('baja@caja.local', 'caja1234')).resolves.toBeNull()
  })
})

describe('sesión firmada', () => {
  it('devuelve el usuario al leer una sesión que firmó ella misma', () => {
    const valor = firmarSesion('usuario-1')
    expect(leerSesion(valor)).toEqual({ userId: 'usuario-1' })
  })

  it('rechaza un payload válido con la firma de otra sesión', () => {
    // El ataque real: no romper el JSON, sino reemplazar el contenido por otro
    // payload perfectamente válido (otro usuario) conservando la firma ajena.
    // Sin verificar el HMAC, esto autenticaría como el usuario falsificado.
    const [, firma] = firmarSesion('usuario-1').split('.')
    const payloadFalso = Buffer.from(
      JSON.stringify({ sub: 'usuario-2', exp: Date.now() + 60_000 }),
    ).toString('base64url')

    expect(leerSesion(`${payloadFalso}.${firma}`)).toBeNull()
  })

  it('rechaza un payload que no es JSON válido', () => {
    const [, firma] = firmarSesion('usuario-1').split('.')
    const basura = Buffer.from('no soy json').toString('base64url')

    expect(leerSesion(`${basura}.${firma}`)).toBeNull()
  })

  it('rechaza una expiración extendida sobre una firma real', () => {
    const [payload, firma] = firmarSesion('usuario-1').split('.')
    const { sub } = JSON.parse(Buffer.from(payload, 'base64url').toString())
    const falso = Buffer.from(
      JSON.stringify({ sub, exp: Date.now() + 100 * 365 * 24 * 3600_000 }),
    ).toString('base64url')

    expect(leerSesion(`${falso}.${firma}`)).toBeNull()
  })

  it('rechaza la sesión exactamente en su instante de expiración', () => {
    const ahora = 1_000_000
    const valor = firmarSesion('usuario-1', { duracionMs: 0, ahora })

    expect(leerSesion(valor, ahora)).toBeNull()
  })

  it('la lectura falla cerrado sin SESSION_SECRET y con uno corto', () => {
    const valor = firmarSesion('usuario-1')
    const original = process.env.SESSION_SECRET
    try {
      delete process.env.SESSION_SECRET
      expect(leerSesion(valor)).toBeNull()
      process.env.SESSION_SECRET = 'corto'
      expect(leerSesion(valor)).toBeNull()
    } finally {
      process.env.SESSION_SECRET = original
    }
  })

  it('acepta un email guardado con mayúsculas', async () => {
    const usuario = await crearUsuario({ email: 'Admin@Caja.Local' })
    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { passwordHash: await hashPassword('caja1234') },
    })

    await expect(
      verificarCredenciales('admin@caja.local', 'caja1234'),
    ).resolves.toEqual({ id: usuario.id, email: 'Admin@Caja.Local', nombre: usuario.nombre })
  })

  it('rechaza una sesión con la firma cortada', () => {
    const valor = firmarSesion('usuario-1')
    expect(leerSesion(valor.slice(0, -2))).toBeNull()
  })

  it('rechaza una sesión vencida', () => {
    const hace8Horas = Date.now() - 8 * 60 * 60 * 1000
    const valor = firmarSesion('usuario-1', { duracionMs: 60 * 60 * 1000, ahora: hace8Horas })
    expect(leerSesion(valor)).toBeNull()
  })

  it('rechaza basura sin lanzar', () => {
    expect(leerSesion('')).toBeNull()
    expect(leerSesion('sin.puntos')).toBeNull()
    expect(leerSesion('a.b.c.d')).toBeNull()
  })

  it('falla cerrado si falta SESSION_SECRET', () => {
    const original = process.env.SESSION_SECRET
    delete process.env.SESSION_SECRET
    try {
      expect(() => firmarSesion('usuario-1')).toThrow(/SESSION_SECRET/)
    } finally {
      process.env.SESSION_SECRET = original
    }
  })

  it('falla cerrado si SESSION_SECRET es demasiado corto', () => {
    const original = process.env.SESSION_SECRET
    process.env.SESSION_SECRET = 'corto'
    try {
      expect(() => firmarSesion('usuario-1')).toThrow(/SESSION_SECRET/)
    } finally {
      process.env.SESSION_SECRET = original
    }
  })
})

describe('opcionesCookie', () => {
  it('marca la cookie como httpOnly y mismaSite lax', () => {
    const opciones = opcionesCookie()
    expect(opciones.httpOnly).toBe(true)
    expect(opciones.sameSite).toBe('lax')
    expect(opciones.path).toBe('/')
    expect(opciones.maxAge).toBeGreaterThan(0)
  })
})
