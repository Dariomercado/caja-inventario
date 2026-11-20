'use client'

import { useState, useTransition } from 'react'
import { conversar, type LlamadaVisible } from '@/app/actions/asistente'
import type { ReplayGrabado } from '@/server/asistente/replay'
import { Replay } from './Replay'

type Turno = {
  rol: 'usuario' | 'asistente'
  texto: string
  llamadas?: LlamadaVisible[]
  aviso?: string
}

type Presupuesto = { usadasHoy: number; topeDiario: number }

/**
 * La charla del panel.
 *
 * El estado de la conversación vive acá y no en el servidor por una razón concreta:
 * la clave de idempotencia del intento tiene que sobrevivir entre pedidos. Si viviera
 * en el servidor habría que asociarla a una sesión de charla, y un segundo mensaje
 * confirmando ("dale") tendría que encontrar el intento anterior; guardándola en el
 * navegador, la misma clave vuelve y el servidor devuelve la venta que ya existe en
 * lugar de crear otra (S5).
 *
 * El modo replay es un **estado del panel**, no un turno más: cuando el presupuesto se
 * agota a mitad de la charla, la conversación se reemplaza por la corrida grabada. Un
 * turno del asistente ahí sería pasar una grabación por respuesta del día.
 */
export function Conversacion() {
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [borrador, setBorrador] = useState('')
  const [claveIdempotencia, setClaveIdempotencia] = useState<string | undefined>(undefined)
  const [presupuesto, setPresupuesto] = useState<Presupuesto | null>(null)
  const [grabado, setGrabado] = useState<ReplayGrabado | null>(null)
  const [avisoReplay, setAvisoReplay] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendiente, iniciar] = useTransition()

  function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    const texto = borrador.trim()
    if (!texto || pendiente) return

    // El historial se arma antes de agregar el turno nuevo: el servidor recibe los
    // turnos anteriores por separado del mensaje actual.
    const historial = turnos.map((turno) => ({ rol: turno.rol, texto: turno.texto }))
    setBorrador('')
    setError(null)
    setTurnos([...turnos, { rol: 'usuario', texto }])

    iniciar(async () => {
      const respuesta = await conversar({
        turnos: historial,
        mensaje: texto,
        ...(claveIdempotencia ? { claveIdempotencia } : {}),
      })

      if (respuesta.estado === 'error') {
        setError(respuesta.texto)
        return
      }

      setPresupuesto({ usadasHoy: respuesta.usadasHoy, topeDiario: respuesta.topeDiario })

      if (respuesta.estado === 'replay') {
        // El panel pasa a mostrar la grabación; si no hay grabación legible, el aviso se
        // muestra como aviso y no como si el asistente hubiera contestado.
        setAvisoReplay(respuesta.texto)
        if (respuesta.grabado) setGrabado(respuesta.grabado)
        return
      }

      setClaveIdempotencia(respuesta.claveIdempotencia)
      setTurnos((previos) => [
        ...previos,
        {
          rol: 'asistente',
          texto: respuesta.texto,
          ...(respuesta.llamadas.length > 0 ? { llamadas: respuesta.llamadas } : {}),
          ...(respuesta.topeAlcanzado ? { aviso: 'se alcanzó el tope de rondas' } : {}),
        },
      ])
    })
  }

  // El estado de replay no convive con la charla: reemplaza el panel entero.
  if (grabado) {
    return <Replay grabado={grabado} motivo={avisoReplay ?? undefined} />
  }

  return (
    <div className="space-y-4">
      <div className="min-h-[18rem] space-y-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
        {turnos.length === 0 ? (
          <p className="text-sm text-slate-500">
            Todavía no hay nada. Probá con «¿qué se vendió hoy?» o «vendé 2 azúcares en efectivo».
          </p>
        ) : null}

        {turnos.map((turno, indice) => (
          <div key={`${indice}-${turno.rol}`} className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              {turno.rol === 'usuario' ? 'Vos' : 'Asistente'}
            </p>

            <div
              className={
                turno.rol === 'usuario'
                  ? 'rounded-2xl border border-slate-700 bg-slate-800/60 px-4 py-2 text-sm'
                  : 'rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-2 text-sm'
              }
            >
              <p className="whitespace-pre-wrap text-slate-100">{turno.texto || '—'}</p>

              {turno.llamadas ? (
                <ul className="mt-2 space-y-1">
                  {turno.llamadas.map((llamada, posicion) => (
                    <li
                      key={`${indice}-${posicion}-${llamada.nombre}`}
                      className="flex flex-wrap items-baseline gap-2 text-xs tabular-nums"
                    >
                      <span
                        className={
                          llamada.estado === 'ok' ? 'text-emerald-400' : 'text-rose-400'
                        }
                      >
                        {llamada.estado === 'ok' ? '✓' : '✕'}
                      </span>
                      <span className="font-mono text-slate-400">{llamada.nombre}</span>
                      {llamada.detalle ? (
                        <span className="text-rose-300">{llamada.detalle}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}

              {turno.aviso ? (
                <p className="mt-2 text-xs text-amber-400">{turno.aviso}</p>
              ) : null}
            </div>
          </div>
        ))}

        {pendiente ? <p className="text-sm text-slate-400">Pensando…</p> : null}
      </div>

      {avisoReplay ? (
        <p className="rounded-xl border border-amber-900 bg-amber-950/30 px-4 py-2 text-sm text-amber-200">
          {avisoReplay}
        </p>
      ) : null}

      {error ? (
        <p className="rounded-xl border border-rose-900 bg-rose-950/40 px-4 py-2 text-sm text-rose-200">
          {error}
        </p>
      ) : null}

      <form onSubmit={enviar} className="space-y-2">
        <label htmlFor="pedido" className="text-sm text-slate-400">
          Pedido
        </label>
        <textarea
          id="pedido"
          name="pedido"
          rows={3}
          value={borrador}
          onChange={(evento) => setBorrador(evento.target.value)}
          disabled={pendiente}
          placeholder="vendé 2 azúcares en efectivo"
          className="w-full rounded-2xl border border-slate-800 bg-slate-950 px-4 py-2 text-sm text-slate-100 outline-none focus:border-slate-600 disabled:opacity-60"
        />
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-slate-500 tabular-nums">
            {presupuesto
              ? `Modelo: ${presupuesto.usadasHoy}/${presupuesto.topeDiario} llamadas hoy`
              : 'Tope diario de llamadas al modelo por diseño'}
          </p>
          <button
            type="submit"
            disabled={pendiente}
            className="rounded-lg border border-slate-700 px-4 py-1.5 text-sm text-slate-200 transition hover:border-slate-500 hover:text-white disabled:opacity-50"
          >
            Enviar
          </button>
        </div>
      </form>
    </div>
  )
}
