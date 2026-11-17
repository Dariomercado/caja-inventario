import { prisma } from '@/lib/db'
import { FormularioVenta } from './FormularioVenta'

export default async function PaginaNuevaVenta() {
  const productos = await prisma.producto.findMany({
    where: { activo: true },
    orderBy: { nombre: 'asc' },
    select: { id: true, nombre: true, precioCentavos: true, stock: true },
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Registrar venta</h1>
        <p className="mt-1 text-sm text-slate-400">
          El stock se descuenta dentro de una transacción: si dos personas venden el último
          ítem a la vez, una de las dos ventas se rechaza en lugar de dejar stock negativo.
        </p>
      </div>

      <FormularioVenta productos={productos} />
    </div>
  )
}
