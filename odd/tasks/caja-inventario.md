# caja-inventario

Primer proyecto de portfolio de Dario: sistema chico de caja + inventario con núcleo
relacional real en PostgreSQL. Gap primario: **SQL**. Stack: Next.js + TypeScript +
Prisma + PostgreSQL + Vitest. Vive en `~/projects/caja-inventario/` (WSL, ext4).

## Specs

**S1 — Un solo gap primario: SQL.** El proyecto cubre SQL como gap primario; tests y
debug son la capa de verificación, no un segundo proyecto.
> "la idea era hacer 1 y no los 3 juntos en 1"

**S2 — Login simple, un rol.** Hay autenticación con sesión; un único rol de usuario.
Sin multi-tenant, sin roles diferenciados, sin invitaciones.

**S3 — Deployado desde el principio.** El diseño contempla producción desde el inicio:
variables de entorno, runtime Node (no edge) para auth, URL de base poolada. La
plataforma concreta se confirma al llegar a T7 con las cuentas de Dario.

**S4 — Identidad de los commits.** Todos los commits se firman como
`Dario Mercado <darioezequielm11@gmail.com>`, configurado de forma local al repo.

**S5 — Modelo de datos aprobado.** Entidades: `producto`, `movimiento_stock`, `venta`,
`linea_venta`, `pago`, `usuario`. El dinero se guarda en **centavos enteros**, nunca en
punto flotante.

**S6 — El corazón del proyecto es una transacción.** Registrar una venta descuenta stock
dentro de una transacción de base de datos y **no puede dejar stock negativo**, ni
siquiera con dos ventas simultáneas sobre el mismo producto.

**S7 — Reportes con SQL real.** Tres reportes: ventas por día, top productos, caja del
día. Se resuelven con agregaciones y joins (`GROUP BY`, `SUM`, `COUNT`), no en memoria
de la aplicación.

**S8 — UI acotada.** Tres pantallas funcionales (productos, registrar venta, reporte)
más login. No hay panel de administración genérico ni gestor de usuarios.

**S9 — Entorno.** El código vive en el filesystem de Linux (`~/projects/`). PostgreSQL
corre en Docker en desarrollo. Se usa `npm` de Linux: **nunca** `pnpm`, que en esta
máquina resuelve a un binario de Windows.

**S10 — Verificable en 10 minutos.** Existe un recorrido de demo que muestra el sistema
completo —login, venta, reporte— en una sola grabación de 10 minutos o menos.

## Tasks

- **T1 — Andamiaje y entorno.** Next.js + TS + Tailwind + Prisma + Vitest; Docker Compose
  con PostgreSQL; `.env.example`; scripts `db:up`, `db:down`, `db:migrate`, `db:seed`,
  `test`. Specs: S1, S9. Ruta: inline. Commit: `478ee96`
- **T2 — Modelo de datos y migración.** Schema Prisma de las seis entidades con constraints
  (stock no negativo donde corresponda, FKs, precios en centavos); migración inicial y
  seed con datos de demo. Specs: S5. Ruta: inline. Commit: `478ee96`
- **T3 — Núcleo transaccional.** Servicio de venta: cálculo de totales en centavos,
  descuento de stock dentro de transacción con bloqueo de fila, registro de pago.
  Tests de concurrencia (dos ventas simultáneas, stock insuficiente). Specs: S6. Ruta:
  inline. Commit: `a1fdbb9`
- **T4 — Reportes SQL.** Las tres consultas de S7 como servicios con tests sobre datos
  sembrados; bordes de fecha y zona horaria. Specs: S7. Ruta: inline. Commit: `0d06d16`
- **T5 — Autenticación.** Login de un rol: hash de contraseña, cookie de sesión
  `httpOnly`, protección de rutas, cierre de sesión. Tests. Specs: S2, S3. Ruta: inline
  (alto riesgo: seguridad). Commit: `187885a` (primitivas), `13fae71` (handlers).
  La protección de rutas se mueve a T6: sin página que proteger, un guard sería
  código muerto. El cierre de sesión sí quedó en T5.
- **T6 — UI.** Login + tres pantallas consumiendo los servicios. Specs: S8. Ruta: inline.
  Commit: `2022870`
- **T7 — Deploy.** PostgreSQL gestionado + hosting de Next.js, variables de entorno,
  migración en producción, smoke test contra la URL real. Specs: S3. Ruta: inline.
  Commits: `4d547d9` (trayecto a producción), `39a7a25` (cliente Prisma en el build),
  (cierre en este commit). Deployado en `caja-inventario-sage.vercel.app`.
  Verificado: 4 rutas 307 sin fuga anónima, login 200, 3 pantallas 200 con datos, venta
  real (2 x AZU-001, ARS 3.600,00) con stock 60→58, pago, línea y movimiento coherentes,
  y reporte del día mostrando el total.
- **T8 — Documentación y demo.** README con arquitectura y decisiones técnicas, más el
  recorrido de 10 minutos. Specs: S10. Ruta: inline. Commit: `688fba8`

## Log

**L1** — Pedido original de Dario, textual:
> "ahora estoy viendo si podriamos empezar un proyecto para portfolio o si evaluamos mas propuestas."

**L2** — Autorización del proyecto y del alcance, textual:
> "igual ahora para empezar el portfolio vamos a empezar un proyecto con los casos que me preguntaste hoy de acuerdo a mis gaps y me dijiste que la idea era hacer 1 y no los 3 juntos en 1, bueno de ahi vamos a elegir uno para empezar el portfolio y probar esta mantequita llamada gentle shell."

**L3** — Elección del proyecto: opción "Caja + inventario" (recomendada). Gap primario SQL.

**L4** — Decisiones de alcance tomadas por Dario: login simple de un rol (no sesión
única sin login); deployado desde el principio (no local-only); commits firmados con
`Dario Mercado <darioezequielm11@gmail.com>`.

**L5** — Hallazgo de entorno: en este WSL `pnpm` resuelve a
`/mnt/c/Program Files/nodejs/pnpm`, un binario de Windows. Se adopta `npm` de Linux
para el proyecto. `psql` no está instalado: se usa `docker exec` contra el contenedor.

**L6** — Prisma 7 rompe compatibilidad en tres puntos: `url` ya no va en el `datasource`
(se movió a `prisma7.config.ts` para migrar y al driver adapter para el runtime), el
cliente se genera como fuente TS en `generated/prisma` con entrada `client.ts` (no hay
`index`), y el bloque `"prisma"` de `package.json` se ignora en silencio: el seed se
declara en `migrations.seed` del config. `prisma` publica además un RC como `latest`
(`8.0.0-rc.34`): se fijó el par estable `prisma`/`@prisma/client` en `7.10.1`.

**L7** — `npm install` falla con `ERR_SSL_CIPHER_OPERATION_FAILED` (Node 24 + OpenSSL
3.5.8) al abrir conexiones TLS en paralelo. Se resuelve con `--maxsockets=1`. No se
commitea `.npmrc`: es una particularidad de esta máquina, no del proyecto. `tail`
además se comía el exit code de la tubería hasta agregar `set -o pipefail`.

**L8** — Los tests usan una base separada `caja_test` con un guard que aborta si el
nombre de la base no termina en `_test`, porque el setup trunca tablas entre casos.

**L9** — Verificación por mutación: al quitar `FOR UPDATE` de la consulta, el test de
concurrencia falla (las dos ventas se completan, stock negativo). Confirma que el test
no es vacío y que el bloqueo de fila es lo que sostiene S6.

**L10** — Commits: `478ee96` foundation (T1+T2) en `main`; `a1fdbb9` T3 en
`feat/venta-transaccional`.

**L11** — Zona horaria: los reportes calculan los límites del día en
`America/Argentina/Buenos_Aires`, no en UTC. Verificado por mutación: cambiando la
constante a `UTC`, el test de la venta de las 23:30 falla. Sin ese manejo, la caja diaria
no cierra porque las ventas de la última hora caen en el día siguiente.

**L12** — El writer de ODD (`gentle-ai-worker`) falló dos veces con "Writer repository
preparation was unavailable or its session/target changed", con el árbol limpio y un
solo worktree. Se implementó T4 inline como fallback declarado.

**L13 — Límite de slice.** El slice 1 (`feat/venta-transaccional`) acumuló 694 líneas
autoradas en 3 commits (T3 + T4 + docs), por encima del objetivo de ~400. T3 y T4 son
una unidad coherente (la venta produce los datos que los reportes agregan) y separarlas
dejaría la mitad de los reportes sin datos que reportar. Estrategia: T5-T8 van en un
slice nuevo `feat/auth-ui`, apilado sobre este, para que el review no reciba una sola
entrega de mil líneas.

**L14 — Verificación independiente de T5 (commit `187885a`).** El verificador encontró
sin defecto de seguridad: 21 pruebas de bypass rechazadas (firma ajena, `exp` extendido
sobre firma real, token de 3 partes, secreto corto o ausente) y confirmó por mutación que
el test de falsificación no es vacío. Reportó en cambio: (a) el spec de T5 pedía
protección de rutas y cierre de sesión y sólo existían las primitivas; (b) un bug real —
el email se normalizaba sólo al leer, así que una fila con mayúsculas nunca podría
loguear; (c) un test débil que pasaba por la razón equivocada. Corregido: búsqueda
insensible a mayúsculas, handlers de login/logout, y los probes del verificador agregados
(retirada de expiración sobre firma real, expiración exacta, lectura sin secreto).
Advisories no bloqueantes aceptados sin cambios: sin rate-limit, sin revocación de sesión,
`bcrypt` trunca a 72 bytes.

**L15 — Fuga de datos por el guard en el layout.** Verificado con un pedido anónimo:
`GET /productos` devolvía **200 con el catálogo completo** en el cuerpo, además de
`NEXT_REDIRECT`. Causa: Next renderiza layout y página en paralelo, así que cuando el
guard del layout llama a `redirect()` la consulta a la base ya corrió y los datos ya se
streamearon. Ningún test unitario lo detectaba. Corregido con `src/middleware.ts`, que
corre antes del render: ahora las tres rutas protegidas devuelven 307 sin datos.

**L16 — Dos runtimes para firmar.** El middleware corre en Edge, donde no existe
`node:crypto`. `sesion-edge.ts` reimplementa la verificación con Web Crypto y un test
cruza las dos implementaciones (`firmarSesion` con Node → `leerSesionEdge` con Web
Crypto). Sin ese test, un cambio de formato en un lado dejaría el login emitiendo tokens
que el guard rechaza, con síntoma "no anda el login" a kilómetros de la causa.

**L17 — Next 16 y cacheComponents.** `export const dynamic = 'force-dynamic'` está
prohibido y el prerender falla en cualquier ruta que lea `cookies()`. Las rutas
bloqueantes se declaran con `export const instant = false`, que es lo correcto en una app
autenticada: cada request necesita la sesión.

**L18 — Límite de slice, otra vez.** El slice 2 (`feat/auth-ui`) acumuló ~1670 líneas
autoradas. T5 y T6 no se separaron porque el guard de rutas sólo tiene sentido donde hay
páginas que proteger: sin UI, habría sido código muerto. Queda registrado como desvío y
no como decisión cómoda.

**L19 — Camino a producción corregido.** Tres defectos del camino crítico de T7: (a) el
README indicaba `migrate dev` contra producción, que es interactivo y puede proponer un
`reset`; se agrega `db:migrate:prod` (`prisma migrate deploy`), verificado contra la base
local con exit 0; (b) `.gitignore` ignoraba `.env.example` a través de `.env*`, así que el
`cp .env.example .env` del README no podía funcionar — se agrega la excepción, y los dos
archivos los crea Dario a mano porque la política de seguridad del agente bloquea
escrituras sobre `.env*`; (c) el README prohibía sembrar producción, pero el seed es
idempotente y es lo único que crea el usuario de login: sin él el deploy queda sin acceso.
Decisión de deploy: proyecto Supabase nuevo `caja-inventario` (no reutilizar
`ecommerce-futbol`, para no compartir credenciales entre dos apps), `DATABASE_URL` poolada
(6543) y `DIRECT_URL` directa (5432), con Session pooler como respaldo si la directa
resuelve sólo a IPv6 en WSL.

**L20 — Primer deploy y sus tres piedras.** El deploy real (Supabase + Vercel) falló dos
veces por causas distintas que ningún test local podía atrapar. (a) `next build` en un
clone limpio muere con `module-not-found` en `src/lib/db.ts`: el cliente de Prisma 7 se
emite como fuente TS en `generated/`, que git ignora, y sólo lo generaba una corrida manual
en esta máquina — la cura es `postinstall: prisma generate`, verificado borrando
`generated/` y compilando. (b) La conexión directa de Supabase es IPv6 y `db.<ref>
.supabase.co` no resuelve desde WSL (ENOTFOUND en A y AAAA), así que `DIRECT_URL` pasa al
Session pooler (5432), que sí publica IPv4; el transaction pooler (6543) queda para la app.
(c) El build de Vercel necesita `DATABASE_URL` porque Next importa cada route module al
recolectar configuración y `src/lib/db.ts` valida la variable al importarse. La decisión de
no hacer perezoso al cliente fue deliberada: fallar en el build nombrando la variable es
mejor que desplegar verde y romper con un timeout en la primera venta.

*Smoke real contra producción*: 4 rutas 307 sin cuerpo para anónimos, login 200 con cookie
firmada en Node y validada en el middleware Edge, 3 pantallas 200 con datos del pooler, y
una venta de 2 x AZU-001 (ARS 3.600,00) que dejó stock 60→58, `Pago` por el total,
`MovimientoStock` SALIDA 2 con `stockLuego` 58 y el reporte del día cuadrando. Advisory
abierto: Next 16 deprecó `middleware.ts` en favor de `proxy.ts` (todavía funciona).
