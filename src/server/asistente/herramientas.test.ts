import { describe, expect, it } from 'vitest'
import { crearClienteApi } from './api'
import { crearHerramientas } from './herramientas'

/**
 * Cliente falso: registra las llamadas y devuelve lo que el test prepare.
 * No reemplaza al cliente real por comodidad, sino para poder afirmar exactamente
 * qué argumentos recibió —que es donde vive el contrato de la herramienta.
 */
function clienteFalso(respuestas: Record<string, unknown> = {}) {
  const llamadas: { metodo: string; argumentos: unknown[] }[] = []

  const registrar = (metodo: string) => async (...argumentos: unknown[]) => {
    llamadas.push({ metodo, argumentos })
    const preparada = respuestas[metodo]
    if (preparada instanceof Error) throw preparada
    return preparada
  }

  return {
    llamadas,
    cliente: {
      listarProductos: registrar('listarProductos'),
      verProducto: registrar('verProducto'),
      listarVentas: registrar('listarVentas'),
      verVenta: registrar('verVenta'),
      registrarVenta: registrar('registrarVenta'),
      cajaDelDia: registrar('cajaDelDia'),
      ventasPorDia: registrar('ventasPorDia'),
      topProductos: registrar('topProductos'),
    } as unknown as ReturnType<typeof crearClienteApi>,
  }
}

const OPCIONES = { maxProductos: 20 }
const CONTEXTO = { claveIdempotencia: 'clave-del-intento' }

/** Nombres de todas las propiedades del esquema, incluidas las de los arrays. */
function nombresDePropiedades(esquema: unknown, acumulado: string[] = []): string[] {
  if (typeof esquema !== 'object' || esquema === null) return acumulado
  const objeto = esquema as { properties?: Record<string, unknown>; items?: unknown }
  for (const [nombre, hijo] of Object.entries(objeto.properties ?? {})) {
    acumulado.push(nombre)
    nombresDePropiedades(hijo, acumulado)
  }
  if (objeto.items) nombresDePropiedades(objeto.items, acumulado)
  return acumulado
}

describe('herramientas del asistente', () => {
  it('ninguna herramienta de venta acepta dinero: el modelo no puede mandar precios ni totales', () => {
    const { cliente } = clienteFalso()
    const { definiciones } = crearHerramientas(cliente, OPCIONES)

    const venta = definiciones.find((herramienta) => herramienta.function.name === 'registrar_venta')
    expect(venta).toBeDefined()

    // Se miran los nombres de las propiedades del esquema, no el texto: las
    // descripciones sí hablan de precios, justamente para decir que no se mandan.
    const nombres = nombresDePropiedades(venta?.function.parameters)
    expect(nombres.sort()).toEqual(['cantidad', 'items', 'medio_pago', 'producto_id'])
    for (const nombre of nombres) {
      expect(nombre).not.toMatch(/total|precio|subtotal|monto|centavos/i)
    }
  })

  it('registrar_venta traduce a la API y usa la clave de idempotencia del intento', async () => {
    const { cliente, llamadas } = clienteFalso({
      registrarVenta: { id: 'v1', numero: 7, totalCentavos: 300_000, creada: true },
    })
    const { ejecutar } = crearHerramientas(cliente, OPCIONES)

    const resultado = await ejecutar(
      'registrar_venta',
      { items: [{ producto_id: 'p1', cantidad: 2 }], medio_pago: 'EFECTIVO' },
      CONTEXTO,
    )

    expect(resultado).toMatchObject({ ok: true, ventaRegistrada: true })
    expect(llamadas[0]).toEqual({
      metodo: 'registrarVenta',
      argumentos: [
        { items: [{ productoId: 'p1', cantidad: 2 }], medioPago: 'EFECTIVO' },
        'clave-del-intento',
      ],
    })
  })

  it('un reenvío con la misma clave no cuenta como venta nueva y no renueva la clave', async () => {
    const { cliente } = clienteFalso({
      registrarVenta: { id: 'v1', numero: 7, totalCentavos: 300_000, creada: false },
    })
    const { ejecutar } = crearHerramientas(cliente, OPCIONES)

    const resultado = await ejecutar(
      'registrar_venta',
      { items: [{ producto_id: 'p1', cantidad: 2 }], medio_pago: 'EFECTIVO' },
      CONTEXTO,
    )

    expect(resultado).toMatchObject({ ok: true, ventaRegistrada: false })
  })

  it('el catálogo que llega al modelo no pasa del tope de contexto', async () => {
    const productos = Array.from({ length: 30 }, (_, indice) => ({ id: `p${indice}` }))
    const { cliente, llamadas } = clienteFalso({
      listarProductos: { productos, siguienteCursor: null },
    })
    const { ejecutar } = crearHerramientas(cliente, { maxProductos: 20 })

    const resultado = await ejecutar('listar_productos', { limite: 100 }, CONTEXTO)

    expect(llamadas[0]?.argumentos[0]).toMatchObject({ limite: 20 })
    expect(resultado.ok).toBe(true)
    const datos = (resultado as { datos: { productos: unknown[]; truncados: number } }).datos
    expect(datos.productos).toHaveLength(20)
    expect(datos.truncados).toBe(10)
  })

  it('una herramienta inexistente devuelve un error explícito y no rompe el pedido', async () => {
    const { cliente } = clienteFalso()
    const { ejecutar } = crearHerramientas(cliente, OPCIONES)

    const resultado = await ejecutar('borrar_todo', {}, CONTEXTO)

    expect(resultado).toMatchObject({
      ok: false,
      error: { code: 'herramienta_desconocida' },
    })
  })

  it('argumentos que no validan se informan como error en vez de llegar a la API', async () => {
    const { cliente, llamadas } = clienteFalso()
    const { ejecutar } = crearHerramientas(cliente, OPCIONES)

    const resultado = await ejecutar(
      'registrar_venta',
      { items: [{ producto_id: 'p1', cantidad: -2 }], medio_pago: 'EFECTIVO' },
      CONTEXTO,
    )

    expect(resultado).toMatchObject({ ok: false, error: { code: 'argumentos_invalidos' } })
    expect(llamadas).toHaveLength(0)
  })

  it('un error de la API se informa tal cual y no se reintenta con otros valores', async () => {
    const { ErrorDeApi } = await import('./api')
    const { cliente, llamadas } = clienteFalso({
      registrarVenta: new ErrorDeApi(409, 'stock_insuficiente', 'quedan 3 unidades'),
    })
    const { ejecutar } = crearHerramientas(cliente, OPCIONES)

    const resultado = await ejecutar(
      'registrar_venta',
      { items: [{ producto_id: 'p1', cantidad: 9 }], medio_pago: 'EFECTIVO' },
      CONTEXTO,
    )

    expect(resultado).toEqual({
      ok: false,
      error: { code: 'stock_insuficiente', message: 'quedan 3 unidades' },
    })
    expect(llamadas).toHaveLength(1)
  })

  it('todas las herramientas declaran parámetros de tipo objeto', () => {
    const { cliente } = clienteFalso()
    const { definiciones } = crearHerramientas(cliente, OPCIONES)

    expect(definiciones).toHaveLength(8)
    for (const herramienta of definiciones) {
      expect(herramienta.type).toBe('function')
      expect(herramienta.function.parameters).toMatchObject({ type: 'object' })
      expect(herramienta.function.description.length).toBeGreaterThan(10)
    }
  })
})
