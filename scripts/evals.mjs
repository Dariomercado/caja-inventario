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
// Each tier runs only the cases that declare it (`tiers` in `evals/cases`). A case
// that does not declare the running tier is printed as `skip`, never as `PASS`, and
// the total counts only what ran: the offline tier proves the harness and the live
// tier proves the model, and a table that mixed them would claim the second with
// the first (S8).
//
// Usage:
//   DATABASE_URL="postgresql://caja:caja@localhost:5433/caja_test?schema=public" npm run evals
//   DATABASE_URL="postgresql://caja:caja@localhost:5433/caja_test?schema=public" npm run evals -- --live
//   DATABASE_URL="postgresql://caja:caja@localhost:5433/caja_test?schema=public" npm run evals -- --live --grabar
//
// `--grabar` records the live run into `evals/fixtures/<case>.json`, in the same format
// the offline tier loads, and then re-runs the offline tier from what it wrote. It
// requires `--live`, and a case whose live run failed never replaces its fixture: the
// hand-authored baseline is what makes the suite runnable, so a capture that does not
// reproduce an effect is reported, not adopted.
//
// The live tier reads `ASISTENTE_MODELO_API_KEY` (and optionally
// `ASISTENTE_MODELO` / `ASISTENTE_MODELO_BASE_URL`) from the environment or, if the
// variable is not set, from `.env`.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argumentos = process.argv.slice(2)
const modoLive = argumentos.includes('--live')
const modoGrabar = argumentos.includes('--grabar')

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

// Recording is a property of the live tier: there is nothing to record offline, where
// the model is a file we already have. Failing here is the only honest answer — the
// alternative is running the whole suite and writing nothing.
if (modoGrabar && !modoLive) {
  morir('--grabar necesita --live: sólo se graba el modelo real. Ejemplo: npm run evals -- --live --grabar')
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
  decidirGrabado,
  fabricaLive,
  fabricaOffline,
  filasConOmitidos,
  formatearTabla,
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

function imprimirFallas(resultados) {
  for (const resultado of resultados.filter((fila) => !fila.ok)) {
    console.log(`\n  FAIL ${resultado.name}`)
    for (const falla of resultado.failures) console.log(`    - ${falla}`)
  }
}

/**
 * Runs one tier over the cases that declare it.
 *
 * The tier list is built before running anything, so this tier never seeds nor
 * executes a case it cannot judge. The result carries one row per case, in file
 * order, with `skip` where nothing ran; the captures are only for the cases that
 * actually ran with a recording factory.
 */
async function correrTier(nivel, fabricaDe) {
  const delNivel = casos.filter(({ caso }) => caso.tiers.includes(nivel))
  const resultados = []
  const capturas = []

  for (const cargado of delNivel) {
    const fabrica = fabricaDe(cargado)

    try {
      const resultado = await correrCaso(cargado.caso, fabrica)
      resultados.push(resultado)

      if (typeof fabrica.captura === 'function') {
        capturas.push({
          file: cargado.file,
          fixture: cargado.caso.fixture,
          captura: fabrica.captura(),
          ok: resultado.ok,
          skipped: resultado.skipped,
          intentos: cargado.caso.request.attempts,
        })
      }
    } catch (error) {
      // A case whose fixture is stale or whose run threw is a failure, not a reason
      // to hide the other rows. Nothing is recorded: a half capture is not a fixture.
      resultados.push({
        name: cargado.caso.name,
        ok: false,
        skipped: false,
        failures: [`la ejecución falló: ${error instanceof Error ? error.message : String(error)}`],
        informative: [],
        toolCalls: [],
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
      })
    }
  }

  return { filas: filasConOmitidos(casos, resultados), capturas }
}

/** The offline tier as the files on disk are right now, for the post-recording re-run. */
async function correrOfflineDesdeArchivos() {
  const releidos = leerCasos(resolve(RAIZ, 'evals/cases'), resolve(RAIZ, 'evals/fixtures'))
  const resultados = []

  for (const cargado of releidos) {
    try {
      resultados.push(await correrCaso(cargado.caso, fabricaOffline(cargado.fixture)))
    } catch (error) {
      resultados.push({
        name: cargado.caso.name,
        ok: false,
        skipped: false,
        failures: [`la ejecución falló: ${error instanceof Error ? error.message : String(error)}`],
        informative: [],
        toolCalls: [],
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
      })
    }
  }

  return filasConOmitidos(releidos, resultados)
}

const offline = await correrTier('offline', (cargado) => fabricaOffline(cargado.fixture))
console.log(`\n${formatearTabla('evals · offline tier (fixtures + in-process /api/v1)', offline.filas)}`)
imprimirFallas(offline.filas)

let live = { filas: [], capturas: [] }

if (modoLive) {
  const configuracion = configuracionLiveDesdeEntorno()
  if (!configuracion) {
    console.log('live tier skipped: ASISTENTE_MODELO_API_KEY is not set.')
    if (modoGrabar) console.log('[grabar] no se escribió ninguna fixture: no hubo corrida live que grabar.')
  } else {
    live = await correrTier('live', () => fabricaLive(configuracion, { grabar: modoGrabar }))
    console.log(`\n${formatearTabla(`evals · live tier (${configuracion.nombre})`, live.filas)}`)
    imprimirFallas(live.filas)
  }
}

let offlineFinal = offline.filas

if (modoGrabar && live.capturas.length > 0) {
  const anteriores = new Map()
  const escritas = []
  const conservadas = []

  for (const decision of decidirGrabado(live.capturas)) {
    if (!('escribir' in decision)) {
      conservadas.push(decision)
      continue
    }

    const ruta = resolve(RAIZ, 'evals/fixtures', decision.fixture)
    // The previous bytes stay in memory until the offline re-run proves the capture.
    anteriores.set(decision.fixture, readFileSync(ruta))
    writeFileSync(ruta, `${JSON.stringify(decision.escribir, null, 2)}\n`)
    escritas.push(decision.fixture)
  }

  console.log(`\n[grabar] fixtures reemplazadas (${escritas.length}): ${escritas.join(', ') || 'ninguna'}`)
  for (const conservada of conservadas) {
    console.log(`[grabar] conservada ${conservada.fixture}: ${conservada.conservar}`)
  }

  const fixturePorNombre = new Map(casos.map(({ caso }) => [caso.name, caso.fixture]))
  const restauradas = []

  offlineFinal = await correrOfflineDesdeArchivos()

  // A recording that does not reproduce its case is a finding, not a new baseline: the
  // previous file goes back and the run says which case and which effect it lost.
  for (const fila of offlineFinal.filter((resultado) => !resultado.ok)) {
    const fixture = fixturePorNombre.get(fila.name)
    if (!fixture || !anteriores.has(fixture)) continue

    writeFileSync(resolve(RAIZ, 'evals/fixtures', fixture), anteriores.get(fixture))
    restauradas.push({ fixture, motivo: fila.failures.join(' | ') })
  }

  console.log(`\n${formatearTabla('evals · offline re-run (recorded fixtures)', offlineFinal)}`)
  imprimirFallas(offlineFinal)

  if (restauradas.length > 0) {
    for (const restaurada of restauradas) {
      console.log(`[grabar] restaurada ${restaurada.fixture}: el offline no reprodujo — ${restaurada.motivo}`)
    }

    offlineFinal = await correrOfflineDesdeArchivos()
    console.log(`\n${formatearTabla('evals · offline re-run (after restoring the kept fixtures)', offlineFinal)}`)
    imprimirFallas(offlineFinal)
  }
}

// A skipped row never fails: it did not run, so it proves nothing either way. A
// recording that had to be restored does fail this run: its purpose was to record.
const todas = [...live.filas, ...offlineFinal]
await prisma.$disconnect()

if (todas.some((resultado) => !resultado.ok)) process.exitCode = 1
