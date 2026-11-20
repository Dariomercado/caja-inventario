import { NextResponse } from 'next/server'
import { documentoOpenAPI } from '@/server/api/openapi'

/**
 * El documento OpenAPI, público a propósito: es documentación del contrato, no un
 * recurso del negocio. Cualquiera que tenga un token puede leerla; quien no lo tenga
 * no obtiene nada que no esté ya en el README.
 *
 * No lleva autenticación ni cupo, y ninguna de las dos cosas es un olvido: pedir un
 * token para leer cómo se pide un token sería un círculo.
 */
export async function GET() {
  return NextResponse.json(documentoOpenAPI())
}
