import { describe, expect, it } from 'vitest'
import type { DefinicionHerramienta } from '../herramientas'
import { leerCasos, type ExpectativasEval, type RespuestaGrabada } from './caso'
import { evaluarEspera, type ObservacionCaso } from './runner'
import { reproductorDeFixture, transporteEnProceso } from './transporte'

/**
 * Unit tests for the eval machinery, not for the assistant.
 *
 * The cases themselves are data: `scripts/evals.mjs` is what proves the assistant.
 * These tests guard the parts a typo in a JSON file would silently disable —the
 * expectation check and the fixture replay— plus the case inventory.
 */

const REGISTRAR_VENTA: DefinicionHerramienta = {
  type: 'function',
  function: {
    name: 'registrar_venta',
    description: 'Registers a sale.',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { producto_id: { type: 'string' }, cantidad: { type: 'number' } },
          },
        },
        medio_pago: { type: 'string' },
      },
    },
  },
}

const ESPERA: ExpectativasEval = {
  toolCalls: ['registrar_venta'],
  textIncludes: ['venta'],
  sales: {
    count: 1,
    totalCentavos: { productId: 'prod_1', quantity: 2 },
    paymentMethods: ['EFECTIVO'],
  },
  stock: [{ productId: 'prod_1', stock: 8 }],
  movements: [{ productId: 'prod_1', type: 'SALIDA', quantity: 2, stockAfter: 8 }],
  productCount: 1,
  postVentas: 1,
}

function observacion(cambios: Partial<ObservacionCaso> = {}): ObservacionCaso {
  return {
    toolCalls: [{ name: 'registrar_venta', ok: true }],
    text: 'Registré la venta #1 por $3.000.',
    topReached: false,
    modelCalls: 1,
    httpRequests: [{ method: 'POST', pathname: '/api/v1/ventas' }],
    tools: [REGISTRAR_VENTA],
    sales: [{ totalCentavos: 300_000, paymentMethods: ['EFECTIVO'] }],
    products: [{ id: 'prod_1', stock: 8 }],
    movements: [{ productId: 'prod_1', type: 'SALIDA', quantity: 2, stockAfter: 8 }],
    productCount: 1,
    seededPrices: { prod_1: 150_000 },
    ...cambios,
  }
}

function respuestaGrabada(texto: string): RespuestaGrabada {
  return {
    choices: [{ message: { role: 'assistant', content: texto }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  }
}

describe('eval expectations', () => {
  it('passes when every declared effect matches', () => {
    expect(evaluarEspera(ESPERA, observacion())).toEqual([])
  })

  it('fails when a case expects two sales and the run created one', () => {
    const fallas = evaluarEspera(
      { ...ESPERA, sales: { ...ESPERA.sales, count: 2 } },
      observacion(),
    )

    expect(fallas).toEqual(['ventas: se esperaban 2 y hay 1'])
  })

  it('fails when the sale total is not price × quantity from the seed', () => {
    const fallas = evaluarEspera(ESPERA, observacion({ sales: [{ totalCentavos: 299_999, paymentMethods: ['EFECTIVO'] }] }))

    expect(fallas.join(' ')).toContain('total de la venta: se esperaban 300000 y hay 299999')
  })

  it('fails when registrar_venta exposes a money field', () => {
    const conTotal: DefinicionHerramienta = {
      type: 'function',
      function: {
        name: 'registrar_venta',
        description: 'Registers a sale.',
        parameters: { type: 'object', properties: { totalCentavos: { type: 'number' } } },
      },
    }

    const fallas = evaluarEspera(
      { ...ESPERA, noMoneyFieldsIn: ['registrar_venta'] },
      observacion({ tools: [conTotal] }),
    )

    expect(fallas.join(' ')).toContain('totalCentavos')
  })

  it('fails when the API was posted more than once for a sale', () => {
    const fallas = evaluarEspera(
      ESPERA,
      observacion({
        httpRequests: [
          { method: 'POST', pathname: '/api/v1/ventas' },
          { method: 'POST', pathname: '/api/v1/ventas' },
        ],
      }),
    )

    expect(fallas).toEqual(['POST /ventas: se esperaba 1 y hubo 2'])
  })
})

describe('fixture replay', () => {
  it('returns the recorded bodies in order and reports what is left', async () => {
    const reproductor = reproductorDeFixture([respuestaGrabada('uno'), respuestaGrabada('dos')])
    const primera = await reproductor.transporte(new Request('http://panel.local/modelo/chat/completions'))
    const segunda = await reproductor.transporte(new Request('http://panel.local/modelo/chat/completions'))

    expect(await primera.json()).toMatchObject({ choices: [{ message: { content: 'uno' } }] })
    expect(await segunda.json()).toMatchObject({ choices: [{ message: { content: 'dos' } }] })
    expect(reproductor.restantes()).toBe(0)
  })

  it('fails loudly when the loop asks for a turn the fixture does not have', async () => {
    const reproductor = reproductorDeFixture([respuestaGrabada('sólo una')])

    await reproductor.transporte(new Request('http://panel.local/modelo/chat/completions'))

    await expect(
      reproductor.transporte(new Request('http://panel.local/modelo/chat/completions')),
    ).rejects.toThrow(/sin respuestas/)
  })
})

describe('in-process API transport', () => {
  it('answers the API error envelope for a route outside the assistant surface', async () => {
    const respuesta = await transporteEnProceso()(
      new Request('http://panel.local/api/v1/no-existe'),
    )

    expect(respuesta.status).toBe(404)
    await expect(respuesta.json()).resolves.toMatchObject({ error: { code: 'no_encontrado' } })
  })
})

describe('versioned eval cases', () => {
  const casos = leerCasos('evals/cases', 'evals/fixtures')

  it('declares exactly the nine covered behaviours', () => {
    expect(casos).toHaveLength(9)
    expect(new Set(casos.map(({ caso }) => caso.name)).size).toBe(9)
  })

  it('gives every case a request, a fixture with one block per attempt and a database effect', () => {
    for (const { file, caso, fixture } of casos) {
      expect(caso.request.message.length, file).toBeGreaterThan(0)
      expect(fixture.attempts.length, file).toBe(caso.request.attempts)
      expect(caso.expect.sales, file).toBeDefined()
    }
  })
})
