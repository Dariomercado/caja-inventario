import { prisma } from '../lib/db'

export class StockInsuficienteError extends Error {
  constructor(
    readonly productoId: string,
    readonly disponible: number,
    readonly pedido: number,
  ) {
    super(`Stock insuficiente para ${productoId}: disponible ${disponible}, pedido ${pedido}`)
    this.name = 'StockInsuficienteError'
  }
}

export class PagoInconsistenteError extends Error {
  constructor(
    readonly totalCentavos: number,
    readonly pagadoCentavos: number,
  ) {
    super(`Los pagos suman ${pagadoCentavos} y el total es ${totalCentavos}`)
    this.name = 'PagoInconsistenteError'
  }
}

export class ClaveIdempotenciaReutilizadaError extends Error {
  constructor(readonly claveIdempotencia: string) {
    super('La clave de idempotencia ya se usó para otra venta')
    this.name = 'ClaveIdempotenciaReutilizadaError'
  }
}

export type MedioPagoVenta = 'EFECTIVO' | 'TRANSFERENCIA' | 'TARJETA'

export type ItemVenta = { productoId: string; cantidad: number }

export type PagoVenta = { medio: MedioPagoVenta; montoCentavos: number }

export type RegistrarVentaInput = {
  usuarioId: string
  // Identifica el intento de venta. Si el mismo intento llega dos veces (doble
  // clic, reintento del navegador, un proxy que reenvía el POST), la segunda vez
  // devuelve la venta ya creada en lugar de registrar otra.
  claveIdempotencia: string
  items: ItemVenta[]
  // Exactamente uno de los dos: o se detallan los pagos, o se indica un único
  // medio y el monto sale del total calculado dentro de la transacción. El segundo
  // camino existe para la UI: si el navegador calculara el total y lo mandara,
  // bastaría un precio desactualizado para cobrar mal.
  pagos?: PagoVenta[]
  medioPago?: MedioPagoVenta
}

export type VentaRegistrada = {
  id: string
  numero: number
  totalCentavos: number
  /**
   * `false` cuando esta llamada creó la venta; `true` cuando devolvió una que ya
   * existía con la misma clave de idempotencia. La UI lo ignora; la API lo usa para
   * responder 201 o 200 sin inventar una segunda consulta.
   */
  reutilizada: boolean
}

type ProductoBloqueado = {
  id: string
  nombre: string
  precioCentavos: number
  stock: number
  activo: boolean
}

/**
 * Registra una venta completa dentro de una sola transacción: valida stock,
 * calcula totales, crea la venta con sus líneas y pagos, descuenta stock y deja
 * el movimiento en el libro mayor.
 *
 * Dos propiedades que sostienen el sistema:
 *
 * 1. Las filas de producto se bloquean con SELECT ... FOR UPDATE, así dos ventas
 *    simultáneas del mismo producto se serializan y ninguna puede leer un stock
 *    que otra está a punto de agotar.
 *
 * 2. Los bloqueos se adquieren en orden de id, no en el orden en que llegan los
 *    ítems. Sin eso, dos ventas con los mismos productos en orden inverso se
 *    esperarían mutuamente hasta el timeout: un deadlock que en producción
 *    aparece una vez cada tanto y es dificilísimo de reproducir.
 *
 * 3. La clave de idempotencia se guarda con índice único. Un segundo envío del
 *    mismo intento choca contra el índice, su transacción se revierte entera
 *    (sin descontar stock) y se devuelve la venta que ya existía.
 */
export async function registrarVenta(input: RegistrarVentaInput): Promise<VentaRegistrada> {
  const { claveIdempotencia } = input

  if (typeof claveIdempotencia !== 'string' || claveIdempotencia.trim() === '') {
    throw new Error('La venta necesita una clave de idempotencia')
  }
  if (claveIdempotencia.length > 200) {
    throw new Error('La clave de idempotencia es demasiado larga (máximo 200 caracteres)')
  }

  // El stock o el índice único pueden rechazar un reintento que ya se registró: se
  // busca la venta de esa clave antes de dar el error por bueno.
  try {
    return await ventaEnTransaccion(input)
  } catch (error) {
    const previa = await ventaPorClave(claveIdempotencia)
    if (!previa) throw error
    // Devolverla solo es honesto si el intento es el mismo: con otro carrito u otro
    // medio de pago, el comprobante viejo descartaría en silencio la venta nueva.
    const pedido = firma(input, previa.totalCentavos)
    const guardado = firma({ items: previa.lineas, pagos: previa.pagos }, previa.totalCentavos)
    if (previa.usuarioId !== input.usuarioId || pedido !== guardado) {
      throw new ClaveIdempotenciaReutilizadaError(claveIdempotencia)
    }
    return {
      id: previa.id,
      numero: previa.numero,
      totalCentavos: previa.totalCentavos,
      reutilizada: true,
    }
  }
}

function ventaPorClave(claveIdempotencia: string) {
  return prisma.venta.findUnique({
    where: { claveIdempotencia },
    include: { lineas: true, pagos: true },
  })
}

function firma(intento: Pick<RegistrarVentaInput, 'items' | 'pagos' | 'medioPago'>, total: number) {
  const cantidades = new Map<string, number>()
  for (const item of intento.items) {
    cantidades.set(item.productoId, (cantidades.get(item.productoId) ?? 0) + item.cantidad)
  }
  const items = [...cantidades].sort().map(([id, cantidad]) => `${id}x${cantidad}`)
  // Por el camino del formulario el pago viaja sin monto: el total lo pone el server.
  const pagos = intento.pagos ?? [{ medio: intento.medioPago, montoCentavos: total }]
  return [...items, ...pagos.map((p) => `${p.medio}:${p.montoCentavos}`).sort()].join('|')
}

async function ventaEnTransaccion(input: RegistrarVentaInput): Promise<VentaRegistrada> {
  const { usuarioId, items, pagos, medioPago, claveIdempotencia } = input

  if (items.length === 0) {
    throw new Error('La venta necesita al menos un ítem')
  }

  if ((pagos === undefined) === (medioPago === undefined)) {
    throw new Error('Indicá los pagos o un único medio de pago, no ambos ni ninguno')
  }

  // Consolidar ítems repetidos: si el mismo producto aparece dos veces, hay que
  // descontar la suma y bloquear la fila una sola vez. Bloquearla dos veces en la
  // misma transacción sería inofensivo, pero validar el stock por separado contra
  // el mismo valor sí daría un resultado incorrecto.
  const cantidadPorProducto = new Map<string, number>()
  for (const item of items) {
    if (!Number.isInteger(item.cantidad) || item.cantidad <= 0) {
      throw new Error(`Cantidad inválida para ${item.productoId}: ${item.cantidad}`)
    }
    cantidadPorProducto.set(
      item.productoId,
      (cantidadPorProducto.get(item.productoId) ?? 0) + item.cantidad,
    )
  }

  const idsOrdenados = [...cantidadPorProducto.keys()].sort()

  return prisma.$transaction(async (tx) => {
    const bloqueados = new Map<string, ProductoBloqueado>()

    for (const id of idsOrdenados) {
      const filas = await tx.$queryRaw<ProductoBloqueado[]>`
        SELECT "id", "nombre", "precioCentavos", "stock", "activo"
        FROM "Producto"
        WHERE "id" = ${id}
        FOR UPDATE
      `
      const producto = filas[0]
      if (!producto) {
        throw new Error(`El producto ${id} no existe`)
      }
      if (!producto.activo) {
        throw new Error(`El producto ${producto.nombre} está inactivo`)
      }
      bloqueados.set(id, producto)
    }

    const lineas: {
      productoId: string
      cantidad: number
      precioUnitarioCentavos: number
      subtotalCentavos: number
    }[] = []
    let totalCentavos = 0

    for (const id of idsOrdenados) {
      const producto = bloqueados.get(id)!
      const cantidad = cantidadPorProducto.get(id)!

      if (producto.stock < cantidad) {
        throw new StockInsuficienteError(id, producto.stock, cantidad)
      }

      const subtotalCentavos = producto.precioCentavos * cantidad
      totalCentavos += subtotalCentavos
      lineas.push({
        productoId: id,
        cantidad,
        precioUnitarioCentavos: producto.precioCentavos,
        subtotalCentavos,
      })
    }

    const pagosEfectivos: PagoVenta[] =
      pagos ?? [{ medio: medioPago!, montoCentavos: totalCentavos }]

    const pagadoCentavos = pagosEfectivos.reduce((suma, pago) => suma + pago.montoCentavos, 0)
    if (!Number.isInteger(pagadoCentavos) || pagadoCentavos !== totalCentavos) {
      throw new PagoInconsistenteError(totalCentavos, pagadoCentavos)
    }

    const venta = await tx.venta.create({
      data: {
        usuarioId,
        claveIdempotencia,
        totalCentavos,
        lineas: { create: lineas },
        pagos: {
          create: pagosEfectivos.map((pago) => ({
            medio: pago.medio,
            montoCentavos: pago.montoCentavos,
          })),
        },
      },
    })

    for (const linea of lineas) {
      const producto = bloqueados.get(linea.productoId)!
      const stockLuego = producto.stock - linea.cantidad

      await tx.producto.update({
        where: { id: linea.productoId },
        data: { stock: stockLuego },
      })

      await tx.movimientoStock.create({
        data: {
          productoId: linea.productoId,
          tipo: 'SALIDA',
          cantidad: linea.cantidad,
          stockLuego,
          motivo: `Venta #${venta.numero}`,
          ventaId: venta.id,
        },
      })
    }

    return {
      id: venta.id,
      numero: venta.numero,
      totalCentavos: venta.totalCentavos,
      reutilizada: false,
    }
  })
}
