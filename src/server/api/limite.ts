import { prisma } from '@/lib/db'

/**
 * Rate limit por token, contado en Postgres.
 *
 * No se cuenta en memoria del proceso a propósito: el deploy corre en varias
 * instancias y cada una tendría su propio contador, así que un límite de 60 por
 * minuto se convertiría en 60 × instancias. La fila de la tabla es el contador, y
 * el incremento es un único `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`. Con
 * eso dos instancias no pueden contar de menos: la base serializa la fila.
 *
 * Ventana fija y no deslizante: es exacta para el objetivo (frenar un abuso), y se
 * puede explicar y testear. Una ventana deslizante exigiría guardar cada pedido.
 */

/** Una ventana de un minuto. Fija y no configurable: el contrato es por minuto. */
export const VENTANA_MS = 60_000

/** Cuántas ventanas se conservan antes de barrer las viejas. */
const VENTANAS_CONSERVADAS = 1440 // un día

export type ResultadoCupo =
  | { permitido: true }
  | { permitido: false; reintentarEnSegundos: number }

/** Inicio de la ventana que contiene `ahora`, truncado al minuto. */
export function inicioDeVentana(ahora: number = Date.now()): Date {
  return new Date(Math.floor(ahora / VENTANA_MS) * VENTANA_MS)
}

/**
 * Consume un pedido del cupo del token y dice si estaba permitido.
 *
 * El pedido se cuenta aunque se rechace: si los rechazos fueran gratis, un cliente
 * en bucle no tendría freno. El rechazo siempre informa cuántos segundos faltan para
 * la próxima ventana, para que quien reintenta no tenga que adivinar.
 */
export async function consumirCupo(
  tokenId: string,
  limitePorMinuto: number,
  ahora: number = Date.now(),
): Promise<ResultadoCupo> {
  const inicio = inicioDeVentana(ahora)

  const filas = await prisma.$queryRaw<{ usos: number }[]>`
    INSERT INTO "UsoTokenApi" ("tokenId", "ventana", "usos")
    VALUES (${tokenId}, ${inicio}, 1)
    ON CONFLICT ("tokenId", "ventana") DO UPDATE SET "usos" = "UsoTokenApi"."usos" + 1
    RETURNING "usos"
  `

  const usos = filas[0]?.usos ?? 0

  // Barrido oportunista: sólo el primer pedido de una ventana nueva lo dispara, así
  // que cuesta una escritura por token y por minuto, no una por pedido. Sin esto la
  // tabla crece para siempre, un renglón por minuto por token.
  if (usos === 1) {
    const corte = new Date(inicio.getTime() - VENTANA_MS * VENTANAS_CONSERVADAS)
    await prisma.$executeRaw`
      DELETE FROM "UsoTokenApi" WHERE "tokenId" = ${tokenId} AND "ventana" < ${corte}
    `
  }

  if (usos <= limitePorMinuto) return { permitido: true }

  const faltan = VENTANA_MS - (ahora - inicio.getTime())
  return { permitido: false, reintentarEnSegundos: Math.max(1, Math.ceil(faltan / 1000)) }
}
