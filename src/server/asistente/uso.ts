import { prisma } from '@/lib/db'
import { LLAMADAS_POR_DIA_POR_DEFECTO } from './config'

export { LLAMADAS_POR_DIA_POR_DEFECTO }

/**
 * Contador diario de llamadas al modelo (S10).
 *
 * La unidad es la llamada al modelo, no el pedido: un pedido con cuatro rondas gasta
 * cinco llamadas, y es lo que se paga. Contar pedidos dejaría el techo abierto a un
 * factor de `maxRondas`.
 *
 * Se cuenta en Postgres y no en memoria por la misma razón que el rate limit por
 * token: el deploy corre en varias instancias y cada una tendría su propio contador,
 * así que un tope de 300 por día se convertiría en 300 × instancias. El incremento
 * es un único `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, así que la fila es el
 * contador y la base serializa.
 *
 * La fecha es el día UTC. El servidor puede correr en otra zona y el corte tiene que
 * ser el mismo para todas las instancias, no el de cada máquina.
 */

export type CupoDiario = {
  permitido: boolean
  usadas: number
  tope: number
}

export class SinPresupuestoDiarioError extends Error {
  constructor(readonly usadas: number, readonly tope: number) {
    super(`Se agotó el presupuesto diario de ${tope} llamadas al modelo (van ${usadas}).`)
    this.name = 'SinPresupuestoDiarioError'
  }
}

/** Día UTC en `YYYY-MM-DD`. */
export function diaDe(ahora: Date = new Date()): string {
  return ahora.toISOString().slice(0, 10)
}

/**
 * Consume una llamada y dice si estaba dentro del tope.
 *
 * Se cuenta aunque se rechace: sin eso, un cliente en bucle sobre el tope agotado
 * seguiría entrando hasta que alguien mire. El número que vuelve es el real, así que
 * la pantalla puede mostrar cuántas quedan sin una segunda consulta.
 */
export async function consumirLlamadaDeModelo(
  tope: number = LLAMADAS_POR_DIA_POR_DEFECTO,
  ahora: Date = new Date(),
): Promise<CupoDiario> {
  const filas = await prisma.$queryRaw<{ llamadas: number }[]>`
    INSERT INTO "UsoModeloDiario" ("fecha", "llamadas")
    VALUES (${diaDe(ahora)}::date, 1)
    ON CONFLICT ("fecha") DO UPDATE SET "llamadas" = "UsoModeloDiario"."llamadas" + 1
    RETURNING "llamadas"
  `

  const usadas = filas[0]?.llamadas ?? 0
  return { permitido: usadas <= tope, usadas, tope }
}

/** Lectura sin consumo, para mostrar el presupuesto antes de gastar una llamada. */
export async function llamadasDelDia(ahora: Date = new Date()): Promise<number> {
  const filas = await prisma.$queryRaw<{ llamadas: number }[]>`
    SELECT "llamadas" FROM "UsoModeloDiario" WHERE "fecha" = ${diaDe(ahora)}::date
  `
  return filas[0]?.llamadas ?? 0
}

/**
 * Reserva de cupo para el loop: se llama antes de cada llamada al modelo.
 *
 * Devuelve una función y no un booleano porque el loop necesita fallar en el medio:
 * si el presupuesto se agota en la tercera ronda, lanza y el turno se corta ahí en
 * lugar de seguir gastando.
 */
export function reservadorDeCupo(
  opciones: { tope?: number; ahora?: Date } = {},
): () => Promise<void> {
  const tope = opciones.tope ?? LLAMADAS_POR_DIA_POR_DEFECTO

  return async () => {
    const cupo = await consumirLlamadaDeModelo(tope, opciones.ahora)
    if (!cupo.permitido) throw new SinPresupuestoDiarioError(cupo.usadas, cupo.tope)
  }
}
