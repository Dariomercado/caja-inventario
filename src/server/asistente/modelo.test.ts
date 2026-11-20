import { describe, expect, it } from 'vitest'
import { ErrorDelModelo, crearClienteModelo } from './modelo'
import type { DefinicionHerramienta } from './herramientas'

const HERRAMIENTA: DefinicionHerramienta = {
  type: 'function',
  function: { name: 'listar_productos', description: 'Lista el catálogo.', parameters: { type: 'object' } },
}

function preparar(respuestas: Response[]) {
  const cuerpos: Record<string, unknown>[] = []

  const cliente = crearClienteModelo({
    baseUrl: 'https://api.z.ai/api/paas/v4/',
    apiKey: 'clave-de-prueba',
    nombre: 'glm-5.3-flash',
    temperatura: 0.2,
    transporte: async (peticion) => {
      cuerpos.push(JSON.parse(await peticion.clone().text()) as Record<string, unknown>)
      const respuesta = respuestas.shift()
      if (!respuesta) throw new Error('el test no preparó suficientes respuestas')
      return respuesta
    },
  })

  return { cliente, cuerpos }
}

function json(cuerpo: unknown, estado = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'content-type': 'application/json' },
  })
}

describe('cliente del modelo', () => {
  it('manda el formato de OpenAI con las herramientas y tool_choice auto', async () => {
    const { cliente, cuerpos } = preparar([
      json({ choices: [{ message: { role: 'assistant', content: 'hola' } }] }),
    ])

    await cliente.completar({
      mensajes: [{ role: 'user', content: 'qué hay en stock' }],
      herramientas: [HERRAMIENTA],
    })

    expect(cuerpos[0]).toMatchObject({
      model: 'glm-5.3-flash',
      temperature: 0.2,
      stream: false,
      messages: [{ role: 'user', content: 'qué hay en stock' }],
      tools: [HERRAMIENTA],
      tool_choice: 'auto',
    })
  })

  it('sin herramientas no manda ni tools ni tool_choice', async () => {
    const { cliente, cuerpos } = preparar([
      json({ choices: [{ message: { role: 'assistant', content: 'hola' } }] }),
    ])

    await cliente.completar({ mensajes: [{ role: 'user', content: 'hola' }] })

    expect(cuerpos[0]).not.toHaveProperty('tools')
    expect(cuerpos[0]).not.toHaveProperty('tool_choice')
  })

  it('devuelve el mensaje del proveedor intacto y traduce el uso', async () => {
    const mensaje = {
      role: 'assistant',
      content: null,
      reasoning_content: 'pensando',
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'listar_productos', arguments: '{}' } }],
    }
    const { cliente } = preparar([json({ choices: [{ message: mensaje }], usage: { prompt_tokens: 120, completion_tokens: 30 } })])

    const { mensaje: recibido, uso } = await cliente.completar({
      mensajes: [{ role: 'user', content: 'hola' }],
    })

    expect(recibido).toEqual(mensaje)
    expect(uso).toEqual({ entrada: 120, salida: 30 })
  })

  it('un error del proveedor se propaga con su estado y su detalle', async () => {
    const { cliente } = preparar([json({ error: { message: 'model not found' } }, 400)])

    await expect(cliente.completar({ mensajes: [{ role: 'user', content: 'hola' }] })).rejects.toMatchObject({
      name: 'ErrorDelModelo',
      estado: 400,
    })

    try {
      await crearClienteModelo({
        baseUrl: 'https://api.z.ai/api/paas/v4/',
        apiKey: 'k',
        nombre: 'x',
        temperatura: 0,
        transporte: async () => json({ error: { message: 'model not found' } }, 400),
      }).completar({ mensajes: [{ role: 'user', content: 'hola' }] })
    } catch (error) {
      expect((error as ErrorDelModelo).message).toContain('model not found')
    }
  })

  it('una respuesta sin mensaje no se toma como turno vacío', async () => {
    const { cliente } = preparar([json({ choices: [] })])

    await expect(cliente.completar({ mensajes: [{ role: 'user', content: 'hola' }] })).rejects.toBeInstanceOf(
      ErrorDelModelo,
    )
  })
})
