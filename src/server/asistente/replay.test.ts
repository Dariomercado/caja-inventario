import { describe, expect, it } from 'vitest'
import grabadoCrudo from './replay-grabado.json'
import {
  cargarReplayGrabado,
  decidirEstadoDelPanel,
  leerReplayGrabado,
  type ReplayGrabado,
} from './replay'

/**
 * The recorded exchange the panel serves in replay mode (S10, S13).
 *
 * What matters here is honesty: the panel shows one recorded exchange, labelled with
 * the date and the model, and it shows exactly the turns the file has. A loader that
 * invented a turn, or that threw instead of falling back, would turn a recording into
 * a fake live answer.
 */

const PEDIDO = 'Vendé 2 de azúcar común de 1 kg, pagadas en efectivo.'

const VALIDO: ReplayGrabado = {
  caso: 'simple sale',
  pedido: PEDIDO,
  fecha: '2026-11-20',
  modelo: 'glm5.3-flash',
  turnos: [
    { rol: 'usuario', texto: PEDIDO },
    {
      rol: 'asistente',
      texto: 'Registré la venta #1: 2 × Azúcar común 1 kg, total $3.000, en efectivo.',
      llamadas: [
        { nombre: 'listar_productos', estado: 'ok', detalle: '' },
        { nombre: 'registrar_venta', estado: 'ok', detalle: '' },
      ],
    },
  ],
}

function conCambios(cambios: Record<string, unknown>): unknown {
  return { ...VALIDO, ...cambios }
}

describe('reading a recording', () => {
  it('returns exactly the turns the file has, without inventing one', () => {
    expect(leerReplayGrabado(VALIDO)).toEqual(VALIDO)
  })

  it('returns null when there is no recording', () => {
    expect(leerReplayGrabado(undefined)).toBeNull()
    expect(leerReplayGrabado(null)).toBeNull()
    expect(leerReplayGrabado('no soy un grabado')).toBeNull()
  })

  it('returns null when the shape is broken', () => {
    const rotos: [string, unknown][] = [
      ['sin fecha', conCambios({ fecha: undefined })],
      ['fecha con otro formato', conCambios({ fecha: '20/11/2026' })],
      ['sin modelo', conCambios({ modelo: '' })],
      ['un solo turno', conCambios({ turnos: [VALIDO.turnos[0]] })],
      ['el primer turno no es del usuario', conCambios({ turnos: [VALIDO.turnos[1], VALIDO.turnos[0]] })],
      ['tres turnos', conCambios({ turnos: [...VALIDO.turnos, VALIDO.turnos[1]] })],
      ['el pedido no coincide con el turno del usuario', conCambios({ pedido: 'otra cosa' })],
      ['un campo de más', conCambios({ respuestaInventada: 'hola' })],
      [
        'una llamada sin nombre',
        conCambios({
          turnos: [
            VALIDO.turnos[0],
            { ...VALIDO.turnos[1], llamadas: [{ nombre: '', estado: 'ok', detalle: '' }] },
          ],
        }),
      ],
      [
        'una llamada con un estado inventado',
        conCambios({
          turnos: [
            VALIDO.turnos[0],
            { ...VALIDO.turnos[1], llamadas: [{ nombre: 'listar_productos', estado: 'inventado', detalle: '' }] },
          ],
        }),
      ],
    ]

    for (const [nombre, crudo] of rotos) {
      expect(leerReplayGrabado(crudo), nombre).toBeNull()
    }
  })

  it('loads the recording bundled with the app', () => {
    const grabado = cargarReplayGrabado()

    expect(grabado).not.toBeNull()
    expect(grabado?.caso).toBe('simple sale')
    expect(grabado?.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(grabado?.modelo).toBeTruthy()
    expect(grabado?.turnos).toHaveLength(2)
    expect(grabado?.turnos[0]).toEqual({ rol: 'usuario', texto: grabado?.pedido })
    expect(grabado?.turnos[1].rol).toBe('asistente')
    // The panel renders the file, not a memory of it.
    expect(grabado?.turnos).toEqual((grabadoCrudo as { turnos: unknown }).turnos)
  })
})

describe('panel state', () => {
  const base = { grabado: VALIDO, usadasHoy: 10, topeDiario: 300, problemaDeConfiguracion: null }

  it('serves the recording when the daily budget is exhausted', () => {
    const estado = decidirEstadoDelPanel({ ...base, usadasHoy: 300 })

    expect(estado.tipo).toBe('replay')
    expect(estado).toMatchObject({ grabado: VALIDO })
    expect(estado.tipo === 'replay' ? estado.motivo : '').toContain('300')
  })

  it('serves the recording when the configuration is missing', () => {
    const estado = decidirEstadoDelPanel({
      ...base,
      usadasHoy: null,
      topeDiario: null,
      problemaDeConfiguracion: 'Falta configurar el asistente: ASISTENTE_MODELO_API_KEY',
    })

    expect(estado.tipo).toBe('replay')
    expect(estado.tipo === 'replay' ? estado.motivo : '').toContain('ASISTENTE_MODELO_API_KEY')
  })

  it('says it is not configured when there is neither configuration nor recording', () => {
    const estado = decidirEstadoDelPanel({
      grabado: null,
      usadasHoy: null,
      topeDiario: null,
      problemaDeConfiguracion: 'Falta configurar el asistente: ASISTENTE_MODELO_API_KEY',
    })

    expect(estado).toMatchObject({ tipo: 'sin-configurar' })
    expect(estado.tipo === 'sin-configurar' ? estado.detalle : '').toContain('ASISTENTE_MODELO_API_KEY')
  })

  it('leaves the live conversation when there is budget and configuration', () => {
    expect(decidirEstadoDelPanel(base)).toEqual({ tipo: 'vivo' })
  })

  it('falls back to today behaviour when the budget is spent and there is no recording', () => {
    expect(decidirEstadoDelPanel({ ...base, grabado: null, usadasHoy: 300 })).toEqual({ tipo: 'vivo' })
  })

  it('keeps the live conversation when the counter could not be read', () => {
    expect(decidirEstadoDelPanel({ ...base, usadasHoy: null })).toEqual({ tipo: 'vivo' })
  })
})
