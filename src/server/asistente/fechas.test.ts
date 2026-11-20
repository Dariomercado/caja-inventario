import { describe, expect, it } from 'vitest'
import { fechaDelNegocio, fechaHoraLocal } from './fechas'

/**
 * La traducción de UTC al día del negocio, que es la que el modelo no tiene que hacer.
 *
 * En la primera corrida real el panel mostró «09:03» cuando en Buenos Aires eran las
 * 06:03. Y el caso que más duele es el borde: una venta de las 23:30 locales viaja
 * como las 02:30 del día siguiente en UTC.
 */
describe('fechas del negocio', () => {
  it('convierte una hora UTC a hora de Buenos Aires', () => {
    expect(fechaHoraLocal('2026-11-20T09:03:00.000Z')).toBe('2026-11-20 06:03')
    expect(fechaHoraLocal('2026-11-20T09:50:00.000Z')).toBe('2026-11-20 06:50')
  })

  it('una venta de las 23:30 locales no se corre al día siguiente', () => {
    // 02:30 UTC del 21 es 23:30 del 20 en Buenos Aires: el día que ve el negocio.
    expect(fechaHoraLocal('2026-11-21T02:30:00.000Z')).toBe('2026-11-20 23:30')
    expect(fechaDelNegocio(new Date('2026-11-21T02:30:00.000Z'))).toBe('2026-11-20')
  })

  it('la medianoche se muestra como 00 y no como 24', () => {
    expect(fechaHoraLocal('2026-11-20T03:00:00.000Z')).toBe('2026-11-20 00:00')
  })

  it('una fecha que no parsea se devuelve tal cual, sin inventar', () => {
    expect(fechaHoraLocal('no es una fecha')).toBe('no es una fecha')
  })

  it('el día del negocio coincide con el que usan los reportes', () => {
    const madrugada = new Date('2026-11-20T02:00:00.000Z')

    // 23:00 del 19 en Buenos Aires: el cupo diario sigue cortando en UTC, pero la
    // caja y el asistente hablan del día 19.
    expect(fechaDelNegocio(madrugada)).toBe('2026-11-19')
  })
})
