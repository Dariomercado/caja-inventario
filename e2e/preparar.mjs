// Preparación de la base de los e2e, en un solo lugar.
//
// La necesitan dos caminos distintos: `scripts/e2e.mjs` (que además valida que la
// base esté levantada y el puerto libre) y el `globalSetup` de
// `playwright.config.ts`, porque `npx playwright test` a mano también escribe
// datos. Sin esto, la segunda corrida manual hereda la venta y el stock de la
// primera, y la suite empieza a fallar por datos, no por código.
//
// Ojo: Playwright carga el config y el globalSetup compilados a CommonJS, así que
// acá no se puede usar `import.meta`. La raíz del repo se recibe como argumento (el
// script la resuelve desde su propia ruta) y por defecto es el directorio actual,
// que es desde donde se invoca Playwright.
//
// Los errores se tiran sin prefijo: cada puerta los presenta con el suyo.
//   - `scripts/e2e.mjs` → `fallar()` imprime `[e2e] mensaje`
//   - `playwright.config.ts` y el globalSetup → `conPrefijoE2E()`
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'
import { validarBaseE2E } from './base-e2e.mjs'

/** Crea la base si falta. `CREATE DATABASE` no corre dentro de una transacción. */
async function asegurarLaBase(base, nombreBase) {
  // La base de mantenimiento es la única a la que se puede conectar cuando la base
  // de los e2e todavía no existe. No todas las instalaciones la tienen.
  const mantenimiento = new URL(base)
  mantenimiento.pathname = '/postgres'

  const cliente = new pg.Client({ connectionString: mantenimiento.toString() })
  try {
    await cliente.connect()
  } catch (causa) {
    const detalle = causa instanceof Error ? causa.message : String(causa)
    throw new Error(
      `no se pudo conectar a la base de mantenimiento "postgres" en ${mantenimiento.host}.\n` +
        '      Es la conexión con la que se crea la base de los e2e cuando todavía no existe.\n' +
        '      Si el servidor está arriba, esa base se puede crear a mano.\n' +
        `      Detalle: ${detalle}`,
    )
  }

  try {
    const { rowCount } = await cliente.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      nombreBase,
    ])
    if (rowCount === 0) {
      await cliente.query(`CREATE DATABASE "${nombreBase}"`)
      console.log(`[e2e] base "${nombreBase}" creada`)
    }
  } finally {
    await cliente.end()
  }
}

/**
 * Vuelve la base a cero. Se borra el schema entero en lugar de truncar tablas una
 * por una: así también se va `_prisma_migrations` y las migraciones se aplican
 * desde el principio, que es el estado que queremos probar.
 */
async function vaciarLaBase(base) {
  const cliente = new pg.Client({ connectionString: base })
  await cliente.connect()
  try {
    await cliente.query('DROP SCHEMA IF EXISTS public CASCADE')
    await cliente.query('CREATE SCHEMA public')
  } finally {
    await cliente.end()
  }
}

function ejecutar(etiqueta, entrada, argumentos, base, raiz) {
  const archivo = resolve(raiz, entrada)
  if (!existsSync(archivo)) {
    throw new Error(`falta ${entrada}. Corré \`npm install\` antes de los e2e.`)
  }
  console.log(`[e2e] ${etiqueta}`)
  const resultado = spawnSync(process.execPath, [archivo, ...argumentos], {
    cwd: raiz,
    // Prisma 7 prefiere `DIRECT_URL` sobre `DATABASE_URL` para migrar: con una sola
    // de las dos apuntando a la base de pruebas, la migración iría a la del `.env`.
    env: { ...process.env, DATABASE_URL: base, DIRECT_URL: base },
    stdio: 'inherit',
  })
  if (resultado.status !== 0) {
    throw new Error(`falló «${etiqueta}» (código ${resultado.status ?? 1}).`)
  }
}

/**
 * Deja la base de los e2e lista para correr: existe, está vacía, tiene el schema
 * migrado y los datos de demo sembrados. Correrla dos veces seguidas deja lo mismo,
 * que es la condición para que una segunda corrida no herede la primera.
 * @param {string} base
 * @param {string} [raiz] raíz del repo donde viven `node_modules` y `prisma/`
 */
export async function prepararBase(base, raiz = process.cwd()) {
  const { nombreBase } = validarBaseE2E(base)
  await asegurarLaBase(base, nombreBase)
  await vaciarLaBase(base)
  ejecutar('aplicando migraciones', 'node_modules/prisma/build/index.js', ['migrate', 'deploy'], base, raiz)
  ejecutar('sembrando datos de demo', 'node_modules/prisma/build/index.js', ['db', 'seed'], base, raiz)
}
