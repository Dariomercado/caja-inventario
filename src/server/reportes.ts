import { prisma } from '../lib/db'

// Todos los reportes agregan en la base, no en JavaScript. Traer las filas y
// sumarlas en el proceso funcionaría con diez ventas y se cae con diez mil.
//
// ZONA HORARIA: un "día" es el día local de Buenos Aires (UTC-3), no el día UTC.
// Una venta de las 23:30 local ya es el día siguiente en UTC. Si se usa
// date_trunc('day', "createdAt") sin AT TIME ZONE, esas ventas caen en el día
// equivocado y la caja diaria no cierra. Argentina no aplica horario de verano
// desde 2009, así que sumar interval '1 day' equivale a un día calendario.
export const ZONA_NEGOCIO = 'America/Argentina/Buenos_Aires'

export type ResumenDia = {
  fecha: string
  cantidadVentas: number
  totalCentavos: number
}

export type TopProducto = {
  productoId: string
  nombre: string
  cantidadVendida: number
  totalCentavos: number
}

export type MedioPagoVenta = 'EFECTIVO' | 'TRANSFERENCIA' | 'TARJETA'

export type CajaMedio = {
  medio: MedioPagoVenta
  cantidadPagos: number
  totalCentavos: number
}

export type CajaDelDia = {
  fecha: string
  medios: CajaMedio[]
  cantidadPagos: number
  granTotalCentavos: number
}

export async function resumenPorDia(rango: {
  desde: string
  hasta: string
}): Promise<ResumenDia[]> {
  return prisma.$queryRaw<ResumenDia[]>`
    SELECT
      to_char(d.dia AT TIME ZONE ${ZONA_NEGOCIO}, 'YYYY-MM-DD') AS "fecha",
      COUNT(v."id")::int                              AS "cantidadVentas",
      COALESCE(SUM(v."totalCentavos"), 0)::int        AS "totalCentavos"
    FROM generate_series(
      (${rango.desde}::date)::timestamp AT TIME ZONE ${ZONA_NEGOCIO},
      (${rango.hasta}::date)::timestamp AT TIME ZONE ${ZONA_NEGOCIO},
      interval '1 day'
    ) AS d(dia)
    LEFT JOIN "Venta" v
      ON v."createdAt" >= d.dia
     AND v."createdAt" <  d.dia + interval '1 day'
    GROUP BY d.dia
    ORDER BY d.dia
  `
}

export async function topProductos(rango: {
  desde: string
  hasta: string
  limite?: number
}): Promise<TopProducto[]> {
  const limite = rango.limite ?? 10

  return prisma.$queryRaw<TopProducto[]>`
    SELECT
      lv."productoId"                        AS "productoId",
      p."nombre"                             AS "nombre",
      SUM(lv."cantidad")::int                AS "cantidadVendida",
      SUM(lv."subtotalCentavos")::int        AS "totalCentavos"
    FROM "LineaVenta" lv
    JOIN "Venta" v    ON v."id" = lv."ventaId"
    JOIN "Producto" p ON p."id" = lv."productoId"
    WHERE v."createdAt" >= (${rango.desde}::date)::timestamp AT TIME ZONE ${ZONA_NEGOCIO}
      AND v."createdAt" <  ((${rango.hasta}::date + 1)::timestamp AT TIME ZONE ${ZONA_NEGOCIO})
    GROUP BY lv."productoId", p."nombre"
    ORDER BY "cantidadVendida" DESC, "totalCentavos" DESC, p."nombre" ASC
    LIMIT ${limite}
  `
}

export async function cajaDelDia(rango: { fecha: string }): Promise<CajaDelDia> {
  const medios = await prisma.$queryRaw<CajaMedio[]>`
    SELECT
      pago."medio"::text              AS "medio",
      COUNT(*)::int                   AS "cantidadPagos",
      SUM(pago."montoCentavos")::int  AS "totalCentavos"
    FROM "Pago" pago
    WHERE pago."createdAt" >= (${rango.fecha}::date)::timestamp AT TIME ZONE ${ZONA_NEGOCIO}
      AND pago."createdAt" <  ((${rango.fecha}::date + 1)::timestamp AT TIME ZONE ${ZONA_NEGOCIO})
    GROUP BY pago."medio"
    ORDER BY pago."medio"
  `

  return {
    fecha: rango.fecha,
    medios,
    cantidadPagos: medios.reduce((suma, m) => suma + m.cantidadPagos, 0),
    granTotalCentavos: medios.reduce((suma, m) => suma + m.totalCentavos, 0),
  }
}
