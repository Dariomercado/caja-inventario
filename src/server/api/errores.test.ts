import { describe, expect, it } from 'vitest'
import {
  ClaveIdempotenciaReutilizadaError,
  PagoInconsistenteError,
  StockInsuficienteError,
} from '@/server/ventas'
import { respuestaDeErrorDeDominio } from './errores'

async function cuerpoDe(respuesta: Response) {
  return (await respuesta.json()) as { error: { code: string; message: string } }
}

describe('respuestaDeErrorDeDominio', () => {
  it('traduce stock insuficiente a 409 con el disponible', async () => {
    const error = new StockInsuficienteError('prod-1', 3, 5)

    const respuesta = respuestaDeErrorDeDominio(error)
    const cuerpo = await cuerpoDe(respuesta)

    expect(respuesta.status).toBe(409)
    expect(cuerpo.error.code).toBe('stock_insuficiente')
    expect(cuerpo.error.message).toContain('3')
    expect(cuerpo.error.message).toContain('5')
  })

  it('traduce pago inconsistente a 409', async () => {
    const respuesta = respuestaDeErrorDeDominio(new PagoInconsistenteError(1000, 900))

    expect(respuesta.status).toBe(409)
    expect((await cuerpoDe(respuesta)).error.code).toBe('pago_inconsistente')
  })

  it('traduce la clave de idempotencia reutilizada a 409', async () => {
    const respuesta = respuestaDeErrorDeDominio(new ClaveIdempotenciaReutilizadaError('clave-1'))

    expect(respuesta.status).toBe(409)
    expect((await cuerpoDe(respuesta)).error.code).toBe('clave_reutilizada')
  })

  it('convierte cualquier otra excepción en 500 sin filtrar su mensaje', async () => {
    // Simula lo que de verdad se escapa: un error de Prisma con el nombre de la
    // tabla y el detalle de la consulta adentro.
    const fuga = new Error('Unique constraint failed on Venta_claveIdempotencia_key')
    fuga.stack = 'at prisma.venta.create (/app/src/server/ventas.ts:190:11)'

    const respuesta = respuestaDeErrorDeDominio(fuga)
    const texto = await respuesta.text()

    expect(respuesta.status).toBe(500)
    expect(texto).not.toContain('Unique constraint')
    expect(texto).not.toContain('prisma.venta.create')
    expect(texto).not.toContain('ventas.ts')
    expect(JSON.parse(texto)).toEqual({
      error: { code: 'interno', message: 'Error interno.' },
    })
  })
})
