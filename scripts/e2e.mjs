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
// ser seguro.
import { spawnSync } from 'node:child_process'
import { createConnection } from 'node:net'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import pg from 'pg'
import { validarBaseE2E, PUERTO_E2E } from '../e2e/base-e2e.mjs'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const URL_POR_DEFECTO = 'postgres://caja:caja@127.0.0.1:5433/caja_e2e'

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

const { url, nombreBase } = validada
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

/** Crea la base si falta. `CREATE DATABASE` no corre dentro de una transacción. */
async function asegurarLaBase() {
  const mantenimiento = new URL(base)
  mantenimiento.pathname = '/postgres'

  const cliente = new pg.Client({ connectionString: mantenimiento.toString() })
  await cliente.connect()
  try {
    const { rowCount } = await cliente.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      nombreBase,
    ])
    if (rowCount === 0) {
      await cliente.query(`CREATE DATABASE "${nombreBase}"`)
      console.log(`[e2e] base "${nombreBase}" creada`)
    }
  } finally {
    await cliente.end()
  }
}

/**
 * Vuelve la base a cero. Se borra el schema entero en lugar de truncar tablas una
 * por una: así también se va `_prisma_migrations` y las migraciones se aplican
 * desde el principio, que es el estado que queremos probar.
 */
async function vaciarLaBase() {
  const cliente = new pg.Client({ connectionString: base })
  await cliente.connect()
  try {
    await cliente.query('DROP SCHEMA IF EXISTS public CASCADE')
    await cliente.query('CREATE SCHEMA public')
  } finally {
    await cliente.end()
  }
}

const entorno = { ...process.env, DATABASE_URL: base, DIRECT_URL: base }

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

console.log(`[e2e] base de los e2e: ${base}`)

await asegurarLaBase()
await vaciarLaBase()

ejecutar('aplicando migraciones', 'node_modules/prisma/build/index.js', ['migrate', 'deploy'])
ejecutar('sembrando datos de demo', 'node_modules/prisma/build/index.js', ['db', 'seed'])
ejecutar('corriendo Playwright', 'node_modules/@playwright/test/cli.js', [
  'test',
  ...process.argv.slice(2),
])
