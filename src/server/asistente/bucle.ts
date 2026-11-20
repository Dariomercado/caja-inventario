import { nuevaClaveIdempotencia } from '@/lib/claveIdempotencia'
import type { JuegoDeHerramientas, ResultadoHerramienta } from './herramientas'
import { sumarUso, USO_CERO, type Mensaje, type MensajeAsistente, type Uso } from './modelo'

/**
 * El loop de herramientas: mandar, ejecutar, devolver, repetir (S10).
 *
 * Es independiente del modelo y del cliente HTTP concretos, así que el nivel
 * offline de las evals puede correrlo entero con un modelo grabado y un transporte
 * en proceso, sin red y sin base (S8).
 *
 * El tope no es una precaución: es lo que impide que un modelo en loop gastar
 * presupuesto sin techo. Cuando se alcanza, se deja de ofrecer herramientas y se
 * pide una respuesta en texto; el resultado lo dice, para que la pantalla lo
 * muestre en vez de aparentar que la respuesta fue completa.
 */

export type LlamadaEjecutada = {
  nombre: string
  argumentos: unknown
  resultado: ResultadoHerramienta
}

export type EventoTurno =
  | { tipo: 'llamada'; llamada: LlamadaEjecutada }
  | { tipo: 'tope'; rondas: number }

export type ResultadoTurno = {
  /** Historial completo, listo para el turno siguiente. */
  mensajes: Mensaje[]
  texto: string
  llamadas: LlamadaEjecutada[]
  /** Clave del intento en curso, ya renovada si una venta se registró. */
  claveIdempotencia: string
  topeAlcanzado: boolean
  uso: Uso
}

export type EntradaTurno = {
  modelo: { completar(entrada: { mensajes: Mensaje[]; herramientas?: JuegoDeHerramientas['definiciones'] }): Promise<{ mensaje: MensajeAsistente; uso: Uso }> }
  herramientas: JuegoDeHerramientas
  mensajes: Mensaje[]
  claveIdempotencia?: string
  maxRondas: number
  /**
   * Se llama antes de cada llamada al modelo. Es donde entra el cupo diario (S10):
   * si lanza, el turno se corta ahí en lugar de seguir gastando.
   */
  reservarLlamada?: () => Promise<void>
  onEvento?: (evento: EventoTurno) => void
}

export async function ejecutarTurno(entrada: EntradaTurno): Promise<ResultadoTurno> {
  const mensajes: Mensaje[] = [...entrada.mensajes]
  const llamadas: LlamadaEjecutada[] = []
  let claveIdempotencia = entrada.claveIdempotencia ?? nuevaClaveIdempotencia()
  let uso: Uso = USO_CERO
  let ronda = 0
  let topeAlcanzado = false

  while (true) {
    const ofrecerHerramientas = ronda < entrada.maxRondas
    if (!ofrecerHerramientas) topeAlcanzado = true

    await entrada.reservarLlamada?.()

    const { mensaje, uso: usoDeLaRonda } = await entrada.modelo.completar({
      mensajes,
      ...(ofrecerHerramientas ? { herramientas: entrada.herramientas.definiciones } : {}),
    })
    uso = sumarUso(uso, usoDeLaRonda)

    // Se guarda el mensaje del proveedor completo y se devuelve sin recortar: `glm-5.3`
    // razona siempre y necesita su propio `reasoning_content` de vuelta en el turno
    // siguiente (L7).
    const asistente: MensajeAsistente = { ...mensaje, role: 'assistant' }
    mensajes.push(asistente)

    const pedidas = asistente.tool_calls ?? []

    if (pedidas.length === 0) {
      return {
        mensajes,
        texto: typeof asistente.content === 'string' ? asistente.content : '',
        llamadas,
        claveIdempotencia,
        topeAlcanzado,
        uso,
      }
    }

    // Con las herramientas ya retiradas, un modelo que igual pide una no se ejecuta:
    // ejecutarla sería romper el tope por un camino lateral.
    if (!ofrecerHerramientas) {
      return {
        mensajes,
        texto: typeof asistente.content === 'string' ? asistente.content : '',
        llamadas,
        claveIdempotencia,
        topeAlcanzado: true,
        uso,
      }
    }

    for (const pedida of pedidas) {
      const argumentos = parsearArgumentos(pedida.function.arguments)
      const resultado = await entrada.herramientas.ejecutar(pedida.function.name, argumentos, {
        claveIdempotencia,
      })

      // Renovar después de una venta creada: el próximo pedido de venta es otro
      // intento y merece otra clave (S5).
      if (resultado.ok && resultado.ventaRegistrada) {
        claveIdempotencia = nuevaClaveIdempotencia()
      }

      const ejecutada: LlamadaEjecutada = {
        nombre: pedida.function.name,
        argumentos,
        resultado,
      }
      llamadas.push(ejecutada)
      entrada.onEvento?.({ tipo: 'llamada', llamada: ejecutada })

      mensajes.push({
        role: 'tool',
        tool_call_id: pedida.id,
        content: serializarResultado(resultado),
      })
    }

    ronda += 1
  }
}

/** Los argumentos llegan como string JSON; si no parsean, la herramienta los rechaza. */
function parsearArgumentos(crudo: string): unknown {
  try {
    return JSON.parse(crudo) as unknown
  } catch {
    return undefined
  }
}

function serializarResultado(resultado: ResultadoHerramienta): string {
  return JSON.stringify(resultado.ok ? resultado.datos : { error: resultado.error })
}
