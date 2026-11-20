import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { crearProducto, crearUsuario } from '@/test/fixtures'
import { listarProductos } from './productos'
import { registrarVenta } from './ventas'
import { listarVentas } from './ventasConsulta'

/**
 * Un cursor que ya no existe no es un error del servidor.
 *
 * Pasa por dos caminos normales: el cliente guardó la página siguiente y mientras
 * tanto alguien borró el producto, o el cursor viaja mal y apunta a la nada. En los
 * dos casos el contrato promete una página vacía —el comentario de `listarProductos`
 * lo dice con todas las letras— porque la alternativa es que la paginación quede
 * rota para siempre para ese cliente.
 */
describe('paginación con un cursor inexistente', () => {
  it('productos: devuelve la página vacía en lugar de un 500', async () => {
    await crearProducto({ precioCentavos: 100_000, stock: 1 })

    const pagina = await listarProductos({ cursor: 'no-existe' })

    expect(pagina).toEqual({ productos: [], siguienteCursor: null })
  })

  it('ventas: devuelve la página vacía en lugar de un 500', async () => {
    const usuario = await crearUsuario()
    const producto = await crearProducto({ precioCentavos: 100_000, stock: 5 })
    await registrarVenta({
      usuarioId: usuario.id,
      claveIdempotencia: randomUUID(),
      items: [{ productoId: producto.id, cantidad: 1 }],
      medioPago: 'EFECTIVO',
    })

    const pagina = await listarVentas({ cursor: 9999 })

    expect(pagina).toEqual({ ventas: [], siguienteCursor: null })
  })
})
