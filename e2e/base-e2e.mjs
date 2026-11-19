// Reglas de la base de los e2e, en un solo lugar.
//
// Las necesitan dos caminos distintos: `scripts/e2e.mjs` (que prepara la base y
// después corre Playwright) y `playwright.config.ts`, porque alguien puede invocar
// `npx playwright test` a mano y ese camino tiene que ser tan seguro como el
// script. Duplicar la regla era el riesgo de que un día se cambie en un lado solo.
export const PUERTO_E2E = 3100

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
