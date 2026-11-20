import { esquemaReplayGrabado, type ReplayGrabado } from '../replay'
import type { CasoEval, FixtureEval } from './caso'
import type { TranscripcionDeCaso } from './runner'

/**
 * El generador de la corrida grabada del panel (S10, S13).
 *
 * Un solo constructor para las dos procedencias: `--grabar` lo llama con el resultado
 * de una corrida live, y también se puede llamar con el resultado de reproducir un
 * fixture ya grabado, que no cuesta ninguna llamada al proveedor. Lo que no hace nunca
 * es inventar: si la captura no dice cuándo se grabó o con qué modelo, o la respuesta
 * quedó vacía, devuelve `null` y el archivo anterior queda intacto.
 */

/** El caso que el panel reproduce: el pedido más legible de los nueve. */
export const CASO_DEL_REPLAY = '01-simple-sale.json'

export function componerReplayGrabado(entrada: {
  caso: CasoEval
  transcripcion: TranscripcionDeCaso
  captura: FixtureEval
}): ReplayGrabado | null {
  const respuestas = entrada.captura.attempts.flat()

  const creados = respuestas
    .map((respuesta) => respuesta.created)
    .filter((created): created is number => typeof created === 'number')

  const modelo = respuestas
    .map((respuesta) => respuesta.model)
    .find((nombre): nombre is string => typeof nombre === 'string' && nombre.length > 0)

  const texto = entrada.transcripcion.texto

  if (creados.length === 0 || modelo === undefined || texto.trim().length === 0) return null

  // La fecha es la de la captura y sale del propio proveedor: usar el reloj haría que
  // la grabación dijera "de hoy" para siempre, que es justo lo que no puede pasar.
  const fecha = new Date(Math.max(...creados) * 1000).toISOString().slice(0, 10)

  const grabado = {
    caso: entrada.caso.name,
    pedido: entrada.caso.request.message,
    fecha,
    modelo,
    turnos: [
      { rol: 'usuario' as const, texto: entrada.caso.request.message },
      { rol: 'asistente' as const, texto, llamadas: entrada.transcripcion.llamadas },
    ],
  }

  const validado = esquemaReplayGrabado.safeParse(grabado)
  return validado.success ? validado.data : null
}
