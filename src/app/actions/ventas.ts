'use server'

import { revalidatePath } from 'next/cache'
import { requerirUsuario } from '@/server/sesion'
import {
  ClaveIdempotenciaReutilizadaError,
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
  claveIdempotencia: string
}): Promise<ResultadoVenta> {
  // El usuario sale de la sesión, nunca del formulario: un id de usuario enviado
  // por el cliente sería una atribución de venta falsificable.
  const usuario = await requerirUsuario()

  // El cliente decide el transporte, no el servicio: acá solo se comprueba la
  // forma. Si la clave falta o viene en blanco, el formulario está mal y hay que
  // decirlo, no inventar una que haría pasar dos ventas distintas por la misma.
  if (typeof entrada.claveIdempotencia !== 'string' || entrada.claveIdempotencia.trim() === '') {
    return { ok: false, error: 'Falta la clave de idempotencia de la venta.' }
  }

  try {
    const venta = await registrarVenta({
      usuarioId: usuario.id,
      claveIdempotencia: entrada.claveIdempotencia,
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
    // La clave ya es de otra venta: no se registró nada, así que no hay comprobante
    // que mostrar. El formulario arranca un intento limpio al reintentar.
    if (error instanceof ClaveIdempotenciaReutilizadaError) {
      return { ok: false, error: 'Esa venta ya se registró con otros datos. Recargá la página para registrar la nueva.' }
    }

    // Cualquier otra cosa se registra y se devuelve un mensaje sin detalles
    // internos: el detalle va al log del servidor, no a la pantalla.
    console.error('Error al registrar la venta', error)
    return { ok: false, error: 'No se pudo registrar la venta.' }
  }
}
