import { createHmac, timingSafeEqual } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/db'

// Costo 12: ~300 ms por hash en esta máquina. Es lento a propósito — encarece el
// ataque de fuerza bruta mucho más de lo que molesta a un login real.
const COSTO_BCRYPT = 12

const DURACION_SESION_MS = 8 * 60 * 60 * 1000

// 32 caracteres es el mínimo razonable para una clave HMAC: menos que eso deja de
// ser un secreto y pasa a ser una adivinanza.
const LARGO_MINIMO_SECRETO = 32

export const NOMBRE_COOKIE_SESION = 'caja_sesion'

export type UsuarioAutenticado = { id: string; email: string; nombre: string }

// Cuando el email no existe igual se compara contra un hash señuelo. Sin eso, un
// email registrado tarda ~300 ms y uno inexistente responde al instante: el tiempo
// de respuesta termina siendo un oráculo de qué cuentas existen.
let hashCodeñuelo: string | null = null
async function señuelo(): Promise<string> {
  hashCodeñuelo ??= await bcrypt.hash('señuelo-de-tiempo-constante', COSTO_BCRYPT)
  return hashCodeñuelo
}

export async function hashPassword(plano: string): Promise<string> {
  if (!plano) {
    throw new Error('La contraseña no puede estar vacía')
  }
  return bcrypt.hash(plano, COSTO_BCRYPT)
}

export async function verificarPassword(plano: string, hash: string): Promise<boolean> {
  if (!plano || !hash) return false
  return bcrypt.compare(plano, hash)
}

export async function verificarCredenciales(
  email: string,
  password: string,
): Promise<UsuarioAutenticado | null> {
  const normalizado = email.trim().toLowerCase()

  // Búsqueda insensible a mayúsculas: el email se normaliza al leer, pero una fila
  // guardada como "Admin@Caja.Local" (por un import, un seed viejo o un alta manual)
  // quedaría imposible de loguear con un findUnique exacto.
  const usuario = await prisma.usuario.findFirst({
    where: { email: { equals: normalizado, mode: 'insensitive' } },
  })

  if (!usuario) {
    await bcrypt.compare(password, await señuelo())
    return null
  }

  const coincide = await bcrypt.compare(password, usuario.passwordHash)

  // Se compara la contraseña incluso si el usuario está inactivo, por el mismo
  // motivo de tiempo: que una cuenta dada de baja no se distinga de una activa.
  if (!coincide || !usuario.activo) {
    return null
  }

  return { id: usuario.id, email: usuario.email, nombre: usuario.nombre }
}

function secreto(): string {
  const valor = process.env.SESSION_SECRET
  if (!valor || valor.length < LARGO_MINIMO_SECRETO) {
    throw new Error(
      `SESSION_SECRET no está definida o es demasiado corta (mínimo ${LARGO_MINIMO_SECRETO} caracteres). Generá una con: openssl rand -hex 32`,
    )
  }
  return valor
}

function firmar(payload: string, clave: string): string {
  return createHmac('sha256', clave).update(payload).digest('base64url')
}

/**
 * Firma una sesión: `payload.firma`.
 *
 * El payload es visible (cualquiera puede leer el id de usuario), pero no se puede
 * alterar sin romper la firma. Lo que se guarda en la cookie es la prueba de que
 * el servidor emitió esa sesión, no un secreto.
 */
export function firmarSesion(
  userId: string,
  opciones: { duracionMs?: number; ahora?: number } = {},
): string {
  const duracion = opciones.duracionMs ?? DURACION_SESION_MS
  const ahora = opciones.ahora ?? Date.now()

  const payload = Buffer.from(
    JSON.stringify({ sub: userId, exp: ahora + duracion }),
  ).toString('base64url')

  return `${payload}.${firmar(payload, secreto())}`
}

export function leerSesion(
  valor: string,
  ahora: number = Date.now(),
): { userId: string } | null {
  if (!valor) return null

  const partes = valor.split('.')
  if (partes.length !== 2) return null

  const [payload, firma] = partes

  let esperada: string
  try {
    esperada = firmar(payload, secreto())
  } catch {
    // Sin secreto no hay forma de validar nada: se rechaza la sesión.
    return null
  }

  const recibida = Buffer.from(firma)
  const calculada = Buffer.from(esperada)

  // timingSafeEqual exige buffers del mismo largo y compara sin cortar en el
  // primer byte distinto, así que no filtra cuántos caracteres acertó el atacante.
  if (recibida.length !== calculada.length) return null
  if (!timingSafeEqual(recibida, calculada)) return null

  let datos: { sub?: unknown; exp?: unknown }
  try {
    datos = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }

  if (typeof datos.sub !== 'string' || typeof datos.exp !== 'number') return null
  if (datos.exp <= ahora) return null

  return { userId: datos.sub }
}

export function opcionesCookie() {
  return {
    httpOnly: true,
    // 'lax' y no 'none': bloquea el envío en peticiones cruzadas, que es lo que
    // corta la mayoría de los CSRF sin necesitar tokens.
    sameSite: 'lax' as const,
    // En producción la cookie viaja sólo por HTTPS.
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(DURACION_SESION_MS / 1000),
  }
}
