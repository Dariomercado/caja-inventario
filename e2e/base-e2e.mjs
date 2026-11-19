// Reglas de la base de los e2e, en un solo lugar.
//
// Las necesitan dos caminos distintos: `scripts/e2e.mjs` (que prepara la base y
// después corre Playwright) y `playwright.config.ts`, porque alguien puede invocar
// `npx playwright test` a mano y ese camino tiene que ser tan seguro como el
// script. Duplicar la regla era el riesgo de que un día se cambie en un lado solo.
export const PUERTO_E2E = 3100

// Marca que deja `scripts/e2e.mjs` en el entorno cuando ya preparó la base, para que
// el `globalSetup` de Playwright no la vacíe ni vuelva a migrar en la misma corrida.
export const MARCA_PREPARADA = 'E2E_BASE_PREPARADA'

// Default del script cuando no hay `DATABASE_URL` en el entorno. El config NO lo usa
// a propósito: ahí el entorno vacío se rechaza, para que un `npx playwright test` sin
// variables no termine escribiendo en la base que diga el `.env` real.
export const URL_POR_DEFECTO = 'postgres://caja:caja@127.0.0.1:5433/caja_e2e'

// Mismo criterio que `src/test/guard.ts` con `_test`: el nombre tiene que gritar
// que la base es descartable, porque los e2e la vacían y escriben datos.
export const SUFIJO_BASE = '_e2e'

// `new URL()` devuelve el host IPv6 entre corchetes, así que `::1` no matchea.
export const HOSTS_LOCALES = ['127.0.0.1', 'localhost', '[::1]']

const HINT = 'Usá `npm run test:e2e`, que prepara esa base antes de arrancar.'

/**
 * Valida la URL de la base de los e2e y la devuelve desarmada.
 * @param {string} texto
 * @returns {{ url: URL, nombreBase: string, puerto: number }}
 */
export function validarBaseE2E(texto) {
  let url
  try {
    url = new URL(texto)
  } catch {
    throw new Error(
      `DATABASE_URL no es una URL válida: "${texto || '(sin definir)'}".\n${HINT}`,
    )
  }

  if (!HOSTS_LOCALES.includes(url.hostname)) {
    throw new Error(
      `DATABASE_URL apunta a "${url.hostname}", que no es esta máquina.\n` +
        'Los e2e crean ventas y descuentan stock: sólo pueden correr contra una base local.\n' +
        HINT,
    )
  }

  const nombreBase = url.pathname.replace(/^\//, '')

  if (!nombreBase.endsWith(SUFIJO_BASE) || !/^[a-z0-9_]+$/i.test(nombreBase)) {
    throw new Error(
      `la base "${nombreBase}" no termina en "${SUFIJO_BASE}".\n` +
        'Los e2e vacían el schema antes de correr, así que el nombre tiene que\n' +
        `identificar una base descartable.\n${HINT}`,
    )
  }

  return { url, nombreBase, puerto: Number(url.port || 5432) }
}

/**
 * Presenta un error con el mismo formato que `fallar()` en `scripts/e2e.mjs`: el
 * prefijo `[e2e]` y una línea en blanco arriba y abajo. Lo usan las puertas que no
 * pasan por ese script —el config y el globalSetup de Playwright— para que quien
 * corre `npx playwright test` a mano lea la misma explicación y no una traza cruda.
 * @param {unknown} error
 * @returns {Error}
 */
export function conPrefijoE2E(error) {
  const motivo = error instanceof Error ? error.message : String(error)
  return new Error(`\n${motivo.startsWith('[e2e]') ? motivo : `[e2e] ${motivo}`}\n`)
}

/**
 * Valida la URL de la base y tira el rechazo ya formateado.
 * @param {string} texto
 * @returns {{ url: URL, nombreBase: string, puerto: number }}
 */
export function validarBaseConMensaje(texto) {
  try {
    return validarBaseE2E(texto)
  } catch (error) {
    throw conPrefijoE2E(error)
  }
}
