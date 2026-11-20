import { Suspense } from 'react'
import { io } from 'next/cache'
import { configDesde } from '@/server/asistente/config'
import { cargarReplayGrabado, decidirEstadoDelPanel } from '@/server/asistente/replay'
import { llamadasDelDia } from '@/server/asistente/uso'
import { Conversacion } from './Conversacion'
import { Replay } from './Replay'

/**
 * La pantalla del asistente, y el lugar donde se decide qué se muestra (S1, S10, S13).
 *
 * El orden es el del diseño: presupuesto → configuración → conversación viva. Sin esta
 * decisión, un panel sin `ASISTENTE_*` no mostraría nada y un día sin presupuesto
 * mostraría un error; con ella los dos casos caen en la corrida grabada, que no llama al
 * modelo ni escribe en la base. La única lectura a la base es el contador del día.
 *
 * El estado se resuelve por pedido y no en el build: `io()` saca ese árbol del shell
 * estático, porque el presupuesto y la configuración cambian entre visitas.
 */
export default function PaginaAsistente() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Asistente</h1>
        <p className="max-w-2xl text-sm text-slate-400">
          Pedidos en castellano, resueltos a través de la API pública con un token de scopes
          acotados. El asistente no calcula dinero: los precios y los totales los devuelve la API.
          Cada pedido tiene un tope de rondas y el día un tope de llamadas al modelo.
        </p>
      </div>

      <Suspense fallback={<p className="text-sm text-slate-500">Leyendo el estado del asistente…</p>}>
        <EstadoDelAsistente />
      </Suspense>
    </div>
  )
}

async function EstadoDelAsistente() {
  await io()

  // Una lectura estática (la grabación empaquetada) y una sola lectura a la base (el
  // contador). En modo replay no hay llamada al modelo ni escritura.
  const usadasHoy = await leerUsadasHoy()
  const configuracion = leerConfiguracion()
  const estado = decidirEstadoDelPanel({
    grabado: cargarReplayGrabado(),
    usadasHoy,
    topeDiario: configuracion.topeDiario,
    problemaDeConfiguracion: configuracion.problema,
  })

  return (
    <>
      {estado.tipo === 'vivo' ? <Conversacion /> : null}

      {estado.tipo === 'replay' ? (
        <Replay grabado={estado.grabado} motivo={estado.motivo} />
      ) : null}

      {estado.tipo === 'sin-configurar' ? (
        <p className="rounded-2xl border border-amber-900 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
          {estado.detalle}
        </p>
      ) : null}
    </>
  )
}

async function leerUsadasHoy(): Promise<number | null> {
  try {
    return await llamadasDelDia()
  } catch {
    // Un contador ilegible no puede tumbar la pantalla: sin dato se sigue con la
    // conversación viva, y el tope lo aplica igual la acción al enviar.
    return null
  }
}

function leerConfiguracion(): { topeDiario: number | null; problema: string | null } {
  try {
    return { topeDiario: configDesde().modelo.maxLlamadasPorDia, problema: null }
  } catch (error) {
    // `configDesde` sólo lanza `ConfigIncompletaError`/`ConfigInvalidaError`, pero acá se
    // atrapa todo: renderizar nunca puede terminar en una excepción.
    return {
      topeDiario: null,
      problema:
        error instanceof Error ? error.message : 'la configuración del asistente no se pudo leer',
    }
  }
}
