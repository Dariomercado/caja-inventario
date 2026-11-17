// El dinero se guarda en centavos enteros y sólo se convierte a pesos en la
// frontera con la persona: al mostrar y al leer un formulario.

export function formatearCentavos(centavos: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(centavos / 100)
}

/**
 * Convierte lo que escribe una persona a centavos enteros, sin pasar por punto
 * flotante en ningún momento.
 *
 * Formatos aceptados (argentino): "1.234,56", "1234,56", "1.234", "1234".
 *
 * Regla de ambigüedad: sin coma, un punto SOLO puede ser separador de miles, y
 * sólo si detrás hay exactamente tres dígitos. Por eso "1234.56" se rechaza en vez
 * de adivinarse: leerlo como miles multiplica el monto por 100, y un error de 100x
 * en una caja es mucho peor que un formulario pidiendo que lo corrijas.
 *
 * Devuelve null si el texto no es un monto válido, para que el llamador decida qué
 * mostrar en vez de recibir un NaN silencioso.
 */
export function pesosACentavos(entrada: string): number | null {
  const limpio = entrada.trim().replace(/\s/g, '')
  if (!limpio) return null

  const partesComa = limpio.split(',')

  let entero: string
  let decimales: string

  if (partesComa.length === 2) {
    // Con coma, los puntos son separadores de miles y la coma es el decimal.
    entero = partesComa[0].replace(/\./g, '')
    decimales = partesComa[1]

    if (!/^\d+$/.test(entero)) return null
    if (!/^\d{1,2}$/.test(decimales)) return null
  } else if (partesComa.length === 1) {
    const partesPunto = limpio.split('.')

    if (partesPunto.length > 1) {
      const resto = partesPunto.slice(1)
      if (resto.some((parte) => !/^\d{3}$/.test(parte))) return null
      entero = partesPunto.join('')
    } else {
      entero = limpio
    }

    if (!/^\d+$/.test(entero)) return null
    decimales = ''
  } else {
    return null
  }

  const centavos = Number(entero) * 100 + Number(decimales.padEnd(2, '0'))

  return Number.isSafeInteger(centavos) ? centavos : null
}
