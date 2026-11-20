import { describe, expect, it } from 'vitest'
import { esquemaReplayGrabado } from '../replay'
import { leerCasos, type FixtureEval } from './caso'
import { componerReplayGrabado } from './replayGrabado'
import type { TranscripcionDeCaso } from './runner'

/**
 * The replay recording is composed from one case's execution, so the same builder
 * produces the file from a live result (`--grabar`) and from an already recorded
 * fixture. What it must never do is make up a date, a model or a turn.
 */

const CASO_01 = leerCasos('evals/cases', 'evals/fixtures').find(
  ({ file }) => file === '01-simple-sale.json',
)!.caso

function captura(cambios: { created?: number[]; modelo?: string[] } = {}): FixtureEval {
  const creados = cambios.created ?? [1795152704, 1795152710]
  const modelos = cambios.modelo ?? ['glm5.3-flash', 'glm5.3-flash']

  return {
    attempts: [
      creados.map((created, indice) => ({
        ...(modelos[indice] === undefined ? {} : { model: modelos[indice] }),
        created,
        choices: [{ message: { role: 'assistant' as const, content: 'listo' } }],
      })),
    ],
  }
}

const TRANSCRIPCION: TranscripcionDeCaso = {
  texto: 'Registré la venta #1: 2 × Azúcar común 1 kg, total $3.000, en efectivo.',
  llamadas: [
    { nombre: 'listar_productos', estado: 'ok', detalle: '' },
    { nombre: 'registrar_venta', estado: 'ok', detalle: '' },
  ],
}

describe('replay recording builder', () => {
  it('composes the case request, the assistant reply and its calls in order', () => {
    const grabado = componerReplayGrabado({ caso: CASO_01, transcripcion: TRANSCRIPCION, captura: captura() })

    expect(grabado).toMatchObject({ caso: 'simple sale', pedido: CASO_01.request.message })
    expect(grabado?.turnos[0]).toEqual({ rol: 'usuario', texto: CASO_01.request.message })
    expect(grabado?.turnos[1]).toMatchObject({
      rol: 'asistente',
      texto: TRANSCRIPCION.texto,
      llamadas: [
        { nombre: 'listar_productos', estado: 'ok', detalle: '' },
        { nombre: 'registrar_venta', estado: 'ok', detalle: '' },
      ],
    })
    expect(esquemaReplayGrabado.safeParse(grabado).success).toBe(true)
  })

  it('takes the date and the model from the capture, not from the clock', () => {
    const grabado = componerReplayGrabado({ caso: CASO_01, transcripcion: TRANSCRIPCION, captura: captura() })

    expect(grabado?.fecha).toBe('2026-11-20')
    expect(grabado?.modelo).toBe('glm5.3-flash')
  })

  it('refuses to date the recording when the capture does not say when', () => {
    const grabado = componerReplayGrabado({
      caso: CASO_01,
      transcripcion: TRANSCRIPCION,
      captura: { attempts: [[{ choices: [{ message: { role: 'assistant', content: 'listo' } }] }]] },
    })

    expect(grabado).toBeNull()
  })

  it('refuses to name a model the capture does not name', () => {
    const grabado = componerReplayGrabado({
      caso: CASO_01,
      transcripcion: TRANSCRIPCION,
      captura: captura({ modelo: [] }),
    })

    expect(grabado).toBeNull()
  })

  it('refuses an assistant turn without text', () => {
    const grabado = componerReplayGrabado({
      caso: CASO_01,
      transcripcion: { texto: '   ', llamadas: TRANSCRIPCION.llamadas },
      captura: captura(),
    })

    expect(grabado).toBeNull()
  })
})
