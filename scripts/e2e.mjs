#!/usr/bin/env node
// Arranque de los e2e.
//
// Los tests de navegador escriben datos de verdad: crean ventas y descuentan
// stock. Por eso no pueden compartir base con nada. Este script usa una base
// dedicada —`caja_e2e`— la crea si no existe, la deja vacía, aplica migraciones y
// siembra antes de levantar el navegador.
//
// Tres guardas, en este orden, y ninguna es opcional:
//   1. El host tiene que ser esta máquina. El `.env` de este repo apunta a Supabase
//      de producción; sin este chequeo la suite vendería azúcar real.
//   2. El nombre de la base tiene que terminar en `_e2e`, igual que los tests de
//      servicios exigen `_test` (ver `src/test/guard.ts`).
//   3. El puerto de la app tiene que estar libre. Playwright no reutiliza
//      servidores, así que un puerto ocupado lo haría fallar; avisarlo acá convierte
//      un error de bind en una explicación.
//
// La regla 1 y la 2 viven en `e2e/base-e2e.mjs` porque `playwright.config.ts`
// necesita exactamente las mismas: `npx playwright test` a mano también tiene que
// ser seguro. La preparación de la base vive en `e2e/preparar.mjs`, que además usa
// el `globalSetup` de Playwright para que ese otro camino siembre igual.
import { spawnSync } from 'node:child_process'
import { createConnection } from 'node:net'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { validarBaseE2E, PUERTO_E2E, MARCA_PREPARADA, URL_POR_DEFECTO } from '../e2e/base-e2e.mjs'
import { prepararBase } from '../e2e/preparar.mjs'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function fallar(mensaje) {
  console.error(`\n[e2e] ${mensaje}\n`)
  process.exit(1)
}

const base = process.env['DATABASE_URL'] ?? URL_POR_DEFECTO

let validada
try {
  validada = validarBaseE2E(base)
} catch (error) {
  fallar(error.message)
}

const { url } = validada
const puertoBase = validada.puerto

/** ¿Hay algo escuchando en `host:puerto`? Resuelve true/false. */
function hayAlguien(host, puerto) {
  return new Promise((listo) => {
    const socket = createConnection({ host, port: puerto })
    socket.setTimeout(1500)
    socket.on('connect', () => {
      socket.destroy()
      listo(true)
    })
    socket.on('timeout', () => {
      socket.destroy()
      listo(false)
    })
    socket.on('error', () => listo(false))
  })
}

if (!(await hayAlguien(url.hostname.replace(/^\[|\]$/g, ''), puertoBase))) {
  fallar(
    `no hay base escuchando en ${url.hostname}:${puertoBase}.\n` +
      '      Levantala con `npm run db:up` (Docker Compose) y volvé a intentar.',
  )
}

if (await hayAlguien('127.0.0.1', PUERTO_E2E)) {
  fallar(
    `el puerto ${PUERTO_E2E} ya está ocupado.\n` +
      '      Los e2e levantan su propio servidor con la base de pruebas y no se enganchan\n' +
      '      a uno ajeno: si ese servidor apunta a producción, el test de venta crearía una\n' +
      '      venta real. Pará lo que esté escuchando ahí (un `npm run dev`, por ejemplo).',
  )
}

console.log(`[e2e] base de los e2e: ${base}`)

try {
  await prepararBase(base, RAIZ)
} catch (error) {
  fallar(error instanceof Error ? error.message : String(error))
}

const entorno = {
  ...process.env,
  DATABASE_URL: base,
  DIRECT_URL: base,
  // Ya está preparada: el `globalSetup` de Playwright no la vacía de nuevo.
  [MARCA_PREPARADA]: '1',
}

function ejecutar(etiqueta, entrada, argumentos) {
  const archivo = resolve(RAIZ, entrada)
  if (!existsSync(archivo)) {
    fallar(`falta ${entrada}. Corré \`npm install\` antes de los e2e.`)
  }
  console.log(`[e2e] ${etiqueta}`)
  const resultado = spawnSync(process.execPath, [archivo, ...argumentos], {
    cwd: RAIZ,
    env: entorno,
    stdio: 'inherit',
  })
  if (resultado.status !== 0) {
    process.exit(resultado.status ?? 1)
  }
}

ejecutar('corriendo Playwright', 'node_modules/@playwright/test/cli.js', [
  'test',
  ...process.argv.slice(2),
])
