import Link from 'next/link'
import { requerirUsuario } from '@/server/sesion'
import { accionCerrarSesion } from '../actions/auth'

const NAVEGACION = [
  { href: '/productos', etiqueta: 'Productos' },
  { href: '/ventas/nueva', etiqueta: 'Registrar venta' },
  { href: '/reportes', etiqueta: 'Reportes' },
  { href: '/asistente', etiqueta: 'Asistente' },
]

// Con cacheComponents activo, una ruta que lee cookies() queda bloqueada en el
// prerender. Esto es una aplicación autenticada: cada request necesita la sesión,
// así que la ruta es bloqueante por diseño y no por descuido.
export const instant = false

export default async function LayoutPanel({ children }: { children: React.ReactNode }) {
  // Un solo guard para todo el grupo: si no hay sesión, redirect('/login') corta
  // acá y ninguna pantalla de abajo llega a ejecutarse.
  const usuario = await requerirUsuario()

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/50">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-6 py-4">
          <span className="font-semibold tracking-tight">Caja</span>

          <nav className="flex flex-1 flex-wrap gap-1">
            {NAVEGACION.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-1.5 text-sm text-slate-300 transition hover:bg-slate-800 hover:text-white"
              >
                {item.etiqueta}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-400">{usuario.nombre}</span>
            <form action={accionCerrarSesion}>
              <button
                type="submit"
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white"
              >
                Salir
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  )
}
