import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { MAX_RONDAS_POR_DEFECTO } from '../config'

/**
 * Versioned eval cases and their recorded model fixtures.
 *
 * A case is data, not code: it declares the user request, the fixture to replay,
 * the expected tool calls and the expected database state (S9). The runner reads
 * them from `evals/cases` and `evals/fixtures`.
 *
 * The schemas are strict on purpose. A typo in a hand-authored JSON file would
 * otherwise disable an assertion silently, which is the worst possible failure mode
 * for a suite whose job is to prove that effects happened.
 */

const MEDIOS = ['EFECTIVO', 'TRANSFERENCIA', 'TARJETA'] as const
const TIPOS_DE_MOVIMIENTO = ['ENTRADA', 'SALIDA', 'AJUSTE'] as const

/** Same alphabet as the API's `Idempotency-Key`, so a case cannot declare an invalid key. */
const CLAVE_VALIDA = /^[A-Za-z0-9_.:-]+$/

const esquemaProductoSembrado = z
  .object({
    /** Explicit id: fixtures are hand-authored and have to name the product. */
    id: z.string().min(1),
    sku: z.string().min(1),
    name: z.string().min(1),
    priceCentavos: z.number().int().positive(),
    stock: z.number().int().min(0),
    active: z.boolean().optional(),
  })
  .strict()

const esquemaTurno = z
  .object({
    role: z.enum(['user', 'assistant']),
    text: z.string().min(1),
  })
  .strict()

const esquemaEspera = z
  .object({
    /** Tool names actually executed by the loop, in order, across every attempt. */
    toolCalls: z.array(z.string().min(1)).optional(),
    /** Calls whose result was an error, with the stable code the loop returned. */
    toolErrors: z.array(z.object({ name: z.string().min(1), code: z.string().min(1) }).strict()).optional(),
    textIncludes: z.array(z.string().min(1)).optional(),
    textNotEmpty: z.boolean().optional(),
    /** Tools whose JSON Schema must not declare any money field (S3). */
    noMoneyFieldsIn: z.array(z.string().min(1)).optional(),
    sales: z
      .object({
        count: z.number().int().min(0).optional(),
        totalCentavos: z
          .object({ productId: z.string().min(1), quantity: z.number().int().positive() })
          .strict()
          .optional(),
        paymentMethods: z.array(z.enum(MEDIOS)).optional(),
      })
      .strict()
      .optional(),
    stock: z
      .array(z.object({ productId: z.string().min(1), stock: z.number().int().min(0) }).strict())
      .optional(),
    /** The full stock ledger. An empty array means "nothing moved". */
    movements: z
      .array(
        z
          .object({
            productId: z.string().min(1),
            type: z.enum(TIPOS_DE_MOVIMIENTO),
            quantity: z.number().int().positive(),
            stockAfter: z.number().int().min(0),
          })
          .strict(),
      )
      .optional(),
    productCount: z.number().int().min(0).optional(),
    /** How many times `POST /api/v1/ventas` was sent, replays included (S7). */
    postVentas: z.number().int().min(0).optional(),
    topReached: z.boolean().optional(),
    modelCalls: z.number().int().min(1).optional(),
  })
  .strict()

export const esquemaCaso = z
  .object({
    name: z.string().min(1),
    /** Specs of `odd/tasks/evals.md` this case is evidence for. */
    specs: z.array(z.string().min(1)).min(1),
    seed: z.object({ products: z.array(esquemaProductoSembrado).min(1) }).strict(),
    request: z
      .object({
        message: z.string().min(1),
        turns: z.array(esquemaTurno).default([]),
        idempotencyKey: z.string().regex(CLAVE_VALIDA).optional(),
        /** Attempts sharing the same key: 2 is the replay case (S5). */
        attempts: z.number().int().min(1).max(5).default(1),
      })
      .strict(),
    maxRounds: z.number().int().min(1).max(20).default(MAX_RONDAS_POR_DEFECTO),
    /** File name under `evals/fixtures`. */
    fixture: z.string().min(1),
    expect: esquemaEspera,
  })
  .strict()

/**
 * Recorded model response in GLM's OpenAI-compatible shape.
 *
 * Only `choices[0].message` and `usage` are read by `crearClienteModelo`, but the
 * whole envelope is kept so a captured live response can replace the hand-authored
 * one without touching the loader.
 */
const esquemaLlamadaGrabada = z
  .object({
    id: z.string().min(1),
    type: z.literal('function'),
    function: z.object({ name: z.string().min(1), arguments: z.string() }).strict(),
  })
  .strict()

const esquemaMensajeGrabado = z
  .object({
    role: z.literal('assistant').optional(),
    content: z.string().nullable().optional(),
    reasoning_content: z.string().optional(),
    tool_calls: z.array(esquemaLlamadaGrabada).optional(),
  })
  .passthrough()

const esquemaRespuestaGrabada = z
  .object({
    id: z.string().optional(),
    object: z.string().optional(),
    created: z.number().int().optional(),
    model: z.string().optional(),
    choices: z
      .array(
        z
          .object({
            index: z.number().int().optional(),
            message: esquemaMensajeGrabado,
            finish_reason: z.string().optional(),
          })
          .passthrough(),
      )
      .min(1),
    usage: z
      .object({
        prompt_tokens: z.number().int().min(0).optional(),
        completion_tokens: z.number().int().min(0).optional(),
        total_tokens: z.number().int().min(0).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

/** One block per attempt: the replay case plays the same block twice, same key. */
const esquemaFixture = z
  .object({ attempts: z.array(z.array(esquemaRespuestaGrabada).min(1)).min(1) })
  .strict()

export type ProductoSembrado = z.infer<typeof esquemaProductoSembrado>
export type TurnoDelCaso = z.infer<typeof esquemaTurno>
export type ExpectativasEval = z.infer<typeof esquemaEspera>
export type CasoEval = z.infer<typeof esquemaCaso>
export type RespuestaGrabada = z.infer<typeof esquemaRespuestaGrabada>
export type FixtureEval = z.infer<typeof esquemaFixture>

export type CasoCargado = {
  /** File name, for messages. */
  file: string
  caso: CasoEval
  fixture: FixtureEval
}

function leerJson<T>(esquema: z.ZodType<T>, ruta: string): T {
  let crudo: unknown
  try {
    crudo = JSON.parse(readFileSync(ruta, 'utf8')) as unknown
  } catch (error) {
    throw new Error(`${ruta}: no es JSON válido (${error instanceof Error ? error.message : String(error)})`)
  }

  const resultado = esquema.safeParse(crudo)
  if (!resultado.success) {
    const detalle = resultado.error.issues
      .map((problema) => `${problema.path.join('.') || 'raíz'}: ${problema.message}`)
      .join('; ')
    throw new Error(`${ruta}: ${detalle}`)
  }

  return resultado.data
}

/**
 * Loads every case sorted by file name, with its fixture.
 *
 * A fixture whose number of attempt blocks does not match `request.attempts` is
 * rejected here and not in the middle of a run: a replay case with one block would
 * otherwise pass with a promise it never kept.
 */
export function leerCasos(
  directorioCasos = 'evals/cases',
  directorioFixtures = 'evals/fixtures',
): CasoCargado[] {
  const archivos = readdirSync(directorioCasos)
    .filter((archivo) => archivo.endsWith('.json'))
    .sort()

  if (archivos.length === 0) {
    throw new Error(`No hay casos de eval en ${directorioCasos}.`)
  }

  return archivos.map((archivo) => {
    const caso = leerJson(esquemaCaso, join(directorioCasos, archivo))
    const fixture = leerJson(esquemaFixture, join(directorioFixtures, caso.fixture))

    if (fixture.attempts.length !== caso.request.attempts) {
      throw new Error(
        `${archivo}: el caso declara ${caso.request.attempts} intento(s) y el fixture ${caso.fixture} trae ${fixture.attempts.length} bloque(s).`,
      )
    }

    return { file: archivo, caso, fixture }
  })
}
