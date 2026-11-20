import { Conversacion } from './Conversacion'

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

      <Conversacion />
    </div>
  )
}
