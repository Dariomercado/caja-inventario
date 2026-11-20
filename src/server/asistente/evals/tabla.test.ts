import { describe, expect, it } from 'vitest'
import type { ResultadoCaso } from './runner'
import { estadoDeFila, filasConOmitidos, formatearTabla, resumirNivel } from './tabla'

/**
 * The tier rules of S8, as data: a case that does not declare the running tier is
 * a `skip` row, never a `PASS`, and the per-tier total counts only what ran.
 *
 * These live here and not in `scripts/evals.mjs` so a rule the live table depends
 * on cannot be broken without a test noticing.
 */

function resultado(nombre: string, cambios: Partial<ResultadoCaso> = {}): ResultadoCaso {
  return {
    name: nombre,
    ok: true,
    skipped: false,
    failures: [],
    informative: [],
    toolCalls: ['listar_productos', 'registrar_venta'],
    inputTokens: 1_000,
    outputTokens: 50,
    latencyMs: 120,
    ...cambios,
    // Después del spread, para que el campo obligatorio no quede `| undefined`.
    transcripcion: cambios.transcripcion ?? { texto: '', llamadas: [] },
  }
}

const CASOS = [{ caso: { name: 'simple sale' } }, { caso: { name: 'unknown tool' } }, { caso: { name: 'replay' } }]

describe('tier rows', () => {
  it('renders a case that did not run in this tier as skip, in file order', () => {
    const filas = filasConOmitidos(CASOS, [resultado('simple sale'), resultado('replay')])

    expect(filas.map((fila) => [fila.name, estadoDeFila(fila)])).toEqual([
      ['simple sale', 'PASS'],
      ['unknown tool', 'skip'],
      ['replay', 'PASS'],
    ])
  })

  it('describes a skipped case as nothing ran, nothing claimed', () => {
    const [, omitido] = filasConOmitidos(CASOS, [resultado('simple sale'), resultado('replay')])

    expect(omitido).toMatchObject({
      name: 'unknown tool',
      ok: true,
      skipped: true,
      failures: [],
      toolCalls: [],
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
    })
  })

  it('never reports a skipped case as a pass', () => {
    const filas = filasConOmitidos(CASOS, [])

    expect(filas.map(estadoDeFila)).toEqual(['skip', 'skip', 'skip'])
    expect(filas.some((fila) => estadoDeFila(fila) === 'PASS')).toBe(false)
  })

  it('reports a real failure as FAIL', () => {
    expect(estadoDeFila(resultado('replay', { ok: false, failures: ['ventas: se esperaba 1 y hay 2'] }))).toBe('FAIL')
  })
})

describe('tier total', () => {
  const filas = filasConOmitidos(
    CASOS,
    [resultado('simple sale'), resultado('replay', { inputTokens: 2_000, outputTokens: 80 })],
  )

  it('counts only the cases that ran and says how many were skipped', () => {
    expect(resumirNivel(filas)).toMatchObject({ casos: 2, pasaron: 2, fallaron: 0, omitidos: 1 })
  })

  it('adds tokens and latency of the runs only', () => {
    expect(resumirNivel(filas)).toMatchObject({ inputTokens: 3_000, outputTokens: 130, latencyMs: 240 })
  })

  it('counts a failing run as fail, and a skipped case as neither', () => {
    const conFalla = filasConOmitidos(CASOS, [
      resultado('simple sale', { ok: false, failures: ['ventas: se esperaba 1 y hay 0'] }),
      resultado('replay'),
    ])

    expect(resumirNivel(conFalla)).toMatchObject({ casos: 2, pasaron: 1, fallaron: 1, omitidos: 1 })
  })
})

describe('table', () => {
  it('writes the skipped row as skip, without tokens or tool calls', () => {
    const tabla = formatearTabla('live', filasConOmitidos(CASOS, [resultado('simple sale'), resultado('replay')]))
    const lineaOmision = tabla.split('\n').find((linea) => linea.startsWith('unknown tool')) ?? ''

    expect(lineaOmision).toContain('skip')
    expect(lineaOmision).not.toContain('PASS')
    expect(lineaOmision).not.toContain('listar_productos')
    expect(lineaOmision).toMatch(/skip\s+-\s+-\s+-\s+-/)
    expect(tabla).toContain('TOTAL (2 cases, 2 pass, 0 fail, 1 skipped)')
  })

  it('leaves the total without a skip count when every case ran', () => {
    const tabla = formatearTabla('offline', [
      resultado('simple sale'),
      resultado('unknown tool'),
      resultado('replay'),
    ])

    expect(tabla).toContain('TOTAL (3 cases, 3 pass, 0 fail)')
    expect(tabla).not.toContain('skip')
  })

  it('shows a failing case as FAIL with its reason available to the caller', () => {
    const falla = resultado('replay', { ok: false, failures: ['ventas: se esperaba 1 y hay 2'] })
    const tabla = formatearTabla('live', [resultado('simple sale'), falla])

    expect(tabla).toContain('FAIL')
    expect(tabla).toContain('TOTAL (2 cases, 1 pass, 1 fail)')
    expect(falla.failures).toEqual(['ventas: se esperaba 1 y hay 2'])
  })
})

describe('exit rule', () => {
  const fallan = (filas: ResultadoCaso[]) => filas.some((fila) => !fila.ok)

  it('does not fail because of a skipped case', () => {
    expect(fallan(filasConOmitidos(CASOS, [resultado('simple sale'), resultado('replay')]))).toBe(false)
  })

  it('fails when a case that ran failed', () => {
    expect(fallan([resultado('simple sale', { ok: false, failures: ['ventas: se esperaba 1 y hay 0'] })])).toBe(true)
  })
})
