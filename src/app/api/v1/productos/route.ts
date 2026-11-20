import { NextResponse, type NextRequest } from 'next/server'
import { ScopeApi } from '../../../../../generated/prisma/enums'
import { errorJson } from '@/server/api/errores'
import { esquemaListado, esquemaNuevoProducto, mensajeDeValidacion } from '@/server/api/esquemas'
import { ejecutarAutenticado } from '@/server/api/handler'
import { SkuDuplicadoError } from '@/server/productos'
import { crearProducto, listarProductos } from '@/server/productos'

export async function GET(request: NextRequest) {
  return ejecutarAutenticado(request, ScopeApi.PRODUCTOS_READ, async () => {
    const parametros = esquemaListado.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    )
    if (!parametros.success) {
      return errorJson('cuerpo_invalido', mensajeDeValidacion(parametros.error))
    }

    const { productos, siguienteCursor } = await listarProductos(parametros.data)
    return NextResponse.json({ productos, siguienteCursor })
  })
}

export async function POST(request: NextRequest) {
  return ejecutarAutenticado(request, ScopeApi.PRODUCTOS_WRITE, async () => {
    let cuerpo: unknown
    try {
      cuerpo = await request.json()
    } catch {
      return errorJson('cuerpo_invalido', 'El cuerpo no es JSON válido.')
    }

    const datos = esquemaNuevoProducto.safeParse(cuerpo)
    if (!datos.success) {
      return errorJson('cuerpo_invalido', mensajeDeValidacion(datos.error))
    }

    try {
      const producto = await crearProducto(datos.data)
      return NextResponse.json(producto, { status: 201 })
    } catch (error) {
      // Un SKU repetido es un conflicto del cliente, no un defecto del servidor: si
      // se dejara pasar al clamp general, el consumidor recibiría un 500 y no sabría
      // que el problema es el dato que mandó.
      if (error instanceof SkuDuplicadoError) {
        return errorJson('conflicto', error.message)
      }
      throw error
    }
  })
}
