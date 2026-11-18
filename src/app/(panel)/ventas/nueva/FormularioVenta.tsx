'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { formatearCentavos } from '@/lib/dinero'
import { accionRegistrarVenta } from '@/app/actions/ventas'

type Producto = {
  id: string
  nombre: string
  precioCentavos: number
  stock: number
}

type Linea = { productoId: string; cantidad: number }

const MEDIOS = [
  { valor: 'EFECTIVO', etiqueta: 'Efectivo' },
  { valor: 'TRANSFERENCIA', etiqueta: 'Transferencia' },
  { valor: 'TARJETA', etiqueta: 'Tarjeta' },
] as const

export function FormularioVenta({ productos }: { productos: Producto[] }) {
  const router = useRouter()
  const [lineas, setLineas] = useState<Linea[]>([])
  const [medioPago, setMedioPago] = useState<(typeof MEDIOS)[number]['valor']>('EFECTIVO')
  const [error, setError] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  // Una clave por intento de venta. Se sortea al montar el formulario y se renueva
  // solo después de una venta exitosa: si un envío falla, reintentar con la misma
  // clave es seguro, porque el servidor no llegó a registrar nada.
  const [claveIdempotencia, setClaveIdempotencia] = useState(() => crypto.randomUUID())

  const porId = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos])

  // El total que se muestra es informativo. El que vale lo calcula el servidor
  // leyendo los precios dentro de la transacción.
  const totalEstimado = lineas.reduce((suma, linea) => {
    const producto = porId.get(linea.productoId)
    return suma + (producto ? producto.precioCentavos * linea.cantidad : 0)
  }, 0)

  function agregarLinea() {
    const libre = productos.find((p) => !lineas.some((l) => l.productoId === p.id))
    if (!libre) return
    setLineas([...lineas, { productoId: libre.id, cantidad: 1 }])
    setExito(null)
  }

  function cambiarProducto(indice: number, productoId: string) {
    setLineas(lineas.map((linea, i) => (i === indice ? { ...linea, productoId } : linea)))
  }

  function cambiarCantidad(indice: number, cantidad: number) {
    setLineas(
      lineas.map((linea, i) =>
        i === indice ? { ...linea, cantidad: Math.max(1, cantidad || 1) } : linea,
      ),
    )
  }

  function quitarLinea(indice: number) {
    setLineas(lineas.filter((_, i) => i !== indice))
  }

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault()
    setError(null)
    setExito(null)

    if (lineas.length === 0) {
      setError('Agregá al menos un producto.')
      return
    }

    setEnviando(true)
    try {
      const resultado = await accionRegistrarVenta({
        items: lineas,
        medioPago,
        claveIdempotencia,
      })

      if (!resultado.ok) {
        setError(resultado.error)
        return
      }

      setExito(
        `Venta #${resultado.numero} registrada por ${formatearCentavos(resultado.totalCentavos)}.`,
      )
      // Venta cerrada: la próxima venta es otro intento y necesita otra clave.
      setClaveIdempotencia(crypto.randomUUID())
      setLineas([])
      router.refresh()
    } catch {
      setError('No se pudo registrar la venta.')
    } finally {
      setEnviando(false)
    }
  }

  const disponibles = productos.filter((p) => p.stock > 0)

  if (disponibles.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-800 p-10 text-center">
        <p className="text-slate-300">No hay productos con stock disponible.</p>
      </div>
    )
  }

  return (
    <form onSubmit={enviar} className="space-y-5">
      <div className="space-y-3">
        {lineas.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-800 px-4 py-6 text-center text-sm text-slate-500">
            Todavía no agregaste productos.
          </p>
        ) : null}

        {lineas.map((linea, indice) => {
          const producto = porId.get(linea.productoId)
          return (
            <div
              key={indice}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-3"
            >
              <select
                value={linea.productoId}
                onChange={(e) => cambiarProducto(indice, e.target.value)}
                className="min-w-48 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              >
                {productos.map((opcion) => (
                  <option key={opcion.id} value={opcion.id} disabled={opcion.stock === 0}>
                    {opcion.nombre} · {formatearCentavos(opcion.precioCentavos)} · stock{' '}
                    {opcion.stock}
                  </option>
                ))}
              </select>

              <input
                type="number"
                min={1}
                max={producto?.stock ?? 1}
                value={linea.cantidad}
                onChange={(e) => cambiarCantidad(indice, Number(e.target.value))}
                className="w-20 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm tabular-nums"
                aria-label="Cantidad"
              />

              <span className="w-28 text-right text-sm tabular-nums text-slate-300">
                {producto ? formatearCentavos(producto.precioCentavos * linea.cantidad) : '—'}
              </span>

              <button
                type="button"
                onClick={() => quitarLinea(indice)}
                className="rounded-lg px-2 py-1 text-sm text-slate-500 transition hover:text-red-400"
              >
                Quitar
              </button>
            </div>
          )
        })}

        <button
          type="button"
          onClick={agregarLinea}
          disabled={lineas.length >= productos.length}
          className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white disabled:opacity-40"
        >
          + Agregar producto
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="flex items-center gap-3">
          <label htmlFor="medio" className="text-sm text-slate-400">
            Medio de pago
          </label>
          <select
            id="medio"
            value={medioPago}
            onChange={(e) => setMedioPago(e.target.value as typeof medioPago)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
          >
            {MEDIOS.map((medio) => (
              <option key={medio.valor} value={medio.valor}>
                {medio.etiqueta}
              </option>
            ))}
          </select>
        </div>

        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-slate-500">Total</p>
          <p className="text-2xl font-semibold tabular-nums">
            {formatearCentavos(totalEstimado)}
          </p>
        </div>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg bg-red-950 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      {exito ? (
        <p role="status" className="rounded-lg bg-emerald-950 px-3 py-2 text-sm text-emerald-300">
          {exito}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={enviando || lineas.length === 0}
        className="w-full rounded-xl bg-emerald-600 px-4 py-3 font-medium text-white transition hover:bg-emerald-500 disabled:opacity-40"
      >
        {enviando ? 'Registrando…' : 'Registrar venta'}
      </button>
    </form>
  )
}
