import { nuevaClaveIdempotencia } from '@/lib/claveIdempotencia'
import { prisma } from '@/lib/db'
import { emitirToken } from '@/server/api/tokens'
import { assertTestDatabase } from '@/test/guard'
import { ScopeApi } from '../../../../generated/prisma/enums'
import { crearClienteApi, type Transporte } from '../api'
import { ejecutarTurno, type LlamadaEjecutada } from '../bucle'
import {
  MAX_PRODUCTOS_POR_DEFECTO,
  MODELO_BASE_URL_POR_DEFECTO,
  MODELO_POR_DEFECTO,
  TEMPERATURA_POR_DEFECTO,
} from '../config'
import { mensajesParaElModelo } from '../conversacion'
import { crearHerramientas, type DefinicionHerramienta } from '../herramientas'
import { crearClienteModelo, type ClienteModelo } from '../modelo'
import type { CasoEval, ExpectativasEfectos, ExpectativasGuionizado, FixtureEval, NivelEval, TextoInformativo } from './caso'
import { leerRespuestaGrabada, type RespuestaGrabada } from './caso'
import { reproductorDeFixture, transporteEnProceso, type PeticionObservada } from './transporte'

/**
 * The eval runner: seed, replay (or call) the model, assert the effects.
 *
 * It writes only its own seed: it truncates the evals database before each case,
 * creates one user, one token and the case products, and never registers anything
 * the assistant did not register. The `_test` guard is the same one the test suite
 * uses, so pointing the runner at the development or production database aborts
 * before the first write.
 */

/** Scopes of the assistant's own token (S4, T4): no `productos:write`. */
export const SCOPES_ASISTENTE: ScopeApi[] = [
  ScopeApi.PRODUCTOS_READ,
  ScopeApi.VENTAS_READ,
  ScopeApi.VENTAS_WRITE,
  ScopeApi.REPORTES_READ,
]

/** Origin used only to build URLs for the in-process transport. */
const ORIGEN_API = 'http://panel.local'
const ORIGEN_MODELO = 'http://modelo.local'

const TABLAS = [
  '"LineaVenta"',
  '"Pago"',
  '"MovimientoStock"',
  '"Venta"',
  '"Producto"',
  '"UsoTokenApi"',
  '"TokenApi"',
  '"UsoModeloDiario"',
  '"Usuario"',
].join(', ')

export type ModeloDeIntento = { modelo: ClienteModelo; sobrantes: () => number }

/**
 * A factory of per-attempt models, tagged with the tier it belongs to.
 *
 * The tag is not decoration: `correrCaso` receives nothing else that tells it
 * whether it is running offline or live, and it needs to know which tiers may
 * require the case's assertions (S8). `[case] expect` is always required;
 * `expectOffline` and the case's `tiers` are only honoured for the offline tier.
 */
export type FabricaDeModelo = ((intento: number) => ModeloDeIntento) & { readonly tier: NivelEval }

export type ConfiguracionLive = {
  baseUrl: string
  apiKey: string
  nombre: string
  temperatura: number
}

export type ResultadoCaso = {
  name: string
  ok: boolean
  /** True when the case does not declare this tier: nothing ran, nothing is claimed. */
  skipped: boolean
  failures: string[]
  /** Fragments from `informative`: what the reply said, never a criterion (S9). */
  informative: string[]
  toolCalls: string[]
  inputTokens: number
  outputTokens: number
  latencyMs: number
}

/**
 * Everything a case declared, measured against what actually happened.
 *
 * Kept as plain data so the check itself is a pure function that can be tested
 * without a database: the runner is what queries Postgres.
 */
export type ObservacionCaso = {
  toolCalls: { name: string; ok: boolean; errorCode?: string }[]
  text: string
  topReached: boolean
  modelCalls: number
  httpRequests: PeticionObservada[]
  tools: DefinicionHerramienta[]
  sales: { totalCentavos: number; paymentMethods: string[] }[]
  products: { id: string; stock: number }[]
  movements: { productId: string; type: string; quantity: number; stockAfter: number }[]
  productCount: number
  seededPrices: Record<string, number>
}

const PALABRAS_DE_DINERO = /precio|total|subtotal|monto|centavos/i

/** Every property name declared anywhere in a JSON Schema, nested arrays included. */
export function nombresDePropiedades(esquema: unknown): string[] {
  if (typeof esquema !== 'object' || esquema === null) return []
  const nodo = esquema as Record<string, unknown>
  const nombres: string[] = []

  const propiedades = nodo.properties
  if (typeof propiedades === 'object' && propiedades !== null) {
    for (const [nombre, subesquema] of Object.entries(propiedades)) {
      nombres.push(nombre, ...nombresDePropiedades(subesquema))
    }
  }

  if (nodo.items !== undefined) nombres.push(...nombresDePropiedades(nodo.items))

  for (const clave of ['anyOf', 'oneOf', 'allOf'] as const) {
    const variantes = nodo[clave]
    if (Array.isArray(variantes)) {
      for (const variante of variantes) nombres.push(...nombresDePropiedades(variante))
    }
  }

  return nombres
}

function recortar(texto: string, maximo = 120): string {
  const limpio = texto.replace(/\s+/g, ' ').trim()
  return limpio.length <= maximo ? limpio : `${limpio.slice(0, maximo)}…`
}

function iguales(izquierda: string[], derecha: string[]): boolean {
  return izquierda.length === derecha.length && izquierda.every((valor, indice) => valor === derecha[indice])
}

/**
 * Checks the declared effects against the observation. Returns one line per
 * mismatch, so a failing case says what it promised and what it got.
 *
 * Effects only: a sale row, its server-computed total, the stock, the ledger, the
 * number of write attempts and which tools ran. All of it holds for any correct
 * run, scripted or live (S9).
 */
export function evaluarEfectos(espera: ExpectativasEfectos, observacion: ObservacionCaso): string[] {
  const fallas: string[] = []
  const exigir = (condicion: boolean, mensaje: string) => {
    if (!condicion) fallas.push(mensaje)
  }

  const reales = observacion.toolCalls.map((llamada) => llamada.name)

  for (const nombre of espera.toolCallsInclude ?? []) {
    exigir(
      reales.includes(nombre),
      `tool calls: se esperaba que «${nombre}» se ejecutara y no se ejecutó (${reales.join(', ') || 'ninguna'})`,
    )
  }

  for (const nombre of espera.toolCallsExclude ?? []) {
    exigir(!reales.includes(nombre), `tool calls: «${nombre}» no debía ejecutarse y se ejecutó`)
  }

  for (const nombre of espera.noMoneyFieldsIn ?? []) {
    const herramienta = observacion.tools.find((definicion) => definicion.function.name === nombre)
    if (!herramienta) {
      fallas.push(`herramientas: no existe «${nombre}»`)
      continue
    }

    const campos = nombresDePropiedades(herramienta.function.parameters).filter((campo) =>
      PALABRAS_DE_DINERO.test(campo),
    )
    exigir(
      campos.length === 0,
      `herramienta ${nombre}: el esquema declara campos de dinero (${campos.join(', ')})`,
    )
  }

  if (espera.sales?.count !== undefined) {
    exigir(
      observacion.sales.length === espera.sales.count,
      `ventas: se esperaban ${espera.sales.count} y hay ${observacion.sales.length}`,
    )
  }

  if (espera.sales?.totalCentavos) {
    const { productId, quantity } = espera.sales.totalCentavos
    const precio = observacion.seededPrices[productId]
    if (precio === undefined) {
      fallas.push(`total de la venta: el producto sembrado ${productId} no existe`)
    } else {
      // The expected total comes from the seed and the quantity, never from the
      // model: that is the whole point of S3.
      const esperado = precio * quantity
      const real = observacion.sales[0]?.totalCentavos
      exigir(
        real === esperado,
        `total de la venta: se esperaban ${esperado} y hay ${real === undefined ? 'ninguna venta' : real}`,
      )
    }
  }

  if (espera.sales?.paymentMethods) {
    const reales = observacion.sales[0]?.paymentMethods ?? []
    exigir(
      iguales(espera.sales.paymentMethods, reales),
      `medios de pago: se esperaban [${espera.sales.paymentMethods.join(', ')}] y fueron [${reales.join(', ')}]`,
    )
  }

  for (const { productId, stock } of espera.stock ?? []) {
    const real = observacion.products.find((producto) => producto.id === productId)
    exigir(
      real?.stock === stock,
      `stock de ${productId}: se esperaba ${stock} y hay ${real === undefined ? 'sin producto' : real.stock}`,
    )
  }

  if (espera.movements) {
    const reales = observacion.movements.map(
      (movimiento) =>
        `${movimiento.productId}/${movimiento.type}/${movimiento.quantity}/${movimiento.stockAfter}`,
    )
    const esperados = espera.movements.map(
      (movimiento) =>
        `${movimiento.productId}/${movimiento.type}/${movimiento.quantity}/${movimiento.stockAfter}`,
    )
    exigir(
      iguales(esperados, reales),
      `movimientos de stock: se esperaban [${esperados.join(', ')}] y fueron [${reales.join(', ')}]`,
    )
  }

  if (espera.productCount !== undefined) {
    exigir(
      observacion.productCount === espera.productCount,
      `productos: se esperaban ${espera.productCount} y hay ${observacion.productCount} (¿se borró algo?)`,
    )
  }

  if (espera.postVentas !== undefined) {
    const envios = enviosDeVentas(observacion)
    exigir(envios === espera.postVentas, `POST /ventas: se esperaba ${espera.postVentas} y hubo ${envios}`)
  }

  return fallas
}

function enviosDeVentas(observacion: ObservacionCaso): number {
  return observacion.httpRequests.filter(
    (peticion) => peticion.method === 'POST' && peticion.pathname === '/api/v1/ventas',
  ).length
}

/**
 * Checks the scripted-model specifics: exact call sequence, error codes, call count,
 * the round cap and the one required wording (S7). Offline only, by construction.
 */
export function evaluarGuion(
  espera: ExpectativasGuionizado,
  observacion: ObservacionCaso,
): string[] {
  const fallas: string[] = []
  const exigir = (condicion: boolean, mensaje: string) => {
    if (!condicion) fallas.push(mensaje)
  }

  if (espera.toolCalls) {
    const reales = observacion.toolCalls.map((llamada) => llamada.name)
    exigir(
      iguales(espera.toolCalls, reales),
      `tool calls: se esperaban [${espera.toolCalls.join(', ')}] y fueron [${reales.join(', ')}]`,
    )
  }

  if (espera.toolErrors) {
    const reales = observacion.toolCalls
      .filter((llamada) => !llamada.ok)
      .map((llamada) => `${llamada.name}:${llamada.errorCode ?? 'sin código'}`)
    const esperados = espera.toolErrors.map((error) => `${error.name}:${error.code}`)
    exigir(
      iguales(esperados, reales),
      `errores de herramientas: se esperaban [${esperados.join(', ')}] y fueron [${reales.join(', ')}]`,
    )
  }

  for (const fragmento of espera.requiredText ?? []) {
    exigir(
      observacion.text.toLowerCase().includes(fragmento.toLowerCase()),
      `texto exigido por la spec: falta «${fragmento}» en «${recortar(observacion.text)}»`,
    )
  }

  if (espera.textNotEmpty !== undefined) {
    const hayTexto = observacion.text.trim().length > 0
    exigir(hayTexto === espera.textNotEmpty, `texto: se esperaba ${espera.textNotEmpty ? 'una respuesta con texto' : 'una respuesta vacía'}`)
  }

  if (espera.topReached !== undefined) {
    exigir(
      observacion.topReached === espera.topReached,
      `tope de rondas alcanzado: se esperaba ${espera.topReached} y fue ${observacion.topReached}`,
    )
  }

  if (espera.modelCalls !== undefined) {
    exigir(
      observacion.modelCalls === espera.modelCalls,
      `llamadas al modelo: se esperaban ${espera.modelCalls} y hubo ${observacion.modelCalls}`,
    )
  }

  if (espera.postVentas !== undefined) {
    const envios = enviosDeVentas(observacion)
    exigir(envios === espera.postVentas, `POST /ventas: se esperaba ${espera.postVentas} y hubo ${envios}`)
  }

  return fallas
}

/**
 * What the case kept as a readable hint about the reply, with what was observed.
 *
 * These lines never reach `failures`: the wording of an answer is not an effect
 * (S9). They are useful when reading a run, which is all they are for.
 */
export function observarTextoInformativo(
  informativo: TextoInformativo,
  texto: string,
): string[] {
  return (informativo?.textIncludes ?? []).map((fragmento) => {
    const presente = texto.toLowerCase().includes(fragmento.toLowerCase())
    return presente
      ? `texto (informativo): dijo «${fragmento}»`
      : `texto (informativo): no dijo «${fragmento}» — no es un criterio de aprobación (S9)`
  })
}

/**
 * Offline model: fixtures replayed through the real client and the real loop.
 *
 * Each attempt gets its own block so a replay case plays the same conversation
 * twice with the same idempotency key.
 */
export function fabricaOffline(fixture: FixtureEval): FabricaDeModelo {
  const fabrica = (intento: number): ModeloDeIntento => {
    const reproductor = reproductorDeFixture(fixture.attempts[intento] ?? [])
    return {
      modelo: crearClienteModelo({
        baseUrl: ORIGEN_MODELO,
        apiKey: 'offline-fixture',
        nombre: 'glm-fixture',
        temperatura: 0,
        transporte: reproductor.transporte,
      }),
      sobrantes: reproductor.restantes,
    }
  }

  return Object.assign(fabrica, { tier: 'offline' as const })
}

/** Live model: the same cases against the real provider (S8). */
export type OpcionesFabricaLive = {
  /** Record every provider response, in attempt order (`--grabar`). */
  grabar?: boolean
  /** Only for tests: the recording path is the same, the network stays out. */
  transporte?: Transporte
}

/**
 * A live factory that can hand back what the provider sent, in fixture shape.
 *
 * The capture happens in the transport wrapper, which is the only boundary where
 * the body is still exactly the provider's answer: recording there keeps a single
 * fixture format (`RespuestaGrabada` → `FixtureEval`), the same one `caso.ts` loads,
 * instead of inventing a second one for recordings.
 */
export type FabricaLive = FabricaDeModelo & { captura: () => FixtureEval }

export function fabricaLive(
  configuracion: ConfiguracionLive,
  opciones: OpcionesFabricaLive = {},
): FabricaLive {
  const bloques: RespuestaGrabada[][] = []
  const base: Transporte = opciones.transporte ?? ((peticion: Request) => fetch(peticion))

  const fabrica = (intento: number): ModeloDeIntento => {
    const transporte: Transporte = opciones.grabar
      ? async (peticion: Request) => {
          const respuesta = await base(peticion)
          // Cloning keeps the body the loop reads untouched; validating here means a
          // provider answer that is not a fixture stops the case instead of being
          // written as a file the offline tier could not load.
          const grabada = leerRespuestaGrabada(await respuesta.clone().json())
          const bloque = bloques[intento] ?? (bloques[intento] = [])
          bloque.push(grabada)
          return respuesta
        }
      : base

    return {
      modelo: crearClienteModelo({ ...configuracion, transporte }),
      sobrantes: () => 0,
    }
  }

  return Object.assign(fabrica, {
    tier: 'live' as const,
    // `Array.from` and not `map`: a sparse array would serialize a hole as `null`
    // and produce a fixture the loader rejects.
    captura: (): FixtureEval => ({
      attempts: Array.from({ length: bloques.length }, (_, indice) => bloques[indice] ?? []),
    }),
  })
}

/** One case's live capture, with the facts that decide whether it may replace the baseline. */
export type CapturaDeCaso = {
  /** Case file name, for messages. */
  file: string
  /** Fixture basename the capture would replace. */
  fixture: string
  captura: FixtureEval
  /** Whether the live run met every effect the case requires. */
  ok: boolean
  /** True when the case did not run in this tier. */
  skipped: boolean
  /** Attempts the case declares: the loader needs one block per attempt. */
  intentos: number
}

export type DecisionDeGrabado =
  | { fixture: string; escribir: FixtureEval }
  | { fixture: string; conservar: string }

/**
 * Which captures may replace their fixture.
 *
 * The hand-authored fixtures are the only working baseline, so a capture is written
 * only when the live run met the case's effects and the shape matches the attempts
 * the case declares. A failed run, a skipped case and a capture with the wrong
 * number of blocks all keep the old file and say why: a recording that does not
 * reproduce is a finding to report, never a baseline to adopt.
 */
export function decidirGrabado(capturas: CapturaDeCaso[]): DecisionDeGrabado[] {
  return capturas.map(({ fixture, captura, ok, skipped, intentos }) => {
    if (skipped) {
      return { fixture, conservar: 'el caso no corre en este nivel: no se escribe nada' }
    }

    if (!ok) {
      return {
        fixture,
        conservar: 'la corrida live no cumplió sus efectos: la baseline no se reemplaza',
      }
    }

    if (captura.attempts.length !== intentos) {
      return {
        fixture,
        conservar: `la captura trae ${captura.attempts.length} bloque(s) y el caso declara ${intentos} intento(s)`,
      }
    }

    return { fixture, escribir: captura }
  })
}

/**
 * Live configuration from the environment, or `null` when the key is absent.
 *
 * The provider stays configuration and not code (S2): provider, model and
 * temperature come from the same variables the panel uses.
 */
export function configuracionLiveDesdeEntorno(
  entorno: Record<string, string | undefined> = process.env,
): ConfiguracionLive | null {
  const apiKey = entorno['ASISTENTE_MODELO_API_KEY']?.trim()
  if (!apiKey) return null

  const temperatura = Number(entorno['ASISTENTE_MODELO_TEMPERATURA'] ?? TEMPERATURA_POR_DEFECTO)

  return {
    baseUrl: entorno['ASISTENTE_MODELO_BASE_URL']?.trim() || MODELO_BASE_URL_POR_DEFECTO,
    apiKey,
    nombre: entorno['ASISTENTE_MODELO']?.trim() || MODELO_POR_DEFECTO,
    temperatura: Number.isFinite(temperatura) ? temperatura : TEMPERATURA_POR_DEFECTO,
  }
}

/**
 * Truncates the evals database and seeds nothing: `prepararCaso` runs right after.
 *
 * The `_test` guard runs here as well as in the CLI so an eval embedded in another
 * process still cannot truncate a database whose name does not end in `_test`.
 */
export async function truncarBase(): Promise<void> {
  assertTestDatabase()
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${TABLAS} RESTART IDENTITY CASCADE`)
}

type Preparacion = { token: string; precios: Map<string, number> }

async function prepararCaso(caso: CasoEval): Promise<Preparacion> {
  await truncarBase()

  const usuario = await prisma.usuario.create({
    data: {
      email: `evals-${caso.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}@caja.local`,
      nombre: 'Evals',
      passwordHash: 'no-se-usa-en-evals',
    },
  })

  const { claro } = await emitirToken({
    usuarioId: usuario.id,
    nombre: `evals-${caso.name}`,
    scopes: SCOPES_ASISTENTE,
  })

  const precios = new Map<string, number>()
  for (const producto of caso.seed.products) {
    await prisma.producto.create({
      data: {
        id: producto.id,
        sku: producto.sku,
        nombre: producto.name,
        precioCentavos: producto.priceCentavos,
        stock: producto.stock,
        activo: producto.active ?? true,
      },
    })
    precios.set(producto.id, producto.priceCentavos)
  }

  return { token: claro, precios }
}

type Ejecucion = {
  llamadas: LlamadaEjecutada[]
  texto: string
  topeAlcanzado: boolean
  llamadasModelo: number
  entrada: number
  salida: number
  peticiones: PeticionObservada[]
}

async function ejecutarIntentos(
  caso: CasoEval,
  token: string,
  fabrica: FabricaDeModelo,
): Promise<Ejecucion> {
  const peticiones: PeticionObservada[] = []
  const transporte: Transporte = transporteEnProceso((peticion) => peticiones.push(peticion))
  const clienteApi = crearClienteApi({ baseUrl: ORIGEN_API, token, transporte })
  const herramientas = crearHerramientas(clienteApi, { maxProductos: MAX_PRODUCTOS_POR_DEFECTO })

  // The same key across attempts: that is what makes the second attempt a replay
  // instead of a second sale (S5).
  const clave = caso.request.idempotencyKey ?? nuevaClaveIdempotencia()
  const turnos = caso.request.turns.map((turno) => ({
    rol: turno.role === 'user' ? ('usuario' as const) : ('asistente' as const),
    texto: turno.text,
  }))

  const llamadas: LlamadaEjecutada[] = []
  let texto = ''
  let topeAlcanzado = false
  let llamadasModelo = 0
  let entrada = 0
  let salida = 0

  for (let intento = 0; intento < caso.request.attempts; intento += 1) {
    const { modelo, sobrantes } = fabrica(intento)
    let vueltas = 0

    const contado: ClienteModelo = {
      async completar(entrada) {
        vueltas += 1
        return modelo.completar(entrada)
      },
    }

    const resultado = await ejecutarTurno({
      modelo: contado,
      herramientas,
      mensajes: mensajesParaElModelo(turnos, caso.request.message),
      claveIdempotencia: clave,
      maxRondas: caso.maxRounds,
    })

    llamadasModelo += vueltas
    // Token usage is what the provider reported, fixture or live: it is what the
    // table shows and what a live run would cost.
    entrada += resultado.uso.entrada
    salida += resultado.uso.salida
    llamadas.push(...resultado.llamadas)
    texto = resultado.texto
    topeAlcanzado = resultado.topeAlcanzado
    if (sobrantes() !== 0) {
      throw new Error(
        `El fixture del intento ${intento + 1} dejó ${sobrantes()} respuesta(s) sin usar: el caso quedó desactualizado.`,
      )
    }
  }

  return { llamadas, texto, topeAlcanzado, llamadasModelo, entrada, salida, peticiones }
}

async function observarBase(
  ejecucion: Ejecucion,
  herramientas: DefinicionHerramienta[],
  precios: Map<string, number>,
): Promise<ObservacionCaso> {
  const [ventas, productos, movimientos] = await Promise.all([
    prisma.venta.findMany({
      orderBy: { numero: 'asc' },
      include: { pagos: { orderBy: { createdAt: 'asc' } } },
    }),
    prisma.producto.findMany({ orderBy: { id: 'asc' } }),
    prisma.movimientoStock.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
  ])

  return {
    toolCalls: ejecucion.llamadas.map((llamada) =>
      llamada.resultado.ok
        ? { name: llamada.nombre, ok: true }
        : { name: llamada.nombre, ok: false, errorCode: llamada.resultado.error.code },
    ),
    text: ejecucion.texto,
    topReached: ejecucion.topeAlcanzado,
    modelCalls: ejecucion.llamadasModelo,
    httpRequests: ejecucion.peticiones,
    tools: herramientas,
    sales: ventas.map((venta) => ({
      totalCentavos: venta.totalCentavos,
      paymentMethods: venta.pagos.map((pago) => pago.medio),
    })),
    products: productos.map((producto) => ({ id: producto.id, stock: producto.stock })),
    movements: movimientos.map((movimiento) => ({
      productId: movimiento.productoId,
      type: movimiento.tipo,
      quantity: movimiento.cantidad,
      stockAfter: movimiento.stockLuego,
    })),
    productCount: productos.length,
    seededPrices: Object.fromEntries(precios),
  }
}

/**
 * Runs one case: seed, execute every attempt, query the database, compare.
 *
 * The tool definitions are the assistant's real ones, built from the same Zod
 * schemas: the money-field assertion checks the schema the model actually saw.
 *
 * Assertions follow the tier (S8). `expect` is always required. `expectOffline` is
 * required only offline, because it describes the scripted model. A case that does
 * not declare the running tier is not executed at all: running it would either
 * replay the fixture and call it live evidence, or fail the model for taking an
 * honest path the case never allowed.
 */
export async function correrCaso(caso: CasoEval, fabrica: FabricaDeModelo): Promise<ResultadoCaso> {
  if (!caso.tiers.includes(fabrica.tier)) {
    return {
      name: caso.name,
      ok: true,
      skipped: true,
      failures: [],
      informative: [],
      toolCalls: [],
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
    }
  }

  const inicio = performance.now()
  const { token, precios } = await prepararCaso(caso)
  const ejecucion = await ejecutarIntentos(caso, token, fabrica)

  const clienteApi = crearClienteApi({ baseUrl: ORIGEN_API, token, transporte: transporteEnProceso() })
  const herramientas = crearHerramientas(clienteApi, { maxProductos: MAX_PRODUCTOS_POR_DEFECTO })

  const observacion = await observarBase(ejecucion, herramientas.definiciones, precios)
  const fallas = evaluarEfectos(caso.expect, observacion)
  if (fabrica.tier === 'offline' && caso.expectOffline) {
    fallas.push(...evaluarGuion(caso.expectOffline, observacion))
  }

  return {
    name: caso.name,
    ok: fallas.length === 0,
    skipped: false,
    failures: fallas,
    informative: observarTextoInformativo(caso.informative, observacion.text),
    toolCalls: ejecucion.llamadas.map((llamada) => llamada.nombre),
    inputTokens: ejecucion.entrada,
    outputTokens: ejecucion.salida,
    latencyMs: Math.round(performance.now() - inicio),
  }
}
