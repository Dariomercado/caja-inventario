import { NextResponse, type NextRequest } from 'next/server'
import { ScopeApi } from '../../../../../../generated/prisma/enums'
import { errorJson } from '@/server/api/errores'
import { ejecutarAutenticado } from '@/server/api/handler'
import { obtenerVenta } from '@/server/ventasConsulta'

type Contexto = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, contexto: Contexto) {
  const { id } = await contexto.params

  return ejecutarAutenticado(request, ScopeApi.VENTAS_READ, async () => {
    const venta = await obtenerVenta(id)
    if (!venta) return errorJson('no_encontrado', `No existe una venta con id ${id}.`)

    return NextResponse.json(venta)
  })
}
