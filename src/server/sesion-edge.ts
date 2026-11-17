import { LARGO_MINIMO_SECRETO } from './cookie'

/**
 * Verificación de sesión para el runtime Edge del middleware.
 *
 * El middleware corre antes de que Next renderice nada, y ahí está la diferencia:
 * un guard en un layout llega tarde, porque el layout y la página se renderizan en
 * paralelo y la consulta a la base ya se ejecutó cuando el redirect aparece. Con el
 * chequeo acá, un pedido sin sesión válida no dispara ninguna lectura.
 *
 * Usa Web Crypto en vez de node:crypto porque el runtime Edge no tiene el módulo de
 * Node. El formato del token es idéntico al que firma src/server/auth.ts, y hay un
 * test que lo comprueba cruzando las dos implementaciones.
 */

const codificador = new TextEncoder()
const decodificador = new TextDecoder()

function aBase64Url(bytes: Uint8Array): string {
  let binario = ''
  for (const byte of bytes) binario += String.fromCharCode(byte)
  return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function deBase64Url(texto: string): Uint8Array {
  const normalizado = texto.replace(/-/g, '+').replace(/_/g, '/')
  const relleno = normalizado + '='.repeat((4 - (normalizado.length % 4)) % 4)
  const binario = atob(relleno)
  const bytes = new Uint8Array(binario.length)
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i)
  return bytes
}

// Comparación sin cortocircuito: recorre siempre todo, para no filtrar por tiempo
// cuántos caracteres iniciales acertó quien está probando tokens.
function igualdadConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diferencia = 0
  for (let i = 0; i < a.length; i += 1) {
    diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diferencia === 0
}

export async function leerSesionEdge(valor: string): Promise<{ userId: string } | null> {
  const secreto = process.env.SESSION_SECRET
  if (!secreto || secreto.length < LARGO_MINIMO_SECRETO) return null
  if (!valor) return null

  const partes = valor.split('.')
  if (partes.length !== 2) return null

  const [payload, firma] = partes

  const clave = await crypto.subtle.importKey(
    'raw',
    codificador.encode(secreto),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = await crypto.subtle.sign('HMAC', clave, codificador.encode(payload))
  const esperada = aBase64Url(new Uint8Array(digest))

  if (!igualdadConstante(firma, esperada)) return null

  let datos: { sub?: unknown; exp?: unknown }
  try {
    datos = JSON.parse(decodificador.decode(deBase64Url(payload)))
  } catch {
    return null
  }

  if (typeof datos.sub !== 'string' || typeof datos.exp !== 'number') return null
  if (datos.exp <= Date.now()) return null

  return { userId: datos.sub }
}
