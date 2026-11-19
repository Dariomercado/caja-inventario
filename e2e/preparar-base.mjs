#!/usr/bin/env node
// Prepara la base de los e2e cuando el que arranca es Playwright por su cuenta.
//
// `scripts/e2e.mjs` hace este trabajo en su propio proceso antes de invocar
// Playwright; el `globalSetup` del config no puede importar estos módulos (ver el
// comentario de `e2e/global-setup.mjs`), así que los corre como proceso hijo. Así el
// trabajo pesado —vaciar, migrar, sembrar— vive en un solo lugar y un solo idioma.
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { MARCA_PREPARADA, validarBaseE2E } from './base-e2e.mjs'
import { prepararBase } from './preparar.mjs'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const base = process.env['DATABASE_URL'] ?? ''

function fallar(mensaje) {
  console.error(`\n[e2e] ${mensaje}\n`)
  process.exit(1)
}

if (process.env[MARCA_PREPARADA] === '1') {
  console.log('[e2e] base preparada por `npm run test:e2e`: no se repite')
  process.exit(0)
}

if (base === '') {
  fallar(
    'falta `DATABASE_URL`.\n' +
      '      Este camino lo corre Playwright, y el config ya rechaza el entorno vacío para\n' +
      '      no terminar usando la base del `.env` real. Pasá la base de pruebas a mano\n' +
      '      (ver «E2E con navegador» en el README) o corré `npm run test:e2e`.',
  )
}

try {
  validarBaseE2E(base)
} catch (error) {
  fallar(error.message)
}

try {
  await prepararBase(base, RAIZ)
} catch (error) {
  // `prepararBase` tira los mensajes sin prefijo; el banner `[e2e]` lo pone `fallar`.
  fallar(error instanceof Error ? error.message : String(error))
}
