import { createHash, randomBytes } from 'node:crypto'
import { prisma } from '@/lib/db'
import type { ScopeApi } from '../../../generated/prisma/enums'
import { nombresDesdeScopes } from './scopes'

/**
 * Credenciales de la API pública.
 *
 * El token en claro se genera acá, se devuelve una sola vez y no se guarda: en la
 * base queda sólo su SHA-256. Es la misma razón por la que una contraseña no se
 * guarda en claro, con una diferencia importante: un token de 32 bytes aleatorios
 * no necesita un KDF lento, porque no es adivinable por diccionario. Un SHA-256
 * alcanza y permite buscar por índice único.
 */

/** Prefijo visible: permite reconocer un token en un log sin poder usarlo. */
const PREFIJO = 'cji_'

/** 32 bytes = 256 bits de entropía. No hay ataque por fuerza bruta posible. */
const BYTES_TOKEN = 32

/** Caracteres del token que se conservan como `prefijo` para identificarlo. */
const LARGO_PREFIJO_VISIBLE = 12

/** Validez por defecto de un token emitido si no se pide otra cosa. */
export const DIAS_VALIDEZ_POR_DEFECTO = 90

export type TokenEmitido = {
  /** El token en claro. Sólo existe en el retorno de `emitirToken`. */
  claro: string
  id: string
  nombre: string
  prefijo: string
  scopes: string[]
  expiraEn: Date | null
}

export type TokenResuelto = {
  id: string
  usuarioId: string
  nombre: string
  scopes: ScopeApi[]
  limitePorMinuto: number
}

/** Hash con el que se persiste y se busca un token. */
export function hashDeToken(claro: string): string {
  return createHash('sha256').update(claro, 'utf8').digest('hex')
}

/** Genera el material del token. Separado de la escritura para poder probarlo solo. */
export function generarToken(): { claro: string; hash: string; prefijo: string } {
  // base64url evita los caracteres que rompen un header Authorization o una URL.
  const claro = PREFIJO + randomBytes(BYTES_TOKEN).toString('base64url')
  return {
    claro,
    hash: hashDeToken(claro),
    prefijo: claro.slice(0, LARGO_PREFIJO_VISIBLE),
  }
}

/**
 * Emite un token para un usuario. El valor en claro se devuelve una única vez:
 * después de esta llamada no hay forma de recuperarlo, sólo de revocarlo y emitir otro.
 */
export async function emitirToken(entrada: {
  usuarioId: string
  nombre: string
  scopes: ScopeApi[]
  diasValidez?: number | null
  limitePorMinuto?: number
}): Promise<TokenEmitido> {
  const { claro, hash, prefijo } = generarToken()

  // null significa "sin vencimiento" y es una decisión explícita, no el default.
  const dias = entrada.diasValidez === undefined ? DIAS_VALIDEZ_POR_DEFECTO : entrada.diasValidez
  const expiraEn = dias === null ? null : new Date(Date.now() + dias * 24 * 60 * 60 * 1000)

  const token = await prisma.tokenApi.create({
    data: {
      nombre: entrada.nombre,
      hash,
      prefijo,
      scopes: entrada.scopes,
      expiraEn,
      usuarioId: entrada.usuarioId,
      ...(entrada.limitePorMinuto === undefined
        ? {}
        : { limitePorMinuto: entrada.limitePorMinuto }),
    },
  })

  return {
    claro,
    id: token.id,
    nombre: token.nombre,
    prefijo: token.prefijo,
    scopes: nombresDesdeScopes(token.scopes),
    expiraEn: token.expiraEn,
  }
}

/**
 * Resuelve un `Authorization: Bearer ...` a un token usable.
 *
 * Devuelve `null` en los cinco casos que importan —sin token, formato inválido,
 * desconocido, vencido, revocado, o usuario inactivo— porque distinguirlos hacia
 * afuera le contaría a un atacante cuál de todos falló. El motivo real va al log.
 *
 * El `ultimoUsoEn` se actualiza con `updateMany` y no con `update`: si el token se
 * revoca entre la lectura y esta escritura, `updateMany` no toca nada en lugar de
 * resucitar una fila revocada.
 */
export async function resolverToken(cabecera: string | null): Promise<TokenResuelto | null> {
  if (!cabecera) return null

  // Un solo espacio: `Bearer` exacto, y el token no puede tener espacios.
  const partes = cabecera.split(' ')
  if (partes.length !== 2 || partes[0] !== 'Bearer') return null
  const claro = partes[1]
  if (!claro.startsWith(PREFIJO)) return null

  const token = await prisma.tokenApi.findUnique({
    where: { hash: hashDeToken(claro) },
    select: {
      id: true,
      usuarioId: true,
      nombre: true,
      scopes: true,
      limitePorMinuto: true,
      expiraEn: true,
      revocadoEn: true,
      usuario: { select: { activo: true } },
    },
  })

  if (!token) return null
  if (token.revocadoEn !== null) return null
  if (token.expiraEn !== null && token.expiraEn.getTime() <= Date.now()) return null
  if (!token.usuario.activo) return null

  await prisma.tokenApi.updateMany({
    where: { id: token.id, revocadoEn: null },
    data: { ultimoUsoEn: new Date() },
  })

  return {
    id: token.id,
    usuarioId: token.usuarioId,
    nombre: token.nombre,
    scopes: token.scopes,
    limitePorMinuto: token.limitePorMinuto,
  }
}

/** Indica si un token resuelto alcanza para el scope pedido. */
export function tieneScope(token: TokenResuelto, scope: ScopeApi): boolean {
  return token.scopes.includes(scope)
}

/**
 * Revoca un token. Idempotente: revocar dos veces no cambia el momento del
 * primer revocado, porque la fecha que importa es cuándo dejó de valer.
 */
export async function revocarToken(id: string): Promise<void> {
  await prisma.tokenApi.updateMany({
    where: { id, revocadoEn: null },
    data: { revocadoEn: new Date() },
  })
}
