# Cierre de caja-inventario: pipeline en GitHub Actions y e2e con navegador

Feature de cierre del proyecto. El alcance funcional (T1–T9 de
`caja-inventario.md`) está cerrado y verificado en producción; esto agrega la
verificación automática que hoy sólo corre en la máquina del autor.

## Specs

S1. **El repo se valida solo.** En cada push a `main` y en cada pull request,
GitHub Actions corre los tests de servicios (62 al momento de escribir esto),
`eslint`, `tsc --noEmit` y `next build`. Un fallo en cualquiera de los cuatro
corta el pipeline.

S2. **E2E por la UI real, con navegador.** Playwright sobre Chromium maneja la
aplicación compilada y cubre: rutas protegidas sin sesión que terminan en
`/login` sin filtrar datos, credenciales inválidas con error visible, login
válido que llega al panel, una venta registrada de punta a punta, y esa venta
apareciendo en el reporte del día.

S3. **Los e2e nunca escriben en producción.** El runner corre contra una base
local y se niega a arrancar si `DATABASE_URL` apunta a otro host. Es la
condición que protege el `.env` real del repo, que hoy apunta a Supabase de
producción.

S4. **Repetible.** La suite siembra la base antes de correr y una segunda
corrida no rompe por datos que dejó la primera.

S5. **Documentado.** El README explica cómo correr los e2e localmente y qué
hace el pipeline.

## Tasks

- **T1 — Playwright, config y guard de base local.** `@playwright/test` como
  devDependency, `playwright.config.ts` con `webServer` sobre el build de
  producción, script `test:e2e` que valida el host de la base, migra y siembra
  antes de correr. Specs: S3, S4. Ruta: inline (alto riesgo: delivery/entorno).
  Hecho. `migrate reset` quedó descartado: Prisma lo bloquea cuando lo invoca un
  agente y no corresponde pedir consentimiento en cada corrida. En su lugar,
  `scripts/e2e.mjs` crea y vacía `caja_e2e` por SQL directo, con dos guardas:
  host local y nombre terminado en `_e2e`. Commit: `d64fefc`.
- **T2 — Specs e2e.** `e2e/auth.spec.ts`, `e2e/venta.spec.ts` y el helper de
  login. Specs: S2. Ruta: inline. Hecho: 4 pruebas, verdes. Commit: `d64fefc`.
- **T3 — Pipeline.** `.github/workflows/ci.yml` con job de checks y job de e2e
  con Postgres de servicio. Specs: S1. Ruta: inline (alto riesgo: delivery).
  Hecho. Commit: `2bb4a7b`.
- **T4 — Cierre documental.** README: sección de verificaciones automáticas y
  estado actualizado. Specs: S5. Ruta: inline. Hecho: secciones «E2E con
  navegador» e «Integración continua». Commit: `2bb4a7b`.

## Cortes de revisión

La rama `chore/ci-e2e` son 593 líneas propias en dos commits, por encima del corte
de ~400. El límite quedó acá: `d64fefc` es el arnés de e2e más sus specs (lo que
hay que leer para creer que los tests prueban algo) y `2bb4a7b` es el pipeline y
su documentación. Se pueden revisar o publicar por separado; ninguno depende del
contenido del otro más allá del script `test:e2e` que ya existe en el primero.

## Log

L1 — «bueno continuamos, ya nos queda poco con este proyecto podria decir que
casi esta cerrado […] te comento todo esto pero primero enfoquemonos en ver que
falta de este proyecto y cerremos luego veré que hacer.»

L2 — Elección de la opción tres del cierre: «CI + e2e con navegador — Lo
anterior más Playwright (o chrome-devtools-mcp para que yo maneje el navegador):
login, venta y reporte contra un entorno de prueba. Es trabajo más largo y suma
dependencias de dev.»

L3 — Verificación del estado previo: T1–T9 con commit, `L25` sin pendientes,
árbol limpio, `main` == `origin/main`, `/login` de producción respondiendo 200,
sin `.github/` en el repo. Lo único ausente era CI y verificación de navegador.

L4 — Implementación y primera corrida real. Dos obstáculos, ninguno del código de
la aplicación.

El primero: `prisma migrate reset --force` fue **bloqueado por Prisma**, que
detecta cuando un agente de IA ejecuta una acción destructiva y exige
consentimiento explícito por variable de entorno. No se pidió: se rediseñó. La
base de los e2e es ahora `caja_e2e`, que el runner crea y vacía por SQL directo
(`DROP SCHEMA public CASCADE`), aplica migraciones y siembra. Dos guardas la
protegen: el host tiene que ser local y el nombre tiene que terminar en `_e2e`.
Ninguna corrida toca la base de desarrollo ni la de producción.

El segundo: Chromium no arrancaba por librerías de sistema ausentes
(`libnspr4`, `libnss3`, `libasound2`). Se resolvió instalándolas con `apt`; el
primer intento con `--with-deps` falló por un `.deb` corrupto del mirror
(`mesa-libgallium`, `Hash Sum mismatch`), que no era necesario para headless.

La primera corrida dio **2 de 4 verdes**, y los dos fallos eran defectos de los
tests, no de la app: `getByRole('alert')` matcheaba también el announcer de ruta
de Next (`__next-route-announcer__`) — se filtró por texto —; y la aserción del
reporte miraba la fila 1 de la tabla, que es el día más viejo de un rango de
siete días, no hoy. Se reemplazó por el monto de la venta en cualquier celda y el
resumen del período. Segunda corrida: **4 de 4**.
