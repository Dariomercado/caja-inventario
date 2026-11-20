import { z } from 'zod'
import { INSTRUCCIONES_SISTEMA } from './instrucciones'
import type { Mensaje } from './modelo'

/**
 * Qué conversación ve el modelo en cada turno.
 *
 * El cliente manda sólo el transcript visible (quién dijo qué), no los mensajes
 * internos del proveedor. Tres razones:
 *
 * 1. Los mensajes con `role: "tool"` los produce el servidor; si el navegador los
 *    mandara, cualquiera podría inventar el resultado de una consulta.
 * 2. El mensaje de sistema lo pone el servidor, siempre, y no se puede reemplazar
 *    desde afuera (S12).
 * 3. Un transcript de texto no puede crecer sin control: el tope de mensajes y de
 *    caracteres se valida antes de gastar una llamada al modelo.
 */

export const MAX_TURNOS = 40
export const MAX_CARACTERES = 4_000

const esquemaTurno = z.object({
  rol: z.enum(['usuario', 'asistente']),
  texto: z.string().max(MAX_CARACTERES),
})

export const esquemaConversacion = z.object({
  turnos: z.array(esquemaTurno).max(MAX_TURNOS),
  mensaje: z.string().min(1, 'escribí qué querés hacer').max(MAX_CARACTERES),
  claveIdempotencia: z.string().min(1).max(200).optional(),
})

export type TurnoVisible = z.infer<typeof esquemaTurno>
export type EntradaConversacion = z.infer<typeof esquemaConversacion>

/** Arma los mensajes del turno: instrucciones del servidor, historial visible y el pedido nuevo. */
export function mensajesParaElModelo(turnos: TurnoVisible[], mensaje: string): Mensaje[] {
  const historial = turnos
    .filter((turno) => turno.texto.trim().length > 0)
    .map((turno): Mensaje =>
      turno.rol === 'usuario'
        ? { role: 'user', content: turno.texto }
        : { role: 'assistant', content: turno.texto },
    )

  return [
    { role: 'system', content: INSTRUCCIONES_SISTEMA },
    ...historial,
    { role: 'user', content: mensaje },
  ]
}
