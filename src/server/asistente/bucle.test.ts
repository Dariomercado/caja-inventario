import { describe, expect, it } from 'vitest'
import { ejecutarTurno } from './bucle'
import type { ContextoHerramienta, DefinicionHerramienta, ResultadoHerramienta } from './herramientas'
import type { Mensaje, MensajeAsistente } from './modelo'

const DEFINICION: DefinicionHerramienta = {
  type: 'function',
  function: { name: 'registrar_venta', description: 'Registra una venta.', parameters: { type: 'object' } },
}

function pedirHerramienta(id: string, argumentos = '{"items":[]}'): MensajeAsistente {
  return {
    role: 'assistant',
    content: null,
    tool_calls: [{ id, type: 'function', function: { name: 'registrar_venta', arguments: argumentos } }],
  }
}

function responderTexto(texto: string, extra: Record<string, unknown> = {}): MensajeAsistente {
  return { role: 'assistant', content: texto, ...extra }
}

function modeloFalso(respuestas: MensajeAsistente[]) {
  const peticiones: { mensajes: Mensaje[]; herramientas?: DefinicionHerramienta[] }[] = []

  return {
    peticiones,
    modelo: {
      async completar(entrada: { mensajes: Mensaje[]; herramientas?: DefinicionHerramienta[] }) {
        // Copia del array: el loop sigue mutando el original y sin esto todas las
        // peticiones registrarían el estado final del turno.
        peticiones.push({ mensajes: [...entrada.mensajes], herramientas: entrada.herramientas })
        const mensaje = respuestas.shift()
        if (!mensaje) throw new Error('el test no preparó suficientes respuestas del modelo')
        return { mensaje, uso: { entrada: 10, salida: 5 } }
      },
    },
  }
}

function herramientasFalsas(resultados: ResultadoHerramienta[] = []) {
  const ejecutadas: { nombre: string; argumentos: unknown; contexto: ContextoHerramienta }[] = []

  return {
    ejecutadas,
    herramientas: {
      definiciones: [DEFINICION],
      async ejecutar(nombre: string, argumentos: unknown, contexto: ContextoHerramienta) {
        ejecutadas.push({ nombre, argumentos, contexto })
        return resultados.shift() ?? { ok: true, datos: { ok: true } }
      },
    },
  }
}

const BASE = [{ role: 'user' as const, content: 'vendé 2 azúcares' }]

describe('loop de herramientas', () => {
  it('corta en el tope de rondas, deja de ofrecer herramientas y lo informa', async () => {
    const { modelo, peticiones } = modeloFalso([
      pedirHerramienta('c1'),
      pedirHerramienta('c2'),
      responderTexto('no llegué a terminar'),
    ])
    const { herramientas, ejecutadas } = herramientasFalsas()

    const resultado = await ejecutarTurno({
      modelo,
      herramientas,
      mensajes: BASE,
      maxRondas: 2,
      claveIdempotencia: 'clave-inicial',
    })

    expect(ejecutadas).toHaveLength(2)
    expect(peticiones).toHaveLength(3)
    expect(peticiones[0]?.herramientas).toEqual([DEFINICION])
    expect(peticiones[2]?.herramientas).toBeUndefined()
    expect(resultado.topeAlcanzado).toBe(true)
    expect(resultado.texto).toBe('no llegué a terminar')
    expect(resultado.uso).toEqual({ entrada: 30, salida: 15 })
  })

  it('no ejecuta herramientas pedidas después del tope', async () => {
    const { modelo } = modeloFalso([
      pedirHerramienta('c1'),
      // Con las herramientas retiradas, un modelo que igual pide una no la ejecuta.
      pedirHerramienta('c2'),
    ])
    const { herramientas, ejecutadas } = herramientasFalsas()

    const resultado = await ejecutarTurno({
      modelo,
      herramientas,
      mensajes: BASE,
      maxRondas: 1,
      claveIdempotencia: 'clave-inicial',
    })

    expect(ejecutadas).toHaveLength(1)
    expect(resultado.topeAlcanzado).toBe(true)
  })

  it('devuelve el mensaje del proveedor sin recortar, razonamiento incluido', async () => {
    const conRazonamiento: MensajeAsistente = {
      ...pedirHerramienta('c1'),
      reasoning_content: 'el usuario nombró un producto concreto',
    }
    const { modelo, peticiones } = modeloFalso([conRazonamiento, responderTexto('listo')])
    const { herramientas } = herramientasFalsas()

    await ejecutarTurno({
      modelo,
      herramientas,
      mensajes: BASE,
      maxRondas: 4,
      claveIdempotencia: 'clave-inicial',
    })

    const devuelto = peticiones[1]?.mensajes.find((mensaje) => mensaje.role === 'assistant')
    expect(devuelto).toEqual(conRazonamiento)
  })

  it('mantiene la clave del intento mientras no se registre una venta', async () => {
    const { modelo } = modeloFalso([
      pedirHerramienta('c1'),
      pedirHerramienta('c2'),
      responderTexto('listo'),
    ])
    const { herramientas, ejecutadas } = herramientasFalsas([
      { ok: false, error: { code: 'stock_insuficiente', message: 'quedan 3' } },
      { ok: true, datos: { id: 'v1', creada: false }, ventaRegistrada: false },
    ])

    const resultado = await ejecutarTurno({
      modelo,
      herramientas,
      mensajes: BASE,
      maxRondas: 4,
      claveIdempotencia: 'clave-inicial',
    })

    expect(ejecutadas.map((llamada) => llamada.contexto.claveIdempotencia)).toEqual([
      'clave-inicial',
      'clave-inicial',
    ])
    expect(resultado.claveIdempotencia).toBe('clave-inicial')
  })

  it('renueva la clave recién cuando una venta quedó registrada', async () => {
    const { modelo } = modeloFalso([
      pedirHerramienta('c1'),
      pedirHerramienta('c2'),
      responderTexto('listo'),
    ])
    const { herramientas, ejecutadas } = herramientasFalsas([
      { ok: true, datos: { id: 'v1', numero: 7 }, ventaRegistrada: true },
      { ok: true, datos: { id: 'v2', numero: 8 }, ventaRegistrada: true },
    ])

    const resultado = await ejecutarTurno({
      modelo,
      herramientas,
      mensajes: BASE,
      maxRondas: 4,
      claveIdempotencia: 'clave-inicial',
    })

    const [primera, segunda] = ejecutadas.map((llamada) => llamada.contexto.claveIdempotencia)
    expect(primera).toBe('clave-inicial')
    expect(segunda).not.toBe('clave-inicial')
    expect(segunda).toMatch(/^[0-9a-f-]{36}$/)
    // Dos ventas registradas son dos renovaciones: la clave que vuelve no es ninguna
    // de las que ya usó una venta exitosa.
    expect(resultado.claveIdempotencia).not.toBe(segunda)
    expect(resultado.claveIdempotencia).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('genera una clave si el pedido no trae ninguna', async () => {
    const { modelo } = modeloFalso([responderTexto('hola')])
    const { herramientas } = herramientasFalsas()

    const resultado = await ejecutarTurno({ modelo, herramientas, mensajes: BASE, maxRondas: 4 })

    expect(resultado.claveIdempotencia).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('le devuelve al modelo el error de la herramienta y sigue el turno', async () => {
    const { modelo, peticiones } = modeloFalso([pedirHerramienta('c1'), responderTexto('no hay stock')])
    const { herramientas } = herramientasFalsas([
      { ok: false, error: { code: 'stock_insuficiente', message: 'quedan 3' } },
    ])

    const resultado = await ejecutarTurno({
      modelo,
      herramientas,
      mensajes: BASE,
      maxRondas: 4,
      claveIdempotencia: 'clave-inicial',
    })

    const respuestaDeHerramienta = peticiones[1]?.mensajes.at(-1)
    expect(respuestaDeHerramienta).toEqual({
      role: 'tool',
      tool_call_id: 'c1',
      content: '{"error":{"code":"stock_insuficiente","message":"quedan 3"}}',
    })
    expect(resultado.texto).toBe('no hay stock')
  })

  it('si los argumentos no son JSON válido, la herramienta los recibe vacíos y decide', async () => {
    const { modelo } = modeloFalso([pedirHerramienta('c1', 'no es json'), responderTexto('listo')])
    const { herramientas, ejecutadas } = herramientasFalsas()

    await ejecutarTurno({
      modelo,
      herramientas,
      mensajes: BASE,
      maxRondas: 4,
      claveIdempotencia: 'clave-inicial',
    })

    expect(ejecutadas[0]?.argumentos).toBeUndefined()
  })

  it('con el presupuesto diario agotado no llega a llamar al modelo', async () => {
    const { modelo, peticiones } = modeloFalso([responderTexto('listo')])
    const { herramientas } = herramientasFalsas()

    await expect(
      ejecutarTurno({
        modelo,
        herramientas,
        mensajes: BASE,
        maxRondas: 4,
        reservarLlamada: async () => {
          throw new Error('sin presupuesto')
        },
      }),
    ).rejects.toThrow('sin presupuesto')

    expect(peticiones).toHaveLength(0)
  })

  it('reserva una llamada por cada llamada real al modelo', async () => {
    const { modelo } = modeloFalso([pedirHerramienta('c1'), responderTexto('listo')])
    const { herramientas } = herramientasFalsas()
    let reservadas = 0

    await ejecutarTurno({
      modelo,
      herramientas,
      mensajes: BASE,
      maxRondas: 4,
      reservarLlamada: async () => {
        reservadas += 1
      },
    })

    expect(reservadas).toBe(2)
  })

  it('ejecuta todas las herramientas de una misma respuesta', async () => {
    const dosEnUna: MensajeAsistente = {
      role: 'assistant',
      content: null,
      tool_calls: [
        { id: 'c1', type: 'function', function: { name: 'registrar_venta', arguments: '{}' } },
        { id: 'c2', type: 'function', function: { name: 'registrar_venta', arguments: '{}' } },
      ],
    }
    const { modelo, peticiones } = modeloFalso([dosEnUna, responderTexto('listo')])
    const { herramientas, ejecutadas } = herramientasFalsas()

    await ejecutarTurno({
      modelo,
      herramientas,
      mensajes: BASE,
      maxRondas: 4,
      claveIdempotencia: 'clave-inicial',
    })

    expect(ejecutadas).toHaveLength(2)
    const ids = peticiones[1]?.mensajes
      .filter((mensaje) => mensaje.role === 'tool')
      .map((mensaje) => (mensaje as { tool_call_id: string }).tool_call_id)
    expect(ids).toEqual(['c1', 'c2'])
  })
})
