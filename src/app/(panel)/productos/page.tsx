import { prisma } from '@/lib/db'
import { formatearCentavos } from '@/lib/dinero'

// El stock cambia con cada venta y la ruta ya es dinámica porque el layout llama a
// cookies() en el guard de sesión.

const UMBRAL_STOCK_BAJO = 5

export default async function PaginaProductos() {
  const productos = await prisma.producto.findMany({
    where: { activo: true },
    orderBy: { nombre: 'asc' },
  })

  const stockBajo = productos.filter((p) => p.stock <= UMBRAL_STOCK_BAJO)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Productos</h1>
          <p className="mt-1 text-sm text-slate-400">
            {productos.length} activos
            {stockBajo.length > 0 ? ` · ${stockBajo.length} con stock bajo` : ''}
          </p>
        </div>
      </div>

      {productos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 p-10 text-center">
          <p className="text-slate-300">Todavía no hay productos cargados.</p>
          <p className="mt-1 text-sm text-slate-500">
            Cargá el catálogo de demo con <code className="text-slate-400">npm run db:seed</code>.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900/60 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">SKU</th>
                <th className="px-4 py-3 font-medium">Producto</th>
                <th className="px-4 py-3 text-right font-medium">Precio</th>
                <th className="px-4 py-3 text-right font-medium">Stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {productos.map((producto) => {
                const bajo = producto.stock <= UMBRAL_STOCK_BAJO
                return (
                  <tr key={producto.id} className="bg-slate-900/20">
                    <td className="px-4 py-3 font-mono text-xs text-slate-400">{producto.sku}</td>
                    <td className="px-4 py-3">{producto.nombre}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatearCentavos(producto.precioCentavos)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={`inline-flex min-w-10 justify-center rounded-full px-2 py-0.5 tabular-nums ${
                          bajo
                            ? 'bg-amber-500/15 text-amber-300'
                            : 'bg-emerald-500/15 text-emerald-300'
                        }`}
                      >
                        {producto.stock}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
