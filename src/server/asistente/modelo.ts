import type { DefinicionHerramienta } from './herramientas'

/**
 * Cliente del modelo conversacional.
 *
 * Habla el protocolo de chat completions compatible con OpenAI, que es el que
 * expone GLM (L7): `tools` con JSON Schema, `tool_calls` en el mensaje del
 * asistente y respuestas con `role: "tool"` y `tool_call_id`.
 *
 * El transporte es inyectable por la misma razón que en `api.ts`: el nivel offline
 * de las evals reemplaza la red por fixtures grabados y así el resto del loop corre
 * igual de real (S8).
 */

export type Uso = { entrada: number; salida: number }

export const USO_CERO: Uso = { entrada: 0, salida: 0 }

export function sumarUso(a: Uso, b: Uso): Uso {
  return { entrada: a.entrada + b.entrada, salida: a.salida + b.salida }
}

export type LlamadaHerramienta = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/**
 * Mensaje del asistente tal como lo devolvió el proveedor.
 *
 * Se guarda completo y sin recortar a propósito: `glm-5.3` razona siempre y hay que
 * devolverle el mensaje —incluido `reasoning_content`— en el turno siguiente del
 * loop, o pierde el hilo (L7). Por eso hay índice abierto: cualquier campo extra
 * del proveedor viaja de vuelta en lugar de descartarse.
 */
export type MensajeAsistente = {
  role: 'assistant'
  content: string | null
  tool_calls?: LlamadaHerramienta[]
  reasoning_content?: string
  [extra: string]: unknown
}

export type Mensaje =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | MensajeAsistente
  | { role: 'tool'; tool_call_id: string; content: string }

export type RespuestaModelo = {
  mensaje: MensajeAsistente
  uso: Uso
}

export type ClienteModelo = {
  completar(entrada: {
    mensajes: Mensaje[]
    herramientas?: DefinicionHerramienta[]
  }): Promise<RespuestaModelo>
}

export class ErrorDelModelo extends Error {
  constructor(readonly estado: number, mensaje: string) {
    super(mensaje)
    this.name = 'ErrorDelModelo'
  }
}

export function crearClienteModelo(config: {
  baseUrl: string
  apiKey: string
  nombre: string
  temperatura: number
  tiempoMaximoMs?: number
  transporte?: (peticion: Request) => Promise<Response>
}): ClienteModelo {
  const transporte = config.transporte ?? ((peticion: Request) => fetch(peticion))
  const tiempoMaximoMs = config.tiempoMaximoMs ?? 60_000
  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`

  return {
    async completar({ mensajes, herramientas }) {
      const cuerpo: Record<string, unknown> = {
        model: config.nombre,
        messages: mensajes,
        temperature: config.temperatura,
        stream: false,
      }

      if (herramientas && herramientas.length > 0) {
        cuerpo.tools = herramientas
        // La documentación de GLM sólo admite `auto` (L7); se manda explícito para
        // que el proveedor no cambie el valor por defecto sin que nos enteremos.
        cuerpo.tool_choice = 'auto'
      }

      const peticion = new Request(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(tiempoMaximoMs),
      })

      let respuesta: Response
      try {
        respuesta = await transporte(peticion)
      } catch (causa) {
        throw new ErrorDelModelo(
          0,
          `No se pudo llamar al modelo: ${causa instanceof Error ? causa.message : 'error de red'}`,
        )
      }

      if (!respuesta.ok) {
        // El cuerpo del error puede traer la causa real (modelo inexistente, cuota,
        // clave inválida) y sin él un 400 del proveedor es indepurable. La clave
        // nunca está en el cuerpo, así que se puede mostrar.
        const detalle = await respuesta.text().catch(() => '')
        throw new ErrorDelModelo(
          respuesta.status,
          `El modelo devolvió ${respuesta.status}${detalle ? `: ${detalle.slice(0, 300)}` : ''}`,
        )
      }

      const datos = (await respuesta.json()) as {
        choices?: { message?: MensajeAsistente }[]
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }

      const mensaje = datos.choices?.[0]?.message
      if (!mensaje) throw new ErrorDelModelo(200, 'El modelo no devolvió ningún mensaje.')

      return {
        mensaje: { ...mensaje, role: 'assistant' },
        uso: {
          entrada: datos.usage?.prompt_tokens ?? 0,
          salida: datos.usage?.completion_tokens ?? 0,
        },
      }
    },
  }
}
