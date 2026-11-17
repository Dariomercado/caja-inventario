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

export type MedioPagoVenta = 'EFECTIVO' | 'TRANSFERENCIA' | 'TARJETA'

export type ItemVenta = { productoId: string; cantidad: number }

export type PagoVenta = { medio: MedioPagoVenta; montoCentavos: number }

export type RegistrarVentaInput = {
  usuarioId: string
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
 */
export async function registrarVenta(
  input: RegistrarVentaInput,
): Promise<VentaRegistrada> {
  const { usuarioId, items, pagos, medioPago } = input

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
    }
  })
}
