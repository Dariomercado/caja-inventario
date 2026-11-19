// Preparación de la base para cualquier invocación de Playwright.
//
// `npm run test:e2e` prepara la base y después invoca Playwright, pero también se
// puede correr `npx playwright test` a mano. Ese camino escribe los mismos datos, así
// que tiene que dejar la base en el mismo estado: vacía, migrada y sembrada. Si no,
// la segunda corrida manual encuentra la venta y el stock de la primera.
//
// Este archivo es a propósito autosuficiente: sólo usa builtins de Node. Playwright
// compila a CommonJS todo lo que cuelga del config —incluidos los `.mjs`—, y un
// módulo propio importado desde acá termina evaluado con el formato equivocado
// (`exports is not defined in ES module scope`). La preparación real vive en
// `e2e/preparar-base.mjs`, que corre como ESM de verdad en un proceso hijo y es el
// mismo código que usa `scripts/e2e.mjs`.
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

export default async function preparacion() {
  // `playwright test` se invoca desde la raíz del repo, que es donde está el config:
  // `import.meta` no sobrevive a la compilación, así que la ruta sale de ahí.
  const resultado = spawnSync(process.execPath, [resolve('e2e/preparar-base.mjs')], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  })

  if (resultado.status !== 0) {
    throw new Error('\n[e2e] no se pudo preparar la base de los e2e (el detalle quedó arriba)\n')
  }
}
