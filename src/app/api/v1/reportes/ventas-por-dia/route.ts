import { NextResponse, type NextRequest } from 'next/server'
import { ScopeApi } from '../../../../../../generated/prisma/enums'
import { errorJson } from '@/server/api/errores'
import { esquemaRango, mensajeDeValidacion } from '@/server/api/esquemas'
import { ejecutarAutenticado } from '@/server/api/handler'
import { resumenPorDia } from '@/server/reportes'

export async function GET(request: NextRequest) {
  return ejecutarAutenticado(request, ScopeApi.REPORTES_READ, async () => {
    const rango = esquemaRango.safeParse(Object.fromEntries(new URL(request.url).searchParams))
    if (!rango.success) {
      return errorJson('cuerpo_invalido', mensajeDeValidacion(rango.error))
    }

    // El rango se valida acá y no en el reporte: el reporte lo usa para armar un
    // `generate_series` en SQL, y una fecha inválida ahí no da error, da una serie
    // vacía. Un 400 explícito es más útil que un reporte de ceros.
    return NextResponse.json({ dias: await resumenPorDia(rango.data) })
  })
}
