import { describe, expect, it } from 'vitest'
import {
  ConfigIncompletaError,
  ConfigInvalidaError,
  LLAMADAS_POR_DIA_POR_DEFECTO,
  MAX_PRODUCTOS_POR_DEFECTO,
  MAX_RONDAS_POR_DEFECTO,
  MODELO_BASE_URL_POR_DEFECTO,
  MODELO_POR_DEFECTO,
  TEMPERATURA_POR_DEFECTO,
  configDesde,
} from './config'

const COMPLETA = {
  ASISTENTE_MODELO_API_KEY: 'clave-de-prueba',
  ASISTENTE_API_URL: 'https://panel.example.com',
  ASISTENTE_API_TOKEN: 'cji_prueba',
}

describe('configuración del asistente', () => {
  it('con las claves mínimas usa los topes y el modelo del diseño', () => {
    const config = configDesde({ ...COMPLETA })

    expect(config.modelo.baseUrl).toBe(MODELO_BASE_URL_POR_DEFECTO)
    expect(config.modelo.nombre).toBe(MODELO_POR_DEFECTO)
    expect(config.modelo.temperatura).toBe(TEMPERATURA_POR_DEFECTO)
    expect(config.modelo.maxRondas).toBe(MAX_RONDAS_POR_DEFECTO)
    expect(config.modelo.maxProductos).toBe(MAX_PRODUCTOS_POR_DEFECTO)
    expect(config.modelo.maxLlamadasPorDia).toBe(LLAMADAS_POR_DIA_POR_DEFECTO)
    expect(config.api.baseUrl).toBe('https://panel.example.com')
    expect(config.api.token).toBe('cji_prueba')
  })

  it('cambiar de modelo o de proveedor es cambiar variables de entorno', () => {
    const config = configDesde({
      ...COMPLETA,
      ASISTENTE_MODELO_BASE_URL: 'https://otro-proveedor.example.com/v1/',
      ASISTENTE_MODELO: 'glm-5.3',
      ASISTENTE_MODELO_TEMPERATURA: '0.9',
      ASISTENTE_MAX_RONDAS: '2',
      ASISTENTE_MAX_PRODUCTOS: '5',
    })

    expect(config.modelo.baseUrl).toBe('https://otro-proveedor.example.com/v1/')
    expect(config.modelo.nombre).toBe('glm-5.3')
    expect(config.modelo.temperatura).toBe(0.9)
    expect(config.modelo.maxRondas).toBe(2)
    expect(config.modelo.maxProductos).toBe(5)
  })

  it('informa de una vez todas las variables que faltan', () => {
    expect(() => configDesde({})).toThrow(ConfigIncompletaError)

    try {
      configDesde({ ASISTENTE_MODELO_API_KEY: 'sólo-esta' })
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigIncompletaError)
      expect((error as ConfigIncompletaError).faltantes).toEqual([
        'ASISTENTE_API_URL',
        'ASISTENTE_API_TOKEN',
      ])
    }
  })

  it('rechaza un tope que no es un número válido en lugar de usar el valor por defecto', () => {
    expect(() => configDesde({ ...COMPLETA, ASISTENTE_MAX_RONDAS: 'cuatro' })).toThrow(
      ConfigInvalidaError,
    )
    expect(() => configDesde({ ...COMPLETA, ASISTENTE_MAX_RONDAS: '0' })).toThrow(
      ConfigInvalidaError,
    )
    expect(() => configDesde({ ...COMPLETA, ASISTENTE_MODELO_TEMPERATURA: '9' })).toThrow(
      ConfigInvalidaError,
    )
  })
})
