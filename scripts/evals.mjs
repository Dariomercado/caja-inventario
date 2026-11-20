#!/usr/bin/env node
// Eval runner for the inventory assistant (S8, S14).
//
// Two tiers over the same versioned cases:
//   - offline (default): fixtures replayed through the real loop plus an in-process
//     transport for `/api/v1`. No network, no server, no cost, no secrets.
//   - live (`--live`): the same cases against the real provider. It needs
//     `ASISTENTE_MODELO_API_KEY`; without it the live tier is skipped with one line
//     and the exit code stays 0, which is what CI needs.
//
// Three guards, in this order:
//   1. The database name must end in `_test` (same rule as `src/test/guard.ts`).
//      The runner truncates tables before every case; aborting is the only safe
//      answer when the URL points at development or production.
//   2. Each case seeds its own user, token and products, and nothing else. The
//      runner never writes a sale the assistant did not register.
//   3. A failing case never stops the table: it is printed with its mismatches and
//      the process exits 1 at the end.
//
// Usage:
//   DATABASE_URL="postgresql://caja:caja@localhost:5433/caja_test?schema=public" npm run evals
//   DATABASE_URL="postgresql://caja:caja@localhost:5433/caja_test?schema=public" npm run evals -- --live
//
// The live tier reads `ASISTENTE_MODELO_API_KEY` (and optionally
// `ASISTENTE_MODELO` / `ASISTENTE_MODELO_BASE_URL`) from the environment or, if the
// variable is not set, from `.env`.
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const modoLive = process.argv.slice(2).includes('--live')

// The live tier needs the provider key, and the only safe place for it on a
// development machine is `.env` — which is human-controlled and never echoed.
// Loading it here, inside this process, is what lets the live run work without
// exporting a secret in a shell.
//
// `dotenv` never overrides a variable that is already set, so an inline
// `DATABASE_URL` still wins and the `_test` guard below keeps its full meaning: if
// nobody passes one, dotenv fills in the development URL and the guard aborts.
if (modoLive) {
  try {
    const { config } = await import('dotenv')
    config({ path: resolve(RAIZ, '.env'), quiet: true })
  } catch {
    // dotenv is a dev dependency: without it the live tier just needs the variables
    // exported the usual way.
  }
}

function morir(mensaje) {
  console.error(`\n[evals] ${mensaje}\n`)
  process.exit(1)
}

// The guard is imported before anything that opens a connection: a wrong
// `DATABASE_URL` has to abort before the first write, not after it.
const { assertTestDatabase } = await import('../src/test/guard.ts')
try {
  assertTestDatabase()
} catch (error) {
  morir(error instanceof Error ? error.message : String(error))
}

const {
  correrCaso,
  configuracionLiveDesdeEntorno,
  fabricaLive,
  fabricaOffline,
  leerCasos,
} = await import('../src/server/asistente/evals/index.ts')
const { prisma } = await import('../src/lib/db.ts')

const url = new URL(process.env['DATABASE_URL'])
console.log(`[evals] base: ${url.hostname}:${url.port || '5432'}${url.pathname}`)

let casos
try {
  casos = leerCasos(resolve(RAIZ, 'evals/cases'), resolve(RAIZ, 'evals/fixtures'))
} catch (error) {
  morir(error instanceof Error ? error.message : String(error))
}

function sumar(resultados, campo) {
  return resultados.reduce((total, resultado) => total + resultado[campo], 0)
}

function imprimirTabla(titulo, resultados) {
  const anchoCaso = Math.max(4, ...resultados.map((resultado) => resultado.name.length))
  const anchoLlamadas = Math.max(
    10,
    ...resultados.map((resultado) => resultado.toolCalls.join(' → ').length),
  )
  const cabecera = `${'case'.padEnd(anchoCaso)}  ${'result'.padEnd(6)}  ${'tool calls'.padEnd(anchoLlamadas)}  ${'in tok'.padStart(7)}  ${'out tok'.padStart(7)}  ${'ms'.padStart(6)}`
  const linea = '-'.repeat(cabecera.length)

  console.log(`\n${titulo}`)
  console.log(linea)
  console.log(cabecera)
  console.log(linea)

  for (const resultado of resultados) {
    console.log(
      `${resultado.name.padEnd(anchoCaso)}  ${(resultado.ok ? 'PASS' : 'FAIL').padEnd(6)}  ` +
        `${resultado.toolCalls.join(' → ').padEnd(anchoLlamadas)}  ` +
        `${String(resultado.inputTokens).padStart(7)}  ${String(resultado.outputTokens).padStart(7)}  ` +
        `${String(resultado.latencyMs).padStart(6)}`,
    )
  }

  console.log(linea)

  const pasaron = resultados.filter((resultado) => resultado.ok).length
  const fallaron = resultados.length - pasaron
  const resumen = `TOTAL (${resultados.length} cases, ${pasaron} pass, ${fallaron} fail)`
  const relleno = ' '.repeat(Math.max(0, anchoCaso + 2 + 6 + 2 + anchoLlamadas - resumen.length))
  console.log(
    `${resumen}${relleno}  ${String(sumar(resultados, 'inputTokens')).padStart(7)}  ` +
      `${String(sumar(resultados, 'outputTokens')).padStart(7)}  ${String(sumar(resultados, 'latencyMs')).padStart(6)}`,
  )
  console.log(linea)
}

function imprimirFallas(resultados) {
  for (const resultado of resultados.filter((fila) => !fila.ok)) {
    console.log(`\n  FAIL ${resultado.name}`)
    for (const falla of resultado.failures) console.log(`    - ${falla}`)
  }
}

async function correrTier(fabricaDe) {
  const resultados = []

  for (const cargado of casos) {
    try {
      resultados.push(await correrCaso(cargado.caso, fabricaDe(cargado)))
    } catch (error) {
      // A case whose fixture is stale or whose run threw is a failure, not a reason
      // to hide the other eight rows.
      resultados.push({
        name: cargado.caso.name,
        ok: false,
        failures: [`la ejecución falló: ${error instanceof Error ? error.message : String(error)}`],
        toolCalls: [],
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
      })
    }
  }

  return resultados
}

const resultadosOffline = await correrTier((cargado) => fabricaOffline(cargado.fixture))
imprimirTabla('evals · offline tier (fixtures + in-process /api/v1)', resultadosOffline)
imprimirFallas(resultadosOffline)

let resultadosLive = []

if (modoLive) {
  const configuracion = configuracionLiveDesdeEntorno()
  if (!configuracion) {
    console.log('live tier skipped: ASISTENTE_MODELO_API_KEY is not set.')
  } else {
    resultadosLive = await correrTier(() => fabricaLive(configuracion))
    imprimirTabla(`evals · live tier (${configuracion.nombre})`, resultadosLive)
    imprimirFallas(resultadosLive)
  }
}

const todos = [...resultadosOffline, ...resultadosLive]
await prisma.$disconnect()

if (todos.some((resultado) => !resultado.ok)) process.exitCode = 1
