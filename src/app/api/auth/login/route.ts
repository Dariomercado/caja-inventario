import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  NOMBRE_COOKIE_SESION,
  firmarSesion,
  opcionesCookie,
  verificarCredenciales,
} from '@/server/auth'

const esquemaCredenciales = z.object({
  email: z.string().min(1).max(320),
  password: z.string().min(1).max(200),
})

export async function POST(request: Request) {
  let cuerpo: unknown
  try {
    cuerpo = await request.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }

  const datos = esquemaCredenciales.safeParse(cuerpo)
  if (!datos.success) {
    return NextResponse.json({ error: 'Faltan email o contraseña' }, { status: 400 })
  }

  const usuario = await verificarCredenciales(datos.data.email, datos.data.password)

  if (!usuario) {
    // Mismo mensaje para email inexistente y contraseña incorrecta: no se revela
    // cuál de las dos falló, que es la mitad del trabajo de un ataque de enumeración.
    return NextResponse.json({ error: 'Credenciales inválidas' }, { status: 401 })
  }

  const respuesta = NextResponse.json({ usuario })
  respuesta.cookies.set(NOMBRE_COOKIE_SESION, firmarSesion(usuario.id), opcionesCookie())
  return respuesta
}
