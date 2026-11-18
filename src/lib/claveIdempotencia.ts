// Clave de idempotencia de un intento de venta.
//
// No es un secreto ni una firma: es un identificador que viaja con el envío para
// que el índice único de la base pueda rechazar un duplicado. Alcanza con que sea
// único por intento, y por eso hay tres caminos: lo único que no se puede permitir
// es que el formulario no renderice.
export function nuevaClaveIdempotencia(): string {
  const cripto: Crypto | undefined = globalThis.crypto

  if (typeof cripto?.randomUUID === 'function') {
    return cripto.randomUUID()
  }

  // Contexto no seguro (una demo en LAN por HTTP plano) o navegador anterior a
  // randomUUID: getRandomValues sigue disponible y sobra para esto.
  if (typeof cripto?.getRandomValues === 'function') {
    return formatearUuidV4((bytes) => cripto.getRandomValues(bytes))
  }

  // Último recurso, sin ninguna API de crypto: es preferible una clave más débil
  // a una pantalla que no carga. La unicidad que importa la garantiza el índice.
  return formatearUuidV4((bytes) => {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
    return bytes
  })
}

function formatearUuidV4(sortear: (bytes: Uint8Array) => Uint8Array): string {
  const bytes = Uint8Array.from(sortear(new Uint8Array(16)))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
