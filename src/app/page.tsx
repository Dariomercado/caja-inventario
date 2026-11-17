import { redirect } from 'next/navigation'

// Fuera del grupo (panel) a propósito: así esta ruta no ejecuta el guard de sesión
// durante el prerender y puede ser un redirect estático.
export default function Inicio() {
  redirect('/productos')
}
