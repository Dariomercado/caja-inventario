// Nombre de la cookie en un módulo sin dependencias: lo necesitan tanto el código
// de Node (auth) como el de Edge (middleware), y auth.ts arrastra bcrypt y Prisma,
// que no existen en el runtime Edge.
export const NOMBRE_COOKIE_SESION = 'caja_sesion'

export const LARGO_MINIMO_SECRETO = 32

export const DURACION_SESION_MS = 8 * 60 * 60 * 1000
