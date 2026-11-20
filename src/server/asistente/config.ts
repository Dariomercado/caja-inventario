/**
 * Configuración del asistente (S2).
 *
 * El modelo no vive en el código: endpoint, nombre y temperatura son variables de
 * entorno. Cambiar de modelo —o de proveedor— no toca el harness ni las evals.
 *
 * Este proyecto no tiene capa de validación de entorno; cada consumidor lee
 * `process.env` y falla recién cuando se usa (`src/lib/db.ts`, `src/server/auth.ts`).
 * Acá se sigue esa convención, pero las claves del asistente quedan juntas en un
 * lugar para que nadie las busque dispersas.
 */

export type ConfigModelo = {
  baseUrl: string
  apiKey: string
  nombre: string
  temperatura: number
  /** Tope de rondas con herramientas por pedido (S10). */
  maxRondas: number
  /** Tope de productos que se le pasan al modelo en una respuesta (S11). */
  maxProductos: number
  /** Corte de una llamada colgada: sin esto el panel queda esperando para siempre. */
  tiempoMaximoMs: number
}

export type ConfigAsistente = {
  modelo: ConfigModelo
  api: {
    /** Origen de esta misma aplicación; el cliente le agrega la ruta `/api/v1`. */
    baseUrl: string
    /** Token de scopes acotados, no la cookie del panel (S4). */
    token: string
  }
}

export const MODELO_BASE_URL_POR_DEFECTO = 'https://api.z.ai/api/paas/v4/'
export const MODELO_POR_DEFECTO = 'glm-5.3-flash'
export const TEMPERATURA_POR_DEFECTO = 0.2
export const MAX_RONDAS_POR_DEFECTO = 4
export const MAX_PRODUCTOS_POR_DEFECTO = 20
export const TIEMPO_MAXIMO_POR_DEFECTO = 60_000

export class ConfigIncompletaError extends Error {
  readonly faltantes: string[]

  constructor(faltantes: string[]) {
    super(`Falta configurar el asistente: ${faltantes.join(', ')}`)
    this.name = 'ConfigIncompletaError'
    this.faltantes = faltantes
  }
}

export class ConfigInvalidaError extends Error {
  constructor(variable: string, valor: string, esperado: string) {
    super(`${variable} no es válida ("${valor}"): se esperaba ${esperado}`)
    this.name = 'ConfigInvalidaError'
  }
}

export function configDesde(
  env: Record<string, string | undefined> = process.env,
): ConfigAsistente {
  const faltantes: string[] = []

  const texto = (variable: string, porDefecto?: string): string => {
    const valor = env[variable]?.trim()
    if (valor) return valor
    if (porDefecto !== undefined) return porDefecto
    faltantes.push(variable)
    return ''
  }

  const numero = (variable: string, porDefecto: number, minimo: number, maximo = Number.MAX_SAFE_INTEGER): number => {
    const crudo = env[variable]?.trim()
    if (!crudo) return porDefecto
    const valor = Number(crudo)
    if (!Number.isFinite(valor) || valor < minimo || valor > maximo) {
      throw new ConfigInvalidaError(variable, crudo, `un número entre ${minimo} y ${maximo}`)
    }
    return valor
  }

  const config: ConfigAsistente = {
    modelo: {
      baseUrl: texto('ASISTENTE_MODELO_BASE_URL', MODELO_BASE_URL_POR_DEFECTO),
      apiKey: texto('ASISTENTE_MODELO_API_KEY'),
      nombre: texto('ASISTENTE_MODELO', MODELO_POR_DEFECTO),
      temperatura: numero('ASISTENTE_MODELO_TEMPERATURA', TEMPERATURA_POR_DEFECTO, 0, 2),
      maxRondas: numero('ASISTENTE_MAX_RONDAS', MAX_RONDAS_POR_DEFECTO, 1, 20),
      maxProductos: numero('ASISTENTE_MAX_PRODUCTOS', MAX_PRODUCTOS_POR_DEFECTO, 1, 100),
      tiempoMaximoMs: numero('ASISTENTE_TIEMPO_MAXIMO_MS', TIEMPO_MAXIMO_POR_DEFECTO, 1_000),
    },
    api: {
      baseUrl: texto('ASISTENTE_API_URL'),
      token: texto('ASISTENTE_API_TOKEN'),
    },
  }

  // Los faltantes se informan todos juntos: descubrirlos de a uno, arrancando el
  // panel, es la peor forma de configurar esto.
  if (faltantes.length > 0) throw new ConfigIncompletaError(faltantes)

  return config
}
