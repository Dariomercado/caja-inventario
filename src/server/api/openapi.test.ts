import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PATHS_DOCUMENTADOS, documentoOpenAPI } from './openapi'

/**
 * El documento no puede divergir del código.
 *
 * Un `openapi.json` desactualizado es peor que no tener documentación: promete
 * endpoints que ya no existen y calla los que sí. Estos tests recorren el árbol real
 * de rutas y lo cruzan con el documento en los dos sentidos.
 *
 * Se inspecciona el texto del archivo y no se importa el módulo: importar handlers
 * de Next en un test arrastra el runtime de la ruta, y acá la pregunta es más simple
 * —"¿este archivo declara este método?"—.
 */

const RAIZ_RUTAS = join(process.cwd(), 'src/app/api/v1')

/** La única ruta que no se documenta a sí misma. */
const EXCLUIDAS = new Set(['openapi.json'])

function rutasDeclaradas(directorio: string): string[] {
  const encontradas: string[] = []

  for (const entrada of readdirSync(directorio)) {
    const ruta = join(directorio, entrada)
    if (statSync(ruta).isDirectory()) {
      encontradas.push(...rutasDeclaradas(ruta))
    } else if (entrada === 'route.ts') {
      encontradas.push(ruta)
    }
  }

  return encontradas
}

/** `src/app/api/v1/productos/[id]/route.ts` → `/productos/{id}` */
function pathDesdeArchivo(archivo: string): string {
  return archivo
    .slice(RAIZ_RUTAS.length)
    .replace(/\/route\.ts$/, '')
    .replace(/\[([^\]]+)\]/g, '{$1}')
}

function archivoDesdePath(path: string): string {
  return join(RAIZ_RUTAS, path.replace(/\{([^}]+)\}/g, '[$1]'), 'route.ts')
}

const ARCHIVOS = rutasDeclaradas(RAIZ_RUTAS)
  .map((archivo) => ({ archivo, path: pathDesdeArchivo(archivo) }))
  .filter(({ path }) => !EXCLUIDAS.has(path.replace(/^\//, '')))

describe('documento OpenAPI', () => {
  it('declara que es 3.1 y un esquema de seguridad bearer', () => {
    const documento = documentoOpenAPI() as {
      openapi: string
      security: unknown[]
      components: { securitySchemes: Record<string, { type: string; scheme: string }> }
    }

    expect(documento.openapi).toBe('3.1.0')
    expect(documento.security).toEqual([{ bearer: [] }])
    expect(documento.components.securitySchemes['bearer']).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    })
  })

  it('cada endpoint documentado existe como archivo y declara su método', () => {
    for (const endpoint of PATHS_DOCUMENTADOS) {
      const archivo = archivoDesdePath(endpoint.path)
      const contenido = readFileSync(archivo, 'utf8')

      expect(contenido, `${endpoint.method.toUpperCase()} ${endpoint.path}`).toMatch(
        new RegExp(`export async function ${endpoint.method.toUpperCase()}\\b`),
      )
    }
  })

  it('cada archivo de ruta está documentado', () => {
    const documentados = new Set(
      PATHS_DOCUMENTADOS.map((endpoint) => `${endpoint.method} ${endpoint.path}`),
    )

    for (const { archivo, path } of ARCHIVOS) {
      const contenido = readFileSync(archivo, 'utf8')
      const metodos = [...contenido.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\b/g)]

      // Un endpoint nuevo que nadie documentó aparece acá, con su ruta real.
      expect(metodos.length, `${archivo} no declara ningún método`).toBeGreaterThan(0)
      for (const [, metodo] of metodos) {
        expect(documentados, `${metodo} ${path} falta en el documento`).toContain(
          `${metodo!.toLowerCase()} ${path}`,
        )
      }
    }
  })

  it('cada operación declara el scope que exige', () => {
    const documento = documentoOpenAPI() as {
      paths: Record<string, Record<string, { description: string; responses: Record<string, unknown> }>>
    }

    for (const endpoint of PATHS_DOCUMENTADOS) {
      const operacion = documento.paths[endpoint.path]?.[endpoint.method]
      expect(operacion, `${endpoint.method} ${endpoint.path}`).toBeDefined()
      expect(operacion!.description).toContain(endpoint.scope)
      // Todo endpoint documenta el éxito y el 500 genérico.
      expect(Object.keys(operacion!.responses)).toContain('500')
    }
  })

  it('documenta Idempotency-Key como header obligatorio de la venta', () => {
    const documento = documentoOpenAPI() as {
      paths: Record<
        string,
        { post: { parameters: { name: string; in: string; required: boolean }[] } }
      >
    }

    const parametros = documento.paths['/ventas']!.post.parameters
    const clave = parametros.find((parametro) => parametro.name === 'Idempotency-Key')

    expect(clave).toMatchObject({ in: 'header', required: true })
  })

  it('el path de producto por id documenta el id como parámetro de ruta', () => {
    const documento = documentoOpenAPI() as {
      paths: Record<
        string,
        { get: { parameters?: { name: string; in: string; required: boolean }[] } }
      >
    }

    const parametros = documento.paths['/productos/{id}']!.get.parameters ?? []

    expect(parametros).toContainEqual(
      expect.objectContaining({ name: 'id', in: 'path', required: true }),
    )
  })
})
