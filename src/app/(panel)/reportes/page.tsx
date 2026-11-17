import { cajaDelDia, resumenPorDia, topProductos } from '@/server/reportes'
import { formatearCentavos } from '@/lib/dinero'

// "Hoy" es el día local de Argentina. Usar la fecha UTC haría que la caja del día
// cambie de contenido a las 21:00, cuando en UTC ya es mañana.
function hoyLocal(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date())
}

function restarDias(fecha: string, dias: number): string {
  // Mediodía UTC: lejos de los bordes del día, así el desplazamiento no salta.
  const base = new Date(`${fecha}T12:00:00Z`)
  base.setUTCDate(base.getUTCDate() - dias)
  return base.toISOString().slice(0, 10)
}

export default async function PaginaReportes({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string }>
}) {
  const parametros = await searchParams
  const hoy = hoyLocal()

  const hasta = parametros.hasta ?? hoy
  const desde = parametros.desde ?? restarDias(hasta, 6)

  const [resumen, top, caja] = await Promise.all([
    resumenPorDia({ desde, hasta }),
    topProductos({ desde, hasta, limite: 5 }),
    cajaDelDia({ fecha: hasta }),
  ])

  const totalPeriodo = resumen.reduce((suma, dia) => suma + dia.totalCentavos, 0)
  const ventasPeriodo = resumen.reduce((suma, dia) => suma + dia.cantidadVentas, 0)

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Reportes</h1>
          <p className="mt-1 text-sm text-slate-400">
            {ventasPeriodo} ventas · {formatearCentavos(totalPeriodo)} en el período
          </p>
        </div>

        <form className="flex flex-wrap items-end gap-2" method="get">
          <label className="text-sm text-slate-400">
            <span className="mb-1 block">Desde</span>
            <input
              type="date"
              name="desde"
              defaultValue={desde}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm"
            />
          </label>
          <label className="text-sm text-slate-400">
            <span className="mb-1 block">Hasta</span>
            <input
              type="date"
              name="hasta"
              defaultValue={hasta}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm"
            />
          </label>
          <button
            type="submit"
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white"
          >
            Ver
          </button>
        </form>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
          Ventas por día
        </h2>
        <div className="overflow-hidden rounded-2xl border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900/60 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">Día</th>
                <th className="px-4 py-3 text-right font-medium">Ventas</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {resumen.map((dia) => (
                <tr key={dia.fecha} className={dia.cantidadVentas === 0 ? 'text-slate-500' : ''}>
                  <td className="px-4 py-2.5 tabular-nums">{dia.fecha}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{dia.cantidadVentas}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {formatearCentavos(dia.totalCentavos)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-8 md:grid-cols-2">
        <section className="space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
            Top productos
          </h2>
          {top.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-800 px-4 py-6 text-center text-sm text-slate-500">
              Sin ventas en el período.
            </p>
          ) : (
            <ol className="divide-y divide-slate-800 rounded-2xl border border-slate-800">
              {top.map((producto, indice) => (
                <li key={producto.productoId} className="flex items-center gap-3 px-4 py-3">
                  <span className="w-5 text-sm tabular-nums text-slate-500">{indice + 1}</span>
                  <span className="flex-1 text-sm">{producto.nombre}</span>
                  <span className="text-sm tabular-nums text-slate-400">
                    {producto.cantidadVendida} u.
                  </span>
                  <span className="w-28 text-right text-sm tabular-nums">
                    {formatearCentavos(producto.totalCentavos)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
            Caja del {caja.fecha}
          </h2>
          {caja.medios.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-800 px-4 py-6 text-center text-sm text-slate-500">
              No hubo movimientos ese día.
            </p>
          ) : (
            <div className="divide-y divide-slate-800 rounded-2xl border border-slate-800">
              {caja.medios.map((medio) => (
                <div key={medio.medio} className="flex items-center gap-3 px-4 py-3">
                  <span className="flex-1 text-sm capitalize">{medio.medio.toLowerCase()}</span>
                  <span className="text-sm tabular-nums text-slate-400">
                    {medio.cantidadPagos} pago{medio.cantidadPagos === 1 ? '' : 's'}
                  </span>
                  <span className="w-28 text-right text-sm tabular-nums">
                    {formatearCentavos(medio.totalCentavos)}
                  </span>
                </div>
              ))}
              <div className="flex items-center gap-3 bg-slate-900/40 px-4 py-3">
                <span className="flex-1 text-sm font-medium">Total del día</span>
                <span className="w-28 text-right text-sm font-semibold tabular-nums">
                  {formatearCentavos(caja.granTotalCentavos)}
                </span>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
