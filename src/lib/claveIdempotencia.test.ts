import { afterEach, describe, expect, it, vi } from 'vitest'
import { nuevaClaveIdempotencia } from './claveIdempotencia'

// Forma de un UUID v4: 8-4-4-4-12, con el nibble de versión en 4 y el de
// variante en 8, 9, a o b.
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

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

  it('cae a getRandomValues sin randomUUID, sin bajar al último recurso', () => {
    // Contexto no seguro (LAN por HTTP plano) o navegador viejo: getRandomValues
    // existe, randomUUID no. Los bytes son fijos para distinguir este escalón del
    // fallback a Math.random: si el dispatch se rompiera, el UUID esperado —y el
    // conteo de llamadas— no coincidirían, así que el test no da falsa confianza.
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = i
      return bytes
    })
    vi.stubGlobal('crypto', { getRandomValues })

    expect(nuevaClaveIdempotencia()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f')
    expect(getRandomValues).toHaveBeenCalledTimes(1)
  })

  it('no tira excepción cuando no hay crypto disponible en absoluto', () => {
    vi.stubGlobal('crypto', undefined)

    const clave = nuevaClaveIdempotencia()

    expect(clave).toMatch(UUID_V4)
    expect(nuevaClaveIdempotencia()).not.toBe(clave)
  })
})
