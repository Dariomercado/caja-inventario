'use server'

import { mensajeDeValidacion } from '@/server/api/esquemas'
import { crearClienteApi } from '@/server/asistente/api'
import { ejecutarTurno, type LlamadaEjecutada } from '@/server/asistente/bucle'
import { ConfigIncompletaError, ConfigInvalidaError, configDesde } from '@/server/asistente/config'
import { esquemaConversacion, mensajesParaElModelo } from '@/server/asistente/conversacion'
import { crearHerramientas } from '@/server/asistente/herramientas'
import { crearClienteModelo } from '@/server/asistente/modelo'
import { SinPresupuestoDiarioError, llamadasDelDia, reservadorDeCupo } from '@/server/asistente/uso'
import { requerirUsuario } from '@/server/sesion'

/**
 * Acción del panel que corre un turno del asistente.
 *
 * Todo lo que llega del navegador se valida acá: el transcript se reconstruye con
 * las instrucciones del servidor y los topes, y los mensajes internos del proveedor
 * no viajan de vuelta desde el cliente.
 *
 * El cupo diario se reserva **antes** de cada llamada al modelo, no por pedido: un
 * pedido con cuatro rondas gasta cinco llamadas y es lo que se factura (S10).
 */

export type LlamadaVisible = {
  nombre: string
  estado: 'ok' | 'error'
  detalle: string
}

export type RespuestaAsistente =
  | {
      estado: 'ok'
      texto: string
      llamadas: LlamadaVisible[]
      topeAlcanzado: boolean
      claveIdempotencia: string
      usadasHoy: number
      topeDiario: number
    }
  | { estado: 'replay'; texto: string; usadasHoy: number; topeDiario: number }
  | { estado: 'error'; texto: string }

export async function conversar(entrada: unknown): Promise<RespuestaAsistente> {
  // La sesión se verifica en la acción y no sólo en el layout: una acción es un
  // endpoint más y no hereda la protección de la pantalla que la invoca.
  await requerirUsuario()

  const validada = esquemaConversacion.safeParse(entrada)
  if (!validada.success) {
    return { estado: 'error', texto: mensajeDeValidacion(validada.error) }
  }

  let config
  try {
    config = configDesde()
  } catch (error) {
    if (error instanceof ConfigIncompletaError || error instanceof ConfigInvalidaError) {
      // Es un error de operación, no del usuario: se dice qué falta en lugar de
      // mostrar una pantalla que no responde nada.
      return { estado: 'error', texto: `${error.message}. Revisá las variables de entorno.` }
    }
    throw error
  }

  const cliente = crearClienteApi({ baseUrl: config.api.baseUrl, token: config.api.token })
  const modelo = crearClienteModelo(config.modelo)
  const herramientas = crearHerramientas(cliente, { maxProductos: config.modelo.maxProductos })

  try {
    const resultado = await ejecutarTurno({
      modelo,
      herramientas,
      mensajes: mensajesParaElModelo(validada.data.turnos, validada.data.mensaje),
      ...(validada.data.claveIdempotencia
        ? { claveIdempotencia: validada.data.claveIdempotencia }
        : {}),
      maxRondas: config.modelo.maxRondas,
      reservarLlamada: reservadorDeCupo({ tope: config.modelo.maxLlamadasPorDia }),
    })

    return {
      estado: 'ok',
      texto: resultado.texto,
      llamadas: resultado.llamadas.map(resumir),
      topeAlcanzado: resultado.topeAlcanzado,
      claveIdempotencia: resultado.claveIdempotencia,
      usadasHoy: await llamadasDelDia(),
      topeDiario: config.modelo.maxLlamadasPorDia,
    }
  } catch (error) {
    if (error instanceof SinPresupuestoDiarioError) {
      // Modo replay (S10, S13): se dice en pantalla en vez de mostrar un error. La
      // corrida grabada se sirve desde T6, que es donde existe el formato de fixture.
      return {
        estado: 'replay',
        texto: `Se agotó el presupuesto diario de ${error.tope} llamadas al modelo. El asistente queda en modo replay hasta el corte de las 00:00 UTC.`,
        usadasHoy: error.usadas,
        topeDiario: error.tope,
      }
    }

    return {
      estado: 'error',
      texto: error instanceof Error ? error.message : 'El asistente falló sin decir por qué.',
    }
  }
}

/** Lo que se muestra de cada llamada: el estado, no su payload. */
function resumir(llamada: LlamadaEjecutada): LlamadaVisible {
  if (llamada.resultado.ok) {
    return { nombre: llamada.nombre, estado: 'ok', detalle: '' }
  }

  return {
    nombre: llamada.nombre,
    estado: 'error',
    detalle: `${llamada.resultado.error.code}: ${llamada.resultado.error.message}`,
  }
}
