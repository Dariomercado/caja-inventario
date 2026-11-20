import type { ResultadoCaso } from './runner'

/**
 * The per-tier table of S14, and the tier rule of S8 that it has to respect.
 *
 * Two decisions live here instead of in `scripts/evals.mjs`, because they are rules
 * and not formatting:
 *
 * 1. A case that does not declare the running tier is a `skip` row. Printing it as
 *    `PASS` would count as live evidence something the live tier never ran, which is
 *    the confusion S8 warns about.
 * 2. The total counts the cases that actually ran, and says how many were skipped.
 *
 * The table is a string so the rules can be tested without a database or a provider.
 */

export type EstadoDeFila = 'PASS' | 'FAIL' | 'skip'

export type ResumenNivel = {
  /** Cases that ran in this tier. */
  casos: number
  pasaron: number
  fallaron: number
  /** Cases the tier did not declare, so nothing ran and nothing is claimed. */
  omitidos: number
  inputTokens: number
  outputTokens: number
  latencyMs: number
}

export function estadoDeFila(resultado: ResultadoCaso): EstadoDeFila {
  if (resultado.skipped) return 'skip'
  return resultado.ok ? 'PASS' : 'FAIL'
}

/**
 * One row per versioned case, in file order.
 *
 * The caller runs only the cases that declare the tier; this fills the rest with an
 * explicit omission so the table still shows all nine behaviours and which of them
 * the tier covered.
 */
export function filasConOmitidos(
  casos: { caso: { name: string } }[],
  resultados: ResultadoCaso[],
): ResultadoCaso[] {
  const porNombre = new Map(resultados.map((resultado) => [resultado.name, resultado]))

  return casos.map(
    ({ caso }) =>
      porNombre.get(caso.name) ?? {
        name: caso.name,
        ok: true,
        skipped: true,
        failures: [],
        informative: [],
        toolCalls: [],
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
      },
  )
}

function sumar(resultados: ResultadoCaso[], campo: 'inputTokens' | 'outputTokens' | 'latencyMs'): number {
  return resultados.reduce((total, resultado) => total + resultado[campo], 0)
}

export function resumirNivel(resultados: ResultadoCaso[]): ResumenNivel {
  const ejecutados = resultados.filter((resultado) => !resultado.skipped)
  const pasaron = ejecutados.filter((resultado) => resultado.ok).length

  return {
    casos: ejecutados.length,
    pasaron,
    fallaron: ejecutados.length - pasaron,
    omitidos: resultados.length - ejecutados.length,
    inputTokens: sumar(ejecutados, 'inputTokens'),
    outputTokens: sumar(ejecutados, 'outputTokens'),
    latencyMs: sumar(ejecutados, 'latencyMs'),
  }
}

export function formatearTabla(titulo: string, filas: ResultadoCaso[]): string {
  const anchoCaso = Math.max(4, ...filas.map((fila) => fila.name.length))
  const llamadas = (fila: ResultadoCaso) => (fila.skipped ? '-' : fila.toolCalls.join(' → '))
  const anchoLlamadas = Math.max(10, ...filas.map((fila) => llamadas(fila).length))

  const cabecera =
    `${'case'.padEnd(anchoCaso)}  ${'result'.padEnd(6)}  ${'tool calls'.padEnd(anchoLlamadas)}  ` +
    `${'in tok'.padStart(7)}  ${'out tok'.padStart(7)}  ${'ms'.padStart(6)}`
  const linea = '-'.repeat(cabecera.length)

  const filasTexto = filas.map((fila) => {
    const numeros = fila.skipped
      ? ['-', '-', '-']
      : [String(fila.inputTokens), String(fila.outputTokens), String(fila.latencyMs)]

    return (
      `${fila.name.padEnd(anchoCaso)}  ${estadoDeFila(fila).padEnd(6)}  ` +
      `${llamadas(fila).padEnd(anchoLlamadas)}  ` +
      `${numeros[0].padStart(7)}  ${numeros[1].padStart(7)}  ${numeros[2].padStart(6)}`
    )
  })

  const resumen = resumirNivel(filas)
  const totalTexto =
    `TOTAL (${resumen.casos} cases, ${resumen.pasaron} pass, ${resumen.fallaron} fail` +
    `${resumen.omitidos > 0 ? `, ${resumen.omitidos} skipped` : ''})`
  const relleno = ' '.repeat(Math.max(0, anchoCaso + 2 + 6 + 2 + anchoLlamadas - totalTexto.length))
  const total =
    `${totalTexto}${relleno}  ${String(resumen.inputTokens).padStart(7)}  ` +
    `${String(resumen.outputTokens).padStart(7)}  ${String(resumen.latencyMs).padStart(6)}`

  return [titulo, linea, cabecera, linea, ...filasTexto, linea, total, linea].join('\n')
}
