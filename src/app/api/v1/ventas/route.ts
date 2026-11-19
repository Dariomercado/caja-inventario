import { NextResponse, type NextRequest } from 'next/server'
import { ScopeApi } from '../../../../../generated/prisma/enums'
import { errorJson } from '@/server/api/errores'
import {
  esquemaIdempotencyKey,
  esquemaListadoVentas,
  esquemaNuevaVenta,
  mensajeDeValidacion,
} from '@/server/api/esquemas'
import { ejecutarAutenticado } from '@/server/api/handler'
import { registrarVenta } from '@/server/ventas'
import { listarVentas } from '@/server/ventasConsulta'

export async function GET(request: NextRequest) {
  return ejecutarAutenticado(request, ScopeApi.VENTAS_READ, async () => {
    const parametros = esquemaListadoVentas.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    )
    if (!parametros.success) {
      return errorJson('cuerpo_invalido', mensajeDeValidacion(parametros.error))
    }

    const { ventas, siguienteCursor } = await listarVentas(parametros.data)

    return NextResponse.json({ ventas, siguienteCursor })
  })
}

export async function POST(request: NextRequest) {
  return ejecutarAutenticado(request, ScopeApi.VENTAS_WRITE, async (token) => {
    // La clave vive en un header y no en el cuerpo: es una propiedad del pedido, no
    // del recurso. Un proxy que reintenta el POST puede reenviar headers, pero no
    // reescribir el cuerpo que ya mandó.
    const clave = esquemaIdempotencyKey.safeParse(request.headers.get('idempotency-key'))
    if (!clave.success) {
      return errorJson(
        'cuerpo_invalido',
        'Falta el header Idempotency-Key o no es válido. Sin él, un reintento registraría la venta dos veces.',
      )
    }

    let cuerpo: unknown
    try {
      cuerpo = await request.json()
    } catch {
      return errorJson('cuerpo_invalido', 'El cuerpo no es JSON válido.')
    }

    const datos = esquemaNuevaVenta.safeParse(cuerpo)
    if (!datos.success) {
      return errorJson('cuerpo_invalido', mensajeDeValidacion(datos.error))
    }

    const venta = await registrarVenta({
      usuarioId: token.usuarioId,
      claveIdempotencia: clave.data,
      items: datos.data.items,
      ...(datos.data.pagos === undefined ? {} : { pagos: datos.data.pagos }),
      ...(datos.data.medioPago === undefined ? {} : { medioPago: datos.data.medioPago }),
    })

    return NextResponse.json(
      {
        id: venta.id,
        numero: venta.numero,
        totalCentavos: venta.totalCentavos,
      },
      // 201 si esta llamada creó la venta, 200 si devolvió la que ya existía con la
      // misma clave. El cuerpo es idéntico a propósito: el consumidor que sólo mira
      // el cuerpo funciona igual en los dos casos.
      { status: venta.reutilizada ? 200 : 201 },
    )
  })
}
