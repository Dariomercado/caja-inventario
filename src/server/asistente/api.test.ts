import { describe, expect, it } from 'vitest'
import { ErrorDeApi, ErrorDeRed, crearClienteApi } from './api'

type Capturada = {
  url: string
  metodo: string
  encabezados: Headers
  cuerpo: string | null
}

function preparar(respuestas: Response[]) {
  const capturadas: Capturada[] = []

  const transporte = async (peticion: Request) => {
    capturadas.push({
      url: peticion.url,
      metodo: peticion.method,
      encabezados: peticion.headers,
      cuerpo: peticion.method === 'GET' ? null : await peticion.clone().text(),
    })
    const respuesta = respuestas.shift()
    if (!respuesta) throw new Error('el test no preparó suficientes respuestas')
    return respuesta
  }

  const cliente = crearClienteApi({
    baseUrl: 'https://panel.example.com',
    token: 'cji_prueba',
    transporte,
  })

  return { cliente, capturadas }
}

function json(cuerpo: unknown, estado = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'content-type': 'application/json' },
  })
}

describe('cliente de /api/v1', () => {
  it('lista productos con el token del asistente y devuelve la página', async () => {
    const { cliente, capturadas } = preparar([
      json({ productos: [{ id: 'p1', nombre: 'Azúcar' }], siguienteCursor: 'p2' }),
    ])

    const pagina = await cliente.listarProductos({ limite: 20, soloActivos: true })

    expect(pagina.siguienteCursor).toBe('p2')
    expect(pagina.productos).toHaveLength(1)
    expect(capturadas[0]?.metodo).toBe('GET')
    expect(capturadas[0]?.url).toBe('https://panel.example.com/api/v1/productos?limite=20&soloActivos=true')
    expect(capturadas[0]?.encabezados.get('authorization')).toBe('Bearer cji_prueba')
  })

  it('registra una venta con Idempotency-Key y distingue la creada del reenvío', async () => {
    const { cliente, capturadas } = preparar([
      json({ id: 'v1', numero: 7, totalCentavos: 300_000 }, 201),
      json({ id: 'v1', numero: 7, totalCentavos: 300_000 }, 200),
    ])

    const entrada = {
      items: [{ productoId: 'p1', cantidad: 2 }],
      medioPago: 'EFECTIVO' as const,
    }

    const creada = await cliente.registrarVenta(entrada, 'clave-1')
    const reenviada = await cliente.registrarVenta(entrada, 'clave-1')

    expect(creada).toEqual({ id: 'v1', numero: 7, totalCentavos: 300_000, creada: true })
    expect(reenviada.creada).toBe(false)
    expect(capturadas[0]?.metodo).toBe('POST')
    expect(capturadas[0]?.encabezados.get('idempotency-key')).toBe('clave-1')
    expect(JSON.parse(capturadas[0]?.cuerpo ?? 'null')).toEqual({
      items: [{ productoId: 'p1', cantidad: 2 }],
      medioPago: 'EFECTIVO',
    })
  })

  it('convierte un error de la API en su código y su mensaje, sin perder el estado', async () => {
    const sobre = {
      error: {
        code: 'stock_insuficiente',
        message: 'No hay stock suficiente: quedan 3 unidades de Azúcar.',
      },
    }
    const { cliente } = preparar([json(sobre, 409), json(sobre, 409)])
    const venta = { items: [{ productoId: 'p1', cantidad: 9 }], medioPago: 'EFECTIVO' as const }

    await expect(cliente.registrarVenta(venta, 'k')).rejects.toMatchObject({
      name: 'ErrorDeApi',
      estado: 409,
      codigo: 'stock_insuficiente',
    })

    try {
      await cliente.registrarVenta(venta, 'k')
    } catch (error) {
      expect((error as ErrorDeApi).message).toContain('quedan 3 unidades')
    }
  })

  it('un error sin cuerpo JSON no rompe el diagnóstico', async () => {
    const { cliente } = preparar([new Response('sin json', { status: 502 })])

    await expect(cliente.listarProductos()).rejects.toMatchObject({
      name: 'ErrorDeApi',
      estado: 502,
      codigo: 'interno',
    })
  })

  it('distingue un fallo de red de una respuesta de error', async () => {
    const cliente = crearClienteApi({
      baseUrl: 'https://panel.example.com',
      token: 'cji_prueba',
      transporte: async () => {
        throw new TypeError('fetch failed')
      },
    })

    await expect(cliente.listarProductos()).rejects.toBeInstanceOf(ErrorDeRed)
  })

  it('arma la consulta de los reportes y no duplica la barra del base URL', async () => {
    const capturadas: Capturada[] = []

    const cliente = crearClienteApi({
      baseUrl: 'https://panel.example.com/',
      token: 'cji_prueba',
      transporte: async (peticion) => {
        capturadas.push({
          url: peticion.url,
          metodo: peticion.method,
          encabezados: peticion.headers,
          cuerpo: null,
        })
        return json({ fecha: '2026-11-19', medios: [], cantidadPagos: 0, granTotalCentavos: 0 })
      },
    })

    await cliente.cajaDelDia('2026-11-19')

    expect(capturadas[0]?.url).toBe('https://panel.example.com/api/v1/reportes/caja?fecha=2026-11-19')
  })
})
