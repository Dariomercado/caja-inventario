import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { NOMBRE_COOKIE_SESION, leerSesion } from './auth'
import { prisma } from '../lib/db'

export type UsuarioDeSesion = { id: string; nombre: string; email: string }

/**
 * Usuario de la petición actual, o null.
 *
 * Consulta la base y no sólo la firma: un token válido de un usuario dado de baja
 * deja de servir en el acto. La firma prueba quién emitió la sesión, no que esa
 * persona siga habilitada.
 */
export async function usuarioActual(): Promise<UsuarioDeSesion | null> {
  const almacen = await cookies()
  const cookie = almacen.get(NOMBRE_COOKIE_SESION)
  if (!cookie) return null

  const sesion = leerSesion(cookie.value)
  if (!sesion) return null

  return prisma.usuario.findFirst({
    where: { id: sesion.userId, activo: true },
    select: { id: true, nombre: true, email: true },
  })
}

/** Igual que usuarioActual, pero corta la navegación mandando a /login. */
export async function requerirUsuario(): Promise<UsuarioDeSesion> {
  const usuario = await usuarioActual()
  if (!usuario) redirect('/login')
  return usuario
}

export async function cerrarSesion(): Promise<void> {
  const almacen = await cookies()
  almacen.delete(NOMBRE_COOKIE_SESION)
  redirect('/login')
}
