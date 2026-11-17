import { redirect } from 'next/navigation'
import { usuarioActual } from '@/server/sesion'
import { FormularioLogin } from './FormularioLogin'

// Lee cookies() para no mostrar el formulario a quien ya tiene sesión, así que es
// bloqueante igual que el panel.
export const instant = false

export default async function PaginaLogin() {
  // Si ya hay sesión, no tiene sentido mostrar el formulario.
  if (await usuarioActual()) redirect('/productos')

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-slate-100">Caja e inventario</h1>
          <p className="mt-1 text-sm text-slate-400">Ingresá para operar la caja del día.</p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <FormularioLogin />
        </div>
      </div>
    </main>
  )
}
