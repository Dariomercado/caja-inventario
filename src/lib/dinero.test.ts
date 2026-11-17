import { describe, expect, it } from 'vitest'
import { formatearCentavos, pesosACentavos } from './dinero'

describe('formatearCentavos', () => {
  it('muestra pesos con dos decimales', () => {
    // Intl usa espacio duro entre el símbolo y el número según la versión de ICU;
    // se normaliza para que la aserción no dependa de eso.
    const texto = formatearCentavos(450_000).replace(/\u00a0/g, ' ')
    expect(texto).toContain('4.500,00')
    expect(texto).toContain('$')
  })

  it('no pierde centavos por redondeo', () => {
    const texto = formatearCentavos(1_999).replace(/\u00a0/g, ' ')
    expect(texto).toContain('19,99')
  })
})

describe('pesosACentavos', () => {
  it('lee el formato argentino con separador de miles', () => {
    expect(pesosACentavos('1.234,56')).toBe(123_456)
  })

  it('lee sin separador de miles', () => {
    expect(pesosACentavos('4500,5')).toBe(450_050)
  })

  it('lee un entero', () => {
    expect(pesosACentavos('4500')).toBe(450_000)
  })

  it('lee un punto como separador de miles cuando tiene tres dígitos detrás', () => {
    expect(pesosACentavos('1.234')).toBe(123_400)
    expect(pesosACentavos('1.234.567')).toBe(123_456_700)
  })

  it('rechaza el punto decimal en vez de adivinar', () => {
    // "1234.56" es ambiguo: en formato argentino el punto es de miles, así que
    // leerlo como decimal o como miles difiere en un factor 100. Se rechaza.
    expect(pesosACentavos('1234.56')).toBeNull()
    expect(pesosACentavos('12.34')).toBeNull()
  })

  it('devuelve null con texto que no es un monto', () => {
    expect(pesosACentavos('')).toBeNull()
    expect(pesosACentavos('abc')).toBeNull()
    expect(pesosACentavos('-100')).toBeNull()
    expect(pesosACentavos('12,345')).toBeNull()
  })

  it('sobrevive al viaje de ida y vuelta', () => {
    for (const centavos of [0, 1, 99, 100, 450_000, 12_345_678]) {
      expect(pesosACentavos(String(centavos / 100).replace('.', ','))).toBe(centavos)
    }
  })
})
