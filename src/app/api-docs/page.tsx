import Link from 'next/link'
import { PATHS_DOCUMENTADOS } from '@/server/api/openapi'

// Los títulos técnicos de esta pantalla viven en inglés; el texto que explica qué
// hace cada endpoint está en español, como el resto de la aplicación.

export const metadata = { title: 'API · caja-inventario' }

const SCOPES = [
  'productos:read',
  'productos:write',
  'ventas:read',
  'ventas:write',
  'reportes:read',
]

export default function PaginaApiDocs() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-widest text-slate-500">caja-inventario</p>
        <h1 className="text-2xl font-semibold">API pública v1</h1>
        <p className="text-sm text-slate-400">
          Todas las rutas viven bajo <code className="text-slate-300">/api/v1</code> y se
          autentican con <code className="text-slate-300">Authorization: Bearer &lt;token&gt;</code>,
          independiente de la cookie del panel. El dinero se expresa siempre en centavos
          enteros.
        </p>
        <p className="text-sm text-slate-400">
          El contrato completo está en{' '}
          <Link href="/api/v1/openapi.json" className="text-sky-400 underline">
            /api/v1/openapi.json
          </Link>
          , generado desde los mismos esquemas que validan los pedidos.
        </p>
      </header>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Scopes</h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {SCOPES.map((scope) => (
            <li
              key={scope}
              className="rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1 font-mono text-xs text-slate-300"
            >
              {scope}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-slate-500">
          Un token sin el scope necesario recibe 403 y no ejecuta nada. Un token vencido o
          revocado recibe 401: ya no es una identidad.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Endpoints
        </h2>
        <ul className="mt-3 divide-y divide-slate-800 rounded-2xl border border-slate-800">
          {PATHS_DOCUMENTADOS.map((endpoint) => (
            <li
              key={`${endpoint.method}-${endpoint.path}`}
              className="flex flex-wrap items-center gap-3 px-4 py-3"
            >
              <span className="w-14 shrink-0 rounded bg-slate-800 px-2 py-0.5 text-center font-mono text-xs uppercase text-slate-300">
                {endpoint.method}
              </span>
              <code className="font-mono text-sm text-slate-200">{endpoint.path}</code>
              <span className="ml-auto font-mono text-xs text-slate-500">{endpoint.scope}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10 rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <h2 className="text-sm font-semibold text-slate-300">Cómo se emite un token</h2>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-950 p-4 text-xs text-slate-300">
          <code>{`npm run token:emitir -- \\
  --email=admin@caja.local \\
  --nombre=asistente \\
  --scopes=productos:read,ventas:read,reportes:read`}</code>
        </pre>
        <p className="mt-3 text-sm text-slate-500">
          El valor en claro se muestra una sola vez. En la base queda sólo su SHA-256, así
          que si se pierde se revoca y se emite otro.
        </p>
      </section>

      <footer className="mt-10 text-sm text-slate-500">
        <Link href="/login" className="text-sky-400 underline">
          Volver al panel
        </Link>
      </footer>
    </main>
  )
}
