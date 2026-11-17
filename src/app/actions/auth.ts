'use server'

import { cerrarSesion } from '@/server/sesion'

export async function accionCerrarSesion(): Promise<void> {
  await cerrarSesion()
}
