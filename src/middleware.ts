import { NextResponse, type NextRequest } from 'next/server'
import { NOMBRE_COOKIE_SESION } from '@/server/cookie'
import { leerSesionEdge } from '@/server/sesion-edge'

/**
 * Guard de rutas protegidas.
 *
 * Vive en middleware y no en el layout a propósito: el layout se renderiza en
 * paralelo con la página, así que cuando el redirect aparece la consulta a la base
 * ya se hizo y los datos viajaron en el cuerpo de la respuesta. Comprobado con un
 * pedido anónimo: el HTML traía el catálogo antes de este cambio.
 *
 * Sólo valida la firma y la expiración. Que el usuario siga activo lo verifica el
 * layout contra la base, que el middleware no puede consultar (no hay Prisma en
 * Edge): son dos capas, cada una con lo que puede hacer.
 */
export async function middleware(request: NextRequest) {
  const valor = request.cookies.get(NOMBRE_COOKIE_SESION)?.value
  const sesion = valor ? await leerSesionEdge(valor) : null

  if (!sesion) {
    const destino = request.nextUrl.clone()
    destino.pathname = '/login'
    // Se descarta el query string: no tiene sentido arrastrar el rango de fechas de
    // un reporte a la pantalla de login.
    destino.search = ''
    return NextResponse.redirect(destino)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/productos/:path*', '/ventas/:path*', '/reportes/:path*'],
}
