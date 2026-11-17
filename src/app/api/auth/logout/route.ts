import { NextResponse } from 'next/server'
import { NOMBRE_COOKIE_SESION, opcionesCookie } from '@/server/auth'

export async function POST() {
  const respuesta = NextResponse.json({ ok: true })

  // No existe un "borrar" del lado del servidor: se le pide al navegador que
  // descarte la cookie. Por eso el logout real requiere HTTPS (secure) — si la
  // cookie viajara en claro, un tercero podría reenviarla antes de que expire.
  respuesta.cookies.set(NOMBRE_COOKIE_SESION, '', { ...opcionesCookie(), maxAge: 0 })

  return respuesta
}
