import { NextResponse, type NextRequest } from 'next/server'
import { ScopeApi } from '../../../../../../generated/prisma/enums'
import { errorJson } from '@/server/api/errores'
import { esquemaEditarProducto, mensajeDeValidacion } from '@/server/api/esquemas'
import { ejecutarAutenticado } from '@/server/api/handler'
import { actualizarProducto, obtenerProducto } from '@/server/productos'

type Contexto = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, contexto: Contexto) {
  // En Next 16 los params son una promesa: leerlos sin await devuelve un objeto
  // vacío y el handler responde "no encontrado" para todo.
  const { id } = await contexto.params

  return ejecutarAutenticado(request, ScopeApi.PRODUCTOS_READ, async () => {
    const producto = await obtenerProducto(id)
    if (!producto) return errorJson('no_encontrado', `No existe un producto con id ${id}.`)

    return NextResponse.json(producto)
  })
}

export async function PATCH(request: NextRequest, contexto: Contexto) {
  const { id } = await contexto.params

  return ejecutarAutenticado(request, ScopeApi.PRODUCTOS_WRITE, async () => {
    let cuerpo: unknown
    try {
      cuerpo = await request.json()
    } catch {
      return errorJson('cuerpo_invalido', 'El cuerpo no es JSON válido.')
    }

    const datos = esquemaEditarProducto.safeParse(cuerpo)
    if (!datos.success) {
      return errorJson('cuerpo_invalido', mensajeDeValidacion(datos.error))
    }

    const producto = await actualizarProducto(id, datos.data)
    return NextResponse.json(producto)
  })
}
