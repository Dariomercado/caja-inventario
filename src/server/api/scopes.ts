import { ScopeApi } from '../../../generated/prisma/enums'

/**
 * Traducción entre el nombre público de un scope y el valor que guarda Postgres.
 *
 * Son dos vocabularios a propósito. En la base los valores son constantes de un
 * enum (`PRODUCTOS_READ`); en el contrato HTTP son `recurso:acción`, que es lo que
 * un consumidor espera leer en un 403. Si se usara el nombre del enum directamente,
 * renombrar un valor de la base rompería el contrato público sin que nadie lo note.
 */
export const SCOPES_POR_NOMBRE: Record<string, ScopeApi> = {
  'productos:read': ScopeApi.PRODUCTOS_READ,
  'productos:write': ScopeApi.PRODUCTOS_WRITE,
  'ventas:read': ScopeApi.VENTAS_READ,
  'ventas:write': ScopeApi.VENTAS_WRITE,
  'reportes:read': ScopeApi.REPORTES_READ,
}

/** Todos los scopes que existen, en el vocabulario del contrato. */
export const NOMBRES_DE_SCOPE = Object.keys(SCOPES_POR_NOMBRE)

/**
 * Traduce una lista de nombres del contrato a valores de la base.
 * Devuelve `null` si algún nombre no existe: emitir un token con un scope
 * desconocido es un error del emisor, no algo para ignorar en silencio.
 */
export function scopesDesdeNombres(nombres: string[]): ScopeApi[] | null {
  const valores: ScopeApi[] = []
  for (const nombre of nombres) {
    const valor = SCOPES_POR_NOMBRE[nombre]
    if (valor === undefined) return null
    valores.push(valor)
  }
  return valores
}

/** Traduce valores de la base al vocabulario del contrato, en orden estable. */
export function nombresDesdeScopes(scopes: ScopeApi[]): string[] {
  return NOMBRES_DE_SCOPE.filter((nombre) => scopes.includes(SCOPES_POR_NOMBRE[nombre]))
}
