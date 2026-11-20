import { describe, expect, it } from 'vitest'
import {
  SinPresupuestoDiarioError,
  consumirLlamadaDeModelo,
  diaDe,
  llamadasDelDia,
  reservadorDeCupo,
} from './uso'

describe('presupuesto diario de llamadas al modelo', () => {
  it('cuenta una por llamada y permite hasta el tope', async () => {
    const primero = await consumirLlamadaDeModelo(2)
    const segundo = await consumirLlamadaDeModelo(2)
    const tercero = await consumirLlamadaDeModelo(2)

    expect(primero).toEqual({ permitido: true, usadas: 1, tope: 2 })
    expect(segundo).toEqual({ permitido: true, usadas: 2, tope: 2 })
    expect(tercero).toEqual({ permitido: false, usadas: 3, tope: 2 })
  })

  it('dos llamadas simultáneas no cuentan de menos', async () => {
    const resultados = await Promise.all([
      consumirLlamadaDeModelo(10),
      consumirLlamadaDeModelo(10),
      consumirLlamadaDeModelo(10),
    ])

    expect(resultados.map((resultado) => resultado.usadas).sort()).toEqual([1, 2, 3])
  })

  it('cada día tiene su propio contador', async () => {
    const unDia = new Date('2026-11-19T12:00:00Z')
    const otroDia = new Date('2026-11-20T12:00:00Z')

    await consumirLlamadaDeModelo(300, unDia)
    await consumirLlamadaDeModelo(300, unDia)
    const delOtro = await consumirLlamadaDeModelo(300, otroDia)

    expect(await llamadasDelDia(unDia)).toBe(2)
    expect(delOtro.usadas).toBe(1)
  })

  it('la lectura del día no consume presupuesto', async () => {
    await consumirLlamadaDeModelo(300)
    expect(await llamadasDelDia()).toBe(1)
    expect(await llamadasDelDia()).toBe(1)
  })

  it('el día se calcula en UTC, no en la zona del servidor', () => {
    expect(diaDe(new Date('2026-11-20T03:00:00Z'))).toBe('2026-11-20')
    expect(diaDe(new Date('2026-11-20T23:59:59Z'))).toBe('2026-11-20')
  })

  it('el reservador corta con el presupuesto agotado', async () => {
    const reservar = reservadorDeCupo({ tope: 1 })

    await expect(reservar()).resolves.toBeUndefined()
    await expect(reservar()).rejects.toBeInstanceOf(SinPresupuestoDiarioError)
  })
})
