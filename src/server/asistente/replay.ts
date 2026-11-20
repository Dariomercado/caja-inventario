import { z } from 'zod'
import grabadoCrudo from './replay-grabado.json'

/**
 * La corrida grabada que el panel sirve en modo replay (S10, S13).
 *
 * Un replay **no** es una respuesta fija a cualquier pregunta: es una intercambio
 * grabado, mostrado como tal, con su fecha y su modelo. Servir un texto fijo a lo que
 * escriba un visitante sería pasar una grabación por respuesta del día, que es lo que
 * S9 y S13 prohíben. Por eso el panel no conversa en este modo: muestra esta corrida y
 * deja la entrada deshabilitada.
 *
 * El archivo se importa de forma estática para que Next lo empaquete: leerlo de `evals/`
 * en runtime no sobreviviría a un deploy serverless. Consecuencia: un archivo ausente es
 * un error de build, no un `null` en runtime; el `null` cubre el contenido ilegible, que
 * es lo que puede pasar si alguien edita el JSON a mano.
 */

const esquemaLlamada = z
  .object({
    nombre: z.string().min(1),
    estado: z.enum(['ok', 'error']),
    /** El error de la herramienta, o vacío cuando salió bien. */
    detalle: z.string(),
  })
  .strict()

const esquemaTurno = z
  .object({
    rol: z.enum(['usuario', 'asistente']),
    texto: z.string().min(1),
    llamadas: z.array(esquemaLlamada).optional(),
  })
  .strict()

export const esquemaReplayGrabado = z
  .object({
    /** Nombre del caso de eval del que sale la grabación. */
    caso: z.string().min(1),
    /** El pedido del usuario, tal como se le hizo al asistente. */
    pedido: z.string().min(1),
    /** Día de la captura, en UTC, con el formato que se muestra en pantalla. */
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'formato YYYY-MM-DD'),
    /** Id del modelo que respondió: sin esto la grabación no se puede fechar ni acreditar. */
    modelo: z.string().min(1),
    /** Un intercambio: el pedido y la respuesta. Ni uno más. */
    turnos: z.array(esquemaTurno).length(2),
  })
  .strict()
  .superRefine((grabado, contexto) => {
    const [usuario, asistente] = grabado.turnos

    if (usuario?.rol !== 'usuario') {
      contexto.addIssue({ code: 'custom', path: ['turnos', 0, 'rol'], message: 'el primer turno es el pedido del usuario' })
    }

    if (asistente?.rol !== 'asistente') {
      contexto.addIssue({ code: 'custom', path: ['turnos', 1, 'rol'], message: 'el segundo turno es la respuesta del asistente' })
    }

    if (usuario && usuario.texto !== grabado.pedido) {
      contexto.addIssue({ code: 'custom', path: ['pedido'], message: 'el pedido tiene que ser el texto del turno del usuario' })
    }

    if (usuario?.llamadas) {
      contexto.addIssue({ code: 'custom', path: ['turnos', 0, 'llamadas'], message: 'el turno del usuario no ejecuta herramientas' })
    }

    if (asistente && asistente.llamadas === undefined) {
      contexto.addIssue({
        code: 'custom',
        path: ['turnos', 1, 'llamadas'],
        message: 'el turno del asistente declara las herramientas que ejecutó, aunque sea una lista vacía',
      })
    }
  })

export type LlamadaDelReplay = z.infer<typeof esquemaLlamada>
export type TurnoDelReplay = z.infer<typeof esquemaTurno>
export type ReplayGrabado = z.infer<typeof esquemaReplayGrabado>

/**
 * Valida una corrida grabada. Devuelve `null` en lugar de lanzar: el panel tiene que
 * poder renderizar sin grabación, y un archivo roto no es una razón para romper la
 * pantalla entera.
 */
export function leerReplayGrabado(crudo: unknown): ReplayGrabado | null {
  const resultado = esquemaReplayGrabado.safeParse(crudo)
  return resultado.success ? resultado.data : null
}

/** La grabación que viene empaquetada con la app. */
export function cargarReplayGrabado(crudo: unknown = grabadoCrudo): ReplayGrabado | null {
  return leerReplayGrabado(crudo)
}

export type EstadoDelPanel =
  | { tipo: 'vivo' }
  | { tipo: 'replay'; grabado: ReplayGrabado; motivo: string }
  | { tipo: 'sin-configurar'; detalle: string }

export type DecisionDelPanel = {
  /** La corrida grabada, o `null` si no hay o no se pudo leer. */
  grabado: ReplayGrabado | null
  /** Llamadas al modelo usadas hoy, o `null` si el contador no se pudo leer. */
  usadasHoy: number | null
  /** Tope diario configurado, o `null` si la configuración no alcanza para saberlo. */
  topeDiario: number | null
  /** El mensaje de configuración faltante o inválida, o `null` si está completa. */
  problemaDeConfiguracion: string | null
}

/**
 * Qué estado renderiza el panel, en el orden que fija el diseño: presupuesto,
 * configuración, conversación viva.
 *
 * Nunca lanza. Sin grabación disponible se vuelve al comportamiento de siempre —decir
 * que el presupuesto se agotó o que falta configurar—, que es mejor que inventar turnos.
 */
export function decidirEstadoDelPanel(decision: DecisionDelPanel): EstadoDelPanel {
  const agotado =
    decision.usadasHoy !== null &&
    decision.topeDiario !== null &&
    decision.usadasHoy >= decision.topeDiario

  if (agotado && decision.grabado) {
    return {
      tipo: 'replay',
      grabado: decision.grabado,
      motivo: `Se agotó el presupuesto diario de ${decision.topeDiario} llamadas al modelo. Hasta el corte de las 00:00 UTC el panel sirve esta corrida grabada.`,
    }
  }

  if (decision.problemaDeConfiguracion) {
    if (decision.grabado) {
      return {
        tipo: 'replay',
        grabado: decision.grabado,
        motivo: `${decision.problemaDeConfiguracion}. Mientras falte la configuración, el panel sirve esta corrida grabada.`,
      }
    }

    return {
      tipo: 'sin-configurar',
      detalle: `${decision.problemaDeConfiguracion}. Revisá las variables de entorno del asistente.`,
    }
  }

  return { tipo: 'vivo' }
}
