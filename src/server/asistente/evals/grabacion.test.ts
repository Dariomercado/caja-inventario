import { describe, expect, it } from 'vitest'
import { esquemaFixture, type FixtureEval } from './caso'
import { decidirGrabado, fabricaLive, type CapturaDeCaso, type ConfiguracionLive } from './runner'

/**
 * Recording a live run into the fixtures the offline tier replays (S8).
 *
 * The capture happens at the transport boundary, so the recorded body is exactly
 * what the provider sent and exactly the shape `caso.ts` already loads. These tests
 * use a fake transport: no provider, no cost, no key.
 */

const CONFIGURACION: ConfiguracionLive = {
  baseUrl: 'http://modelo.local/v1',
  apiKey: 'clave-de-prueba-no-es-un-secreto',
  nombre: 'glm-fixture',
  temperatura: 0,
}

function cuerpo(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'chatcmpl-api-1',
    object: 'chat.completion',
    created: 1764000000,
    model: 'glm5.3-flash',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          reasoning_content: 'Pienso antes de elegir la herramienta.',
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'listar_productos', arguments: '{}' } },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    ...extra,
  }
}

function transporteFalso(cuerpos: Record<string, unknown>[]) {
  let indice = 0

  return async () => {
    const siguiente = cuerpos[indice]
    if (!siguiente) throw new Error('el test pidió más respuestas de las que puso en la cola')
    indice += 1

    return new Response(JSON.stringify(siguiente), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
}

describe('live capture', () => {
  it('records every provider body in order, in the fixture shape', async () => {
    const fabrica = fabricaLive(CONFIGURACION, {
      grabar: true,
      transporte: transporteFalso([cuerpo(), cuerpo({ id: 'chatcmpl-api-2' })]),
    })

    await fabrica(0).modelo.completar({ mensajes: [] })
    await fabrica(0).modelo.completar({ mensajes: [] })

    const captura = fabrica.captura()
    expect(captura.attempts).toHaveLength(1)
    expect(captura.attempts[0].map((respuesta) => respuesta.id)).toEqual([
      'chatcmpl-api-1',
      'chatcmpl-api-2',
    ])
    // Loadable exactly like a hand-authored fixture: one format, not two.
    expect(esquemaFixture.safeParse(captura).success).toBe(true)
  })

  it('groups the responses by attempt, in attempt order', async () => {
    const fabrica = fabricaLive(CONFIGURACION, {
      grabar: true,
      transporte: transporteFalso([
        cuerpo(),
        cuerpo({ id: 'chatcmpl-api-2' }),
        cuerpo({ id: 'chatcmpl-api-3' }),
      ]),
    })

    await fabrica(0).modelo.completar({ mensajes: [] })
    await fabrica(1).modelo.completar({ mensajes: [] })
    await fabrica(1).modelo.completar({ mensajes: [] })

    expect(fabrica.captura().attempts.map((bloque) => bloque.map((respuesta) => respuesta.id))).toEqual([
      ['chatcmpl-api-1'],
      ['chatcmpl-api-2', 'chatcmpl-api-3'],
    ])
  })

  it('keeps the provider fields the loop needs, reasoning included', async () => {
    const fabrica = fabricaLive(CONFIGURACION, { grabar: true, transporte: transporteFalso([cuerpo()]) })

    await fabrica(0).modelo.completar({ mensajes: [] })

    expect(fabrica.captura().attempts[0][0].choices[0].message).toMatchObject({
      reasoning_content: 'Pienso antes de elegir la herramienta.',
      tool_calls: [{ id: 'call_1', function: { name: 'listar_productos' } }],
    })
    expect(fabrica.captura().attempts[0][0].usage).toMatchObject({ prompt_tokens: 100, completion_tokens: 20 })
  })

  it('records nothing when grabación is off', async () => {
    const fabrica = fabricaLive(CONFIGURACION, { transporte: transporteFalso([cuerpo()]) })

    await fabrica(0).modelo.completar({ mensajes: [] })

    expect(fabrica.captura().attempts).toEqual([])
  })

  it('fails loudly on a body that would not load as a fixture, and records nothing', async () => {
    const sinMensaje = { ...cuerpo(), choices: [] }
    const fabrica = fabricaLive(CONFIGURACION, { grabar: true, transporte: transporteFalso([sinMensaje]) })

    await expect(fabrica(0).modelo.completar({ mensajes: [] })).rejects.toThrow(/fixture/)
    expect(fabrica.captura().attempts).toEqual([])
  })
})

describe('capture decisions', () => {
  const CAPTURA: FixtureEval = {
    attempts: [[{ choices: [{ message: { role: 'assistant', content: 'Registré la venta.' } }] }]],
  }

  function decision(cambios: Partial<CapturaDeCaso> = {}) {
    return decidirGrabado([
      { file: '01-simple-sale.json', fixture: '01-simple-sale.json', captura: CAPTURA, ok: true, skipped: false, intentos: 1, ...cambios },
    ])[0]
  }

  it('replaces the fixture when the live run met its effects', () => {
    expect(decision()).toEqual({ fixture: '01-simple-sale.json', escribir: CAPTURA })
  })

  it('keeps the baseline when the live run failed', () => {
    const resultado = decision({ ok: false })

    expect(resultado).not.toHaveProperty('escribir')
    expect(resultado).toMatchObject({ fixture: '01-simple-sale.json' })
    expect('conservar' in resultado ? resultado.conservar : '').toContain('no cumplió sus efectos')
  })

  it('writes nothing for a case the tier skipped', () => {
    const resultado = decision({ skipped: true })

    expect(resultado).not.toHaveProperty('escribir')
    expect('conservar' in resultado ? resultado.conservar : '').toContain('no corre en este nivel')
  })

  it('keeps the baseline when the capture does not have one block per attempt', () => {
    const resultado = decision({ intentos: 2 })

    expect(resultado).not.toHaveProperty('escribir')
    expect('conservar' in resultado ? resultado.conservar : '').toContain('1 bloque(s)')
  })
})
