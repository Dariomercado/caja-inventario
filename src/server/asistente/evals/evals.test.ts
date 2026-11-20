import { describe, expect, it } from 'vitest'
import type { DefinicionHerramienta } from '../herramientas'
import {
  esquemaCaso,
  leerCasos,
  type ExpectativasEfectos,
  type RespuestaGrabada,
} from './caso'
import { evaluarEfectos, evaluarGuion, observarTextoInformativo, type ObservacionCaso } from './runner'
import { reproductorDeFixture, transporteEnProceso } from './transporte'

/**
 * Unit tests for the eval machinery, not for the assistant.
 *
 * The cases themselves are data: `scripts/evals.mjs` is what proves the assistant.
 * These tests guard the parts a typo in a JSON file would silently disable —the
 * effect check, the tier split and the fixture replay— plus the case inventory.
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

/** Effects only, like every `expect` in `evals/cases` (S9). */
const EFECTOS: ExpectativasEfectos = {
  toolCallsInclude: ['registrar_venta'],
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

/** A minimal valid case, to check the schema guards without touching the fixture files. */
const CASO_VALIDO = {
  name: 'caso de prueba',
  specs: ['S9'],
  tiers: ['offline', 'live'],
  seed: { products: [{ id: 'prod_1', sku: 'SKU-1', name: 'Producto', priceCentavos: 100, stock: 3 }] },
  request: { message: 'Vendé uno.' },
  fixture: 'caso.json',
  expect: { sales: { count: 1 } },
}

function problemas(caso: unknown): string {
  const resultado = esquemaCaso.safeParse(caso)
  if (resultado.success) return ''
  return resultado.error.issues.map((problema) => `${problema.path.join('.')}: ${problema.message}`).join('; ')
}

describe('eval effects', () => {
  it('passes when every declared effect matches', () => {
    expect(evaluarEfectos(EFECTOS, observacion())).toEqual([])
  })

  it('fails when a case expects two sales and the run created one', () => {
    const fallas = evaluarEfectos({ ...EFECTOS, sales: { ...EFECTOS.sales, count: 2 } }, observacion())

    expect(fallas).toEqual(['ventas: se esperaban 2 y hay 1'])
  })

  it('fails when the sale total is not price × quantity from the seed', () => {
    const fallas = evaluarEfectos(
      EFECTOS,
      observacion({ sales: [{ totalCentavos: 299_999, paymentMethods: ['EFECTIVO'] }] }),
    )

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

    const fallas = evaluarEfectos(
      { ...EFECTOS, noMoneyFieldsIn: ['registrar_venta'] },
      observacion({ tools: [conTotal] }),
    )

    expect(fallas.join(' ')).toContain('totalCentavos')
  })

  it('fails when the API was posted more than once for a sale', () => {
    const fallas = evaluarEfectos(
      EFECTOS,
      observacion({
        httpRequests: [
          { method: 'POST', pathname: '/api/v1/ventas' },
          { method: 'POST', pathname: '/api/v1/ventas' },
        ],
      }),
    )

    expect(fallas).toEqual(['POST /ventas: se esperaba 1 y hubo 2'])
  })

  it('fails when a tool that must not run ran, so an ambiguous request wrote', () => {
    const fallas = evaluarEfectos(
      { ...EFECTOS, toolCallsExclude: ['registrar_venta'] },
      observacion(),
    )

    expect(fallas).toEqual(['tool calls: «registrar_venta» no debía ejecutarse y se ejecutó'])
  })

  it('fails when a required tool never ran', () => {
    const fallas = evaluarEfectos(
      EFECTOS,
      observacion({ toolCalls: [{ name: 'listar_productos', ok: true }] }),
    )

    expect(fallas).toContain('tool calls: se esperaba que «registrar_venta» se ejecutara y no se ejecutó (listar_productos)')
  })

  it('never fails on the wording of the reply', () => {
    // A run with every effect in place and a reply that says something else entirely:
    // prose is not a criterion (S9).
    expect(evaluarEfectos(EFECTOS, observacion({ text: 'Listo.' }))).toEqual([])
  })
})

describe('informative text', () => {
  it('reports what the reply said without turning it into a verdict', () => {
    const notas = observarTextoInformativo({ textIncludes: ['$3.000', 'no la dupliqué'] }, 'Total $3.000.')

    expect(notas).toEqual([
      'texto (informativo): dijo «$3.000»',
      'texto (informativo): no dijo «no la dupliqué» — no es un criterio de aprobación (S9)',
    ])
    expect(evaluarEfectos(EFECTOS, observacion({ text: 'Total $3.000.' }))).toEqual([])
  })

  it('says nothing when the case declares no informative fragment', () => {
    expect(observarTextoInformativo(undefined, 'cualquier cosa')).toEqual([])
  })
})

describe('scripted-model expectations', () => {
  it('checks the exact call sequence of a fixture-driven run', () => {
    expect(
      evaluarGuion({ toolCalls: ['registrar_venta'] }, observacion()),
    ).toEqual([])

    expect(
      evaluarGuion({ toolCalls: ['listar_productos', 'registrar_venta'] }, observacion()),
    ).toEqual(['tool calls: se esperaban [listar_productos, registrar_venta] y fueron [registrar_venta]'])
  })

  it('requires the wording only where a spec makes it the contract (S7)', () => {
    const observado = observacion({ text: 'No se puede: quedan 2 unidades.' })

    expect(evaluarGuion({ requiredText: ['quedan 2'] }, observado)).toEqual([])
    expect(evaluarGuion({ requiredText: ['quedan 2'] }, observacion({ text: 'No alcanza.' }))).toEqual([
      'texto exigido por la spec: falta «quedan 2» en «No alcanza.»',
    ])
  })
})

describe('case schema guards', () => {
  it('accepts a minimal case', () => {
    expect(problemas(CASO_VALIDO)).toBe('')
  })

  it('rejects an exact tool-call sequence inside `expect`, which every tier must satisfy', () => {
    expect(problemas({ ...CASO_VALIDO, expect: { sales: { count: 1 }, toolCalls: ['registrar_venta'] } })).toContain(
      'toolCalls',
    )
  })

  it('rejects an exact model-call count inside `expect`', () => {
    expect(problemas({ ...CASO_VALIDO, expect: { sales: { count: 1 }, modelCalls: 2 } })).toContain('modelCalls')
  })

  it('rejects required wording inside `expect`, which is not an effect', () => {
    expect(
      problemas({ ...CASO_VALIDO, expect: { sales: { count: 1 }, requiredText: ['listo'] } }),
    ).toContain('requiredText')
  })

  it('rejects a case that claims to run live and offline only, and the other way round', () => {
    expect(problemas({ ...CASO_VALIDO, tiers: ['live'] })).toContain('offline')
    expect(problemas({ ...CASO_VALIDO, tiers: ['offline'] })).toContain('expectOffline')
  })

  it('rejects a repeated tier', () => {
    expect(problemas({ ...CASO_VALIDO, tiers: ['offline', 'offline'] })).toContain('un nivel repetido')
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
      expect(Object.keys(caso.expect).length, file).toBeGreaterThan(0)
    }
  })

  it('runs every case offline and only the real-model behaviours live (S8)', () => {
    for (const { file, caso } of casos) expect(caso.tiers, file).toContain('offline')

    const soloOffline = casos.filter(({ caso }) => !caso.tiers.includes('live')).map(({ caso }) => caso.name)
    expect(soloOffline).toEqual(['insufficient stock', 'unknown tool', 'round-trip cap'])
  })

  it('keeps the scripted-only assertions out of the live tier', () => {
    for (const { file, caso } of casos) {
      if (!caso.tiers.includes('live')) continue

      // The schema already rejects these inside `expect`; this pins the intent on the
      // cases themselves: a live run is compared against effects, nothing else.
      expect(Object.keys(caso.expect).sort(), file).not.toContain('toolCalls')
      expect(caso.expect, file).not.toHaveProperty('modelCalls')
    }
  })

  it('requires wording in exactly one case, and says which spec line demands it', () => {
    const conTextoExigido = casos.filter(({ caso }) => (caso.expectOffline?.requiredText ?? []).length > 0)

    expect(conTextoExigido.map(({ caso }) => caso.name)).toEqual(['insufficient stock'])
    expect(conTextoExigido[0].caso.specs).toContain('S7')
    expect(conTextoExigido[0].caso.tiers).toEqual(['offline'])
  })

  it('keeps every remaining text fragment as informative, never as a criterion', () => {
    for (const { file, caso } of casos) {
      expect(caso.expect, file).not.toHaveProperty('textIncludes')
      expect(caso.expectOffline ?? {}, file).not.toHaveProperty('textIncludes')
    }
  })
})
