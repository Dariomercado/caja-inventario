import { NextResponse, type NextRequest } from 'next/server'
import { ScopeApi } from '../../../../../../../generated/prisma/enums'
import { errorJson } from '@/server/api/errores'
import { esquemaAjusteStock, mensajeDeValidacion } from '@/server/api/esquemas'
import { ejecutarAutenticado } from '@/server/api/handler'
import { ajustarStock } from '@/server/productos'

type Contexto = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, contexto: Contexto) {
  const { id } = await contexto.params

  return ejecutarAutenticado(request, ScopeApi.PRODUCTOS_WRITE, async () => {
    let cuerpo: unknown
    try {
      cuerpo = await request.json()
    } catch {
      return errorJson('cuerpo_invalido', 'El cuerpo no es JSON válido.')
    }

    const datos = esquemaAjusteStock.safeParse(cuerpo)
    if (!datos.success) {
      return errorJson('cuerpo_invalido', mensajeDeValidacion(datos.error))
    }

    const resultado = await ajustarStock({ productoId: id, ...datos.data })

    return NextResponse.json({
      productoId: resultado.productoId,
      stockAnterior: resultado.stock,
      stock: resultado.stockLuego,
    })
  })
}
