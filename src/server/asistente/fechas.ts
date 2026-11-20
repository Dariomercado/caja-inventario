import { ZONA_NEGOCIO } from '@/server/reportes'

/**
 * Fechas del asistente, en el día del negocio.
 *
 * Todo lo que la API devuelve está en UTC. Traducirlo es una cuenta —y una cuenta
 * de un tipo que se equivoca fácil, porque el día cambia a las 21:00 locales— así que
 * no se le pide al modelo: se hace acá, una vez, con la misma zona que usan los
 * reportes. Es la misma regla que con el dinero, que tampoco lo suma el modelo.
 */

/** Día del negocio en `YYYY-MM-DD`, que es el formato que piden las herramientas. */
export function fechaDelNegocio(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_NEGOCIO }).format(ahora)
}

/**
 * Fecha y hora del negocio en `YYYY-MM-DD HH:mm`, a partir del ISO en UTC.
 *
 * `hourCycle: 'h23'` y no `hour12: false`: con este último, algunas versiones de ICU
 * formatean la medianoche como 24 en lugar de 00, y una venta de las 00:10 aparecería
 * como del día anterior.
 */
export function fechaHoraLocal(iso: string): string {
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return iso

  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_NEGOCIO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(fecha)

  return partes.replace(', ', ' ')
}
