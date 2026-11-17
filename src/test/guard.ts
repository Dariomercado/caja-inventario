// Los tests truncan tablas entre casos. Si alguien corre `npm test` apuntando a la
// base de desarrollo por accidente, esto borra los datos de demo sin preguntar.
// Por eso el nombre de la base tiene que terminar en _test: mejor abortar que
// destruir.
export function assertTestDatabase() {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'DATABASE_URL no está definida. Los tests necesitan una base *_test, por ejemplo:\n' +
        '  DATABASE_URL="postgresql://caja:caja@localhost:5433/caja_test?schema=public" npm test',
    )
  }

  const nombre = new URL(url).pathname.replace(/^\//, '')

  if (!nombre.endsWith('_test')) {
    throw new Error(
      `Los tests abortan: DATABASE_URL apunta a "${nombre}", que no termina en _test.\n` +
        'Los tests truncan tablas y no deben tocar una base con datos reales.',
    )
  }
}
