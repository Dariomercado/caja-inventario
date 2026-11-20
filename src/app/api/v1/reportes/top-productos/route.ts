import { NextResponse, type NextRequest } from 'next/server'
import { ScopeApi } from '../../../../../../generated/prisma/enums'
import { errorJson } from '@/server/api/errores'
import { esquemaTopProductosQuery, mensajeDeValidacion } from '@/server/api/esquemas'
import { ejecutarAutenticado } from '@/server/api/handler'
import { topProductos } from '@/server/reportes'

export async function GET(request: NextRequest) {
  return ejecutarAutenticado(request, ScopeApi.REPORTES_READ, async () => {
    const consulta = esquemaTopProductosQuery.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    )
    if (!consulta.success) {
      return errorJson('cuerpo_invalido', mensajeDeValidacion(consulta.error))
    }

    return NextResponse.json({ productos: await topProductos(consulta.data) })
  })
}
