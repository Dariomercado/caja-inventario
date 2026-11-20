import { describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { crearUsuario } from '@/test/fixtures'
import { ScopeApi } from '../../../generated/prisma/enums'
import { VENTANA_MS, consumirCupo, inicioDeVentana } from './limite'
import { emitirToken } from './tokens'

async function emitir(limitePorMinuto?: number) {
  const usuario = await crearUsuario()
  return emitirToken({
    usuarioId: usuario.id,
    nombre: 'prueba',
    scopes: [ScopeApi.PRODUCTOS_READ],
    ...(limitePorMinuto === undefined ? {} : { limitePorMinuto }),
  })
}

/** Un instante dentro de una ventana concreta, para no depender del reloj real. */
const AHORA = new Date('2026-03-10T12:34:56.000Z').getTime()

describe('inicioDeVentana', () => {
  it('trunca al minuto, descartando segundos y milisegundos', () => {
    expect(inicioDeVentana(AHORA).toISOString()).toBe('2026-03-10T12:34:00.000Z')
  })
})

describe('consumirCupo', () => {
  it('permite hasta el límite y rechaza el pedido siguiente', async () => {
    const token = await emitir(3)

    const resultados = []
    for (let i = 0; i < 4; i += 1) {
      resultados.push(await consumirCupo(token.id, 3, AHORA))
    }

    expect(resultados.slice(0, 3)).toEqual([
      { permitido: true },
      { permitido: true },
      { permitido: true },
    ])
    expect(resultados[3]).toEqual({ permitido: false, reintentarEnSegundos: 4 })
  })

  it('informa los segundos que faltan para la próxima ventana', async () => {
    const token = await emitir(1)
    await consumirCupo(token.id, 1, AHORA)

    // AHORA está en el segundo 56 de la ventana: quedan 4 segundos.
    const rechazado = await consumirCupo(token.id, 1, AHORA + 1000)

    expect(rechazado).toEqual({ permitido: false, reintentarEnSegundos: 3 })
  })

  it('la ventana siguiente arranca con el cupo entero', async () => {
    const token = await emitir(1)
    await consumirCupo(token.id, 1, AHORA)
    expect(await consumirCupo(token.id, 1, AHORA)).toEqual({
      permitido: false,
      reintentarEnSegundos: 4,
    })

    expect(await consumirCupo(token.id, 1, AHORA + VENTANA_MS)).toEqual({ permitido: true })
  })

  it('dos tokens distintos no comparten el contador', async () => {
    const uno = await emitir(1)
    const otro = await emitir(1)

    expect(await consumirCupo(uno.id, 1, AHORA)).toEqual({ permitido: true })
    expect(await consumirCupo(uno.id, 1, AHORA)).toEqual({
      permitido: false,
      reintentarEnSegundos: 4,
    })
    // El segundo token conserva su cupo: el límite es por credencial, no global.
    expect(await consumirCupo(otro.id, 1, AHORA)).toEqual({ permitido: true })
  })

  it('cuenta de menos si dos instancias incrementan a la vez', async () => {
    const token = await emitir()
    const limite = 5

    // Diez pedidos concurrentes sobre la misma fila: si el contador se leyera y
    // luego se escribiera en dos pasos, más de cinco pasarían.
    const resultados = await Promise.all(
      Array.from({ length: 10 }, () => consumirCupo(token.id, limite, AHORA)),
    )

    const permitidos = resultados.filter((r) => r.permitido).length
    expect(permitidos).toBe(limite)

    const fila = await prisma.usoTokenApi.findFirstOrThrow({ where: { tokenId: token.id } })
    expect(fila.usos).toBe(10)
  })

  it('barre las ventanas viejas del token y no la actual', async () => {
    const token = await emitir()
    const vieja = new Date(AHORA - VENTANA_MS * 2000)
    await prisma.usoTokenApi.create({
      data: { tokenId: token.id, ventana: vieja, usos: 7 },
    })

    await consumirCupo(token.id, 100, AHORA)

    const ventanas = await prisma.usoTokenApi.findMany({
      where: { tokenId: token.id },
      select: { ventana: true },
    })
    expect(ventanas.map((v) => v.ventana.toISOString())).toEqual([
      '2026-03-10T12:34:00.000Z',
    ])
  })
})
