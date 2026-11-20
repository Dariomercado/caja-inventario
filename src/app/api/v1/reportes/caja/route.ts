import { NextResponse, type NextRequest } from 'next/server'
import { ScopeApi } from '../../../../../../generated/prisma/enums'
import { errorJson } from '@/server/api/errores'
import { esquemaCajaQuery, mensajeDeValidacion } from '@/server/api/esquemas'
import { ejecutarAutenticado } from '@/server/api/handler'
import { cajaDelDia } from '@/server/reportes'

export async function GET(request: NextRequest) {
  return ejecutarAutenticado(request, ScopeApi.REPORTES_READ, async () => {
    const consulta = esquemaCajaQuery.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    )
    if (!consulta.success) {
      return errorJson('cuerpo_invalido', mensajeDeValidacion(consulta.error))
    }

    return NextResponse.json(await cajaDelDia(consulta.data))
  })
}
