import { afterEach, describe, expect, it, vi } from 'vitest'
import { nuevaClaveIdempotencia } from './claveIdempotencia'

// Forma de un UUID v4: 8-4-4-4-12, con el nibble de versión en 4 y el de
// variante en 8, 9, a o b.
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function rellenarAlAzar(bytes: Uint8Array): Uint8Array {
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  return bytes
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('nuevaClaveIdempotencia', () => {
  it('usa crypto.randomUUID cuando el navegador lo tiene', () => {
    const randomUUID = vi.fn(() => '11111111-2222-4333-8444-555555555555')
    vi.stubGlobal('crypto', { randomUUID })

    expect(nuevaClaveIdempotencia()).toBe('11111111-2222-4333-8444-555555555555')
    expect(randomUUID).toHaveBeenCalledTimes(1)
  })

  it('cae a getRandomValues sin randomUUID, en vez de romper el formulario', () => {
    // Contexto no seguro (LAN por HTTP plano) o navegador viejo: getRandomValues
    // existe, randomUUID no. Renderizar el formulario no puede tirar excepción.
    vi.stubGlobal('crypto', { getRandomValues: rellenarAlAzar })

    const clave = nuevaClaveIdempotencia()

    expect(clave).toMatch(UUID_V4)
    expect(nuevaClaveIdempotencia()).not.toBe(clave)
  })

  it('no tira excepción cuando no hay crypto disponible en absoluto', () => {
    vi.stubGlobal('crypto', undefined)

    const clave = nuevaClaveIdempotencia()

    expect(clave).toMatch(UUID_V4)
    expect(nuevaClaveIdempotencia()).not.toBe(clave)
  })
})
