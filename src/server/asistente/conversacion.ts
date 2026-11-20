import { z } from 'zod'
import { ZONA_NEGOCIO } from '@/server/reportes'
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
export function mensajesParaElModelo(
  turnos: TurnoVisible[],
  mensaje: string,
  ahora: Date = new Date(),
): Mensaje[] {
  const historial = turnos
    .filter((turno) => turno.texto.trim().length > 0)
    .map((turno): Mensaje =>
      turno.rol === 'usuario'
        ? { role: 'user', content: turno.texto }
        : { role: 'assistant', content: turno.texto },
    )

  return [
    { role: 'system', content: instruccionesDelDia(ahora) },
    ...historial,
    { role: 'user', content: mensaje },
  ]
}

/**
 * El día del negocio, en la zona de los reportes.
 *
 * No es el día UTC: una venta de las 23:30 en Buenos Aires ya es el día siguiente
 * en UTC, y los reportes agregan con `AT TIME ZONE 'America/Argentina/Buenos_Aires'`
 * justamente para que la caja cierre. Si al modelo se le dijera el día UTC, entre las
 * 21:00 y las 24:00 locales consultaría un día que todavía no pasó para el negocio:
 * el mismo error de fecha que este arreglo vino a resolver, con otro disfraz.
 */
export function fechaDelNegocio(ahora: Date = new Date()): string {
  // `en-CA` formatea como YYYY-MM-DD, que es el formato que piden las herramientas.
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_NEGOCIO }).format(ahora)
}

/**
 * Las instrucciones más la fecha de hoy.
 *
 * Sin esto el modelo **adivina** qué día es: `caja_del_dia` y `ventas_por_dia` piden
 * una fecha como argumento, y en la primera corrida real contra el panel contestó
 * «hoy (18/11)» un 20/11 —tomó la fecha de las ventas que le devolvió la API— y
 * devolvió una caja en cero con ventas cargadas. Una fecha inventada no falla: da una
 * respuesta segura y equivocada, que es peor.
 */
export function instruccionesDelDia(ahora: Date = new Date()): string {
  const fecha = fechaDelNegocio(ahora)
  return [
    INSTRUCCIONES_SISTEMA,
    '',
    `Hoy es ${fecha}. Cuando te pidan "hoy", usá exactamente esa fecha.`,
    'Para registrar una venta usá el campo `id` del producto, nunca el `sku`: la API rechaza el SKU como si el producto no existiera.',
  ].join('\n')
}
