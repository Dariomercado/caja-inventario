import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// El workflow es código que nadie ejecuta en la suite: si el orden de los pasos se
// rompe, el pipeline queda rojo (o peor, verde sin verificar nada) recién en GitHub.
// Estas comprobaciones fijan las dos relaciones de orden que importan.
const FLUJO = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8')

function posicionDe(fragmento: string) {
  const indice = FLUJO.indexOf(fragmento)
  expect(indice, `el workflow tiene que mencionar «${fragmento}»`).toBeGreaterThanOrEqual(0)
  return indice
}

describe('workflow de CI', () => {
  it('construye antes de chequear tipos', () => {
    // `next build` genera `next-env.d.ts`, que está gitignoreado y declara tipos
    // globales como `LayoutProps`. Sin él, `tsc` falla en un checkout limpio.
    expect(posicionDe('npm run build')).toBeLessThan(posicionDe('npx tsc --noEmit'))
  })

  it('aplica las migraciones antes de los tests de servicios', () => {
    expect(posicionDe('npx prisma migrate deploy')).toBeLessThan(posicionDe('npm test'))
  })

  it('no silencia fallos con continue-on-error', () => {
    expect(FLUJO).not.toContain('continue-on-error')
  })
})
