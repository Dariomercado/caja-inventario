import type { LlamadaDelReplay, ReplayGrabado } from '@/server/asistente/replay'

/**
 * El panel del modo replay (S10, S13).
 *
 * Muestra **una** corrida grabada, no una respuesta a lo que escriba el visitante: el
 * pedido que se hizo, la respuesta que devolvió el modelo y las herramientas que
 * ejecutó, con la fecha y el modelo a la vista. La entrada queda deshabilitada porque
 * en este modo no hay nadie del otro lado: el asistente no llama al modelo.
 *
 * El tipo llega como import de tipo para que este componente no arrastre el cargador
 * (ni Zod) al bundle del navegador; el contenido del grabado sí viaja, porque es lo que
 * se muestra.
 */
export function Replay({ grabado, motivo }: { grabado: ReplayGrabado; motivo?: string }) {
  const [pedido, respuesta] = grabado.turnos
  const llamadas: LlamadaDelReplay[] = respuesta.llamadas ?? []

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-amber-900 bg-amber-950/30 px-4 py-3">
        <p className="text-sm font-medium text-amber-200">
          Modo replay: esto es una grabación, no una respuesta de hoy.
        </p>
        <p className="mt-1 text-xs text-amber-300/80 tabular-nums">
          Corrida grabada el <span className="font-mono">{grabado.fecha}</span> con el modelo{' '}
          <span className="font-mono">{grabado.modelo}</span> (caso «{grabado.caso}»). En este modo el
          asistente no llama al modelo ni escribe en la base.
        </p>
        {motivo ? <p className="mt-1 text-xs text-amber-300/80">{motivo}</p> : null}
      </div>

      <div className="min-h-[18rem] space-y-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-slate-500">Vos (pedido grabado)</p>
          <div className="rounded-2xl border border-slate-700 bg-slate-800/60 px-4 py-2 text-sm">
            <p className="whitespace-pre-wrap text-slate-100">{pedido.texto}</p>
          </div>
        </div>

        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-slate-500">Asistente (respuesta grabada)</p>
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-2 text-sm">
            <p className="whitespace-pre-wrap text-slate-100">{respuesta.texto}</p>

            {llamadas.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {llamadas.map((llamada, posicion) => (
                  <li
                    key={`${posicion}-${llamada.nombre}`}
                    className="flex flex-wrap items-baseline gap-2 text-xs tabular-nums"
                  >
                    <span className={llamada.estado === 'ok' ? 'text-emerald-400' : 'text-rose-400'}>
                      {llamada.estado === 'ok' ? '✓' : '✕'}
                    </span>
                    <span className="font-mono text-slate-400">{llamada.nombre}</span>
                    {llamada.detalle ? <span className="text-rose-300">{llamada.detalle}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="pedido-replay" className="text-sm text-slate-400">
          Pedido
        </label>
        <textarea
          id="pedido-replay"
          rows={3}
          disabled
          placeholder="Entrada deshabilitada: en modo replay no se responde a lo que escribas."
          className="w-full rounded-2xl border border-slate-800 bg-slate-950 px-4 py-2 text-sm text-slate-100 outline-none disabled:opacity-60"
        />
      </div>
    </section>
  )
}
