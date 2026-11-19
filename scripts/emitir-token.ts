// Emite un token de API para un usuario existente.
//
// Uso:
//   npm run token:emitir -- --email=admin@caja.local --nombre=asistente \
//     --scopes=productos:read,ventas:read
//
// El token en claro se imprime UNA vez y no se puede recuperar después. Si se
// pierde, se revoca y se emite otro.
//
// Este script escribe en la base que indique DATABASE_URL, que en esta máquina es
// producción por defecto. Por eso imprime el destino y se niega a escribir en un
// host que no sea local salvo que se pase --si-produccion de forma explícita.
import 'dotenv/config'
import { prisma } from '../src/lib/db'
import { NOMBRES_DE_SCOPE, scopesDesdeNombres } from '../src/server/api/scopes'
import { DIAS_VALIDEZ_POR_DEFECTO, emitirToken } from '../src/server/api/tokens'

function argumento(nombre: string): string | undefined {
  const prefijo = `--${nombre}=`
  const encontrado = process.argv.slice(2).find((arg) => arg.startsWith(prefijo))
  return encontrado?.slice(prefijo.length)
}

function abortar(mensaje: string): never {
  console.error(`\n✗ ${mensaje}\n`)
  process.exit(1)
}

/** Host y base destino, sin credenciales, para que se vea dónde se va a escribir. */
function destino(): { host: string; base: string; local: boolean } {
  const url = process.env['DATABASE_URL']
  if (!url) abortar('DATABASE_URL no está definida.')
  const parseada = new URL(url)
  const host = parseada.hostname
  return {
    host,
    base: parseada.pathname.replace(/^\//, ''),
    local: host === 'localhost' || host === '127.0.0.1' || host === '::1',
  }
}

async function main() {
  const email = argumento('email') ?? abortar('Falta --email=<usuario existente>.')
  const nombre = argumento('nombre') ?? abortar('Falta --nombre=<etiqueta del token>.')
  const scopesPedidos = (argumento('scopes') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  if (scopesPedidos.length === 0) {
    abortar(`Falta --scopes=<lista separada por comas>. Disponibles: ${NOMBRES_DE_SCOPE.join(', ')}`)
  }

  const scopes = scopesDesdeNombres(scopesPedidos)
  if (scopes === null) {
    abortar(`Algún scope no existe. Disponibles: ${NOMBRES_DE_SCOPE.join(', ')}`)
  }

  const diasTexto = argumento('dias')
  let diasValidez: number | null = DIAS_VALIDEZ_POR_DEFECTO
  if (diasTexto !== undefined) {
    // "0" se interpreta como sin vencimiento: es la forma de pedirlo sin ambigüedad.
    diasValidez = diasTexto === '0' ? null : Number(diasTexto)
    if (diasValidez !== null && (!Number.isInteger(diasValidez) || diasValidez < 1)) {
      abortar('--dias debe ser un entero positivo, o 0 para un token sin vencimiento.')
    }
  }

  const { host, base, local } = destino()
  if (!local && !process.argv.includes('--si-produccion')) {
    abortar(
      `DATABASE_URL apunta a "${host}/${base}", que no es local.\n` +
        '  Si de verdad querés emitir un token ahí, repetí el comando con --si-produccion.',
    )
  }

  const usuario = await prisma.usuario.findUnique({ where: { email } })
  if (!usuario) abortar(`No existe un usuario con email ${email}.`)

  const token = await emitirToken({
    usuarioId: usuario.id,
    nombre,
    scopes,
    diasValidez,
  })

  console.log(`\nBase:    ${host}/${base}`)
  console.log(`Usuario: ${usuario.email}`)
  console.log(`Nombre:  ${token.nombre}`)
  console.log(`Scopes:  ${token.scopes.join(', ')}`)
  console.log(`Vence:   ${token.expiraEn ? token.expiraEn.toISOString() : 'nunca'}`)
  console.log(`\nToken (se muestra una sola vez, no se guarda en claro):\n`)
  console.log(`  ${token.claro}\n`)
  console.log('Guardalo ahora. Si lo perdés, revocalo y emití otro.\n')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
