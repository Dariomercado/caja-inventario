'use server'

import { revalidatePath } from 'next/cache'
import { requerirUsuario } from '@/server/sesion'
import {
  PagoInconsistenteError,
  StockInsuficienteError,
  registrarVenta,
  type MedioPagoVenta,
} from '@/server/ventas'

export type ResultadoVenta =
  | { ok: true; numero: number; totalCentavos: number }
  | { ok: false; error: string }

export async function accionRegistrarVenta(entrada: {
  items: { productoId: string; cantidad: number }[]
  medioPago: MedioPagoVenta
}): Promise<ResultadoVenta> {
  // El usuario sale de la sesión, nunca del formulario: un id de usuario enviado
  // por el cliente sería una atribución de venta falsificable.
  const usuario = await requerirUsuario()

  try {
    const venta = await registrarVenta({
      usuarioId: usuario.id,
      items: entrada.items,
      medioPago: entrada.medioPago,
    })

    // El stock y la caja cambiaron: las pantallas que los muestran quedan viejas.
    revalidatePath('/productos')
    revalidatePath('/reportes')

    return { ok: true, numero: venta.numero, totalCentavos: venta.totalCentavos }
  } catch (error) {
    if (error instanceof StockInsuficienteError) {
      return {
        ok: false,
        error: `Sin stock suficiente: quedan ${error.disponible} y se pidieron ${error.pedido}.`,
      }
    }
    if (error instanceof PagoInconsistenteError) {
      return { ok: false, error: 'El pago no coincide con el total de la venta.' }
    }

    // Cualquier otra cosa se registra y se devuelve un mensaje sin detalles
    // internos: el detalle va al log del servidor, no a la pantalla.
    console.error('Error al registrar la venta', error)
    return { ok: false, error: 'No se pudo registrar la venta.' }
  }
}
