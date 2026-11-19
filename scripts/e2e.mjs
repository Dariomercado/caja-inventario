#!/usr/bin/env node
// Arranque de los e2e.
//
// Los tests de navegador escriben datos de verdad: crean ventas y descuentan
// stock. Por eso no pueden compartir base con nada. Este script usa una base
// dedicada —`caja_e2e`— la crea si no existe, la deja vacía, aplica migraciones y
// siembra antes de levantar el navegador.
//
// Las dos guardas, en este orden, y ninguna es opcional:
//   1. El host tiene que ser esta máquina. El `.env` de este repo apunta a Supabase
//      de producción; sin este chequeo la suite vendería azúcar real.
//   2. El nombre de la base tiene que terminar en `_e2e`, igual que los tests de
//      servicios exigen `_test` (ver `src/test/guard.ts`). Vaciar el schema es
//      destructivo y la única defensa razonable es que el nombre grite que es
//      descartable.
import { spawnSync } from 'node:child_process'
import { createConnection } from 'node:net'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import pg from 'pg'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const URL_POR_DEFECTO = 'postgres://caja:caja@127.0.0.1:5433/caja_e2e'
const HOSTS_LOCALES = ['127.0.0.1', 'localhost', '::1']
const SUFIJO = '_e2e'

function fallar(mensaje) {
  console.error(`\n[e2e] ${mensaje}\n`)
  process.exit(1)
}

const base = process.env['DATABASE_URL'] ?? URL_POR_DEFECTO

let url
try {
  url = new URL(base)
} catch {
  fallar(`DATABASE_URL no es una URL válida: ${base}`)
}

if (!HOSTS_LOCALES.includes(url.hostname)) {
  fallar(
    `DATABASE_URL apunta a "${url.hostname}", que no es esta máquina.\n` +
      '      Los e2e crean ventas y descuentan stock: sólo pueden correr contra una base local.',
  )
}

const nombreBase = url.pathname.replace(/^\//, '')
if (!nombreBase.endsWith(SUFIJO) || !/^[a-z0-9_]+$/i.test(nombreBase)) {
  fallar(
    `la base "${nombreBase}" no termina en "${SUFIJO}".\n` +
      '      Los e2e vacían el schema antes de correr, así que el nombre tiene que\n' +
      `      identificar una base descartable. Por defecto usan ${URL_POR_DEFECTO}`,
  )
}

const puerto = Number(url.port || 5432)

async function esperarElPuerto() {
  await new Promise((listo, falla) => {
    const socket = createConnection({ host: url.hostname, port: puerto })
    socket.setTimeout(2000)
    socket.on('connect', () => {
      socket.destroy()
      listo()
    })
    socket.on('timeout', () => {
      socket.destroy()
      falla(new Error('timeout'))
    })
    socket.on('error', falla)
  }).catch(() => {
    fallar(
      `no hay base escuchando en ${url.hostname}:${puerto}.\n` +
        '      Levantala con `npm run db:up` (Docker Compose) y volvé a intentar.',
    )
  })
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

await esperarElPuerto()
await asegurarLaBase()
await vaciarLaBase()

ejecutar('aplicando migraciones', 'node_modules/prisma/build/index.js', ['migrate', 'deploy'])
ejecutar('sembrando datos de demo', 'node_modules/prisma/build/index.js', ['db', 'seed'])
ejecutar('corriendo Playwright', 'node_modules/@playwright/test/cli.js', [
  'test',
  ...process.argv.slice(2),
])
