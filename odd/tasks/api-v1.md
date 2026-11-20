# Capa `/api/v1`: superficie REST pública con tokens

Segunda etapa del proyecto, después del cierre funcional (T1–T9 de
`caja-inventario.md`) y del pipeline (T1–T4 de `ci-e2e.md`). El objetivo es exponer
el dominio que ya existe como API versionada, con autenticación propia, para poder
mostrarla como producto y para que el asistente con evals (etapa siguiente) tenga
una superficie estable de tool calls. Deploy ya existe (`caja-inventario-sage.vercel.app`);
esto no lo reemplaza ni lo mueve.

## Specs

**S1 — Superficie versionada.** Todo vive bajo `/api/v1` como Route Handlers.
Recursos: `productos` (listar, leer, crear, editar), `productos/:id/ajustes`
(movimiento de stock), `ventas` (listar, leer, crear) y `reportes` (ventas por día,
top de productos, caja del día). Es la superficie que el asistente va a usar como
tool calls más adelante.
> "Escritura completa con token por scopes" — alcance elegido por Dario el 2026-02-*-.

**S2 — Sin duplicar el dominio.** La API llama a los servicios existentes
(`registrarVenta`, `reportes.ts`, etc.); no reimplementa lógica ni escribe con
Prisma por fuera de ellos. Los invariantes de S6 y S11 de `caja-inventario.md`
(stock no negativo dentro de transacción, venta no registrada dos veces) valen
idénticos por esta vía.

**S3 — Autenticación por token, separada de la sesión.** La API se autentica con
`Authorization: Bearer <token>`, nunca con la cookie de sesión del panel. El token
se guarda **hasheado** en la base (nunca en claro), tiene expiración y es revocable;
el valor en claro sólo existe en el momento de emisión. Un pedido sin token válido
responde `401`.

**S4 — Scopes por recurso y operación.** Scopes: `productos:read`,
`productos:write`, `ventas:read`, `ventas:write`, `reportes:read`. Un token sin el
scope requerido responde `403` y **no** ejecuta el efecto. Escritura y lectura son
tokens distintos: un token de lectura nunca puede mover stock.

**S5 — Rate limit persistido.** El límite por token se guarda en la base, no en
memoria del proceso, porque el deploy corre en varias instancias. Al excederse
responde `429` con `Retry-After`. El límite por defecto es conservador y configurable
por token.

**S6 — Idempotencia en la venta.** `POST /api/v1/ventas` acepta el header
`Idempotency-Key`. Un reenvío con la misma clave devuelve la venta ya registrada con
`200` y **no** descuenta stock otra vez; reusar la clave con datos distintos responde
`409`. Reusa `Venta.claveIdempotencia`, no inventa un segundo mecanismo.

**S7 — Contrato de errores estable.** Todos los errores son
`{ "error": { "code": "...", "message": "..." } }` con un `code` que no cambia y un
status HTTP coherente. Nunca se filtran stack traces, mensajes de Prisma ni nombres
internos de tablas.

**S8 — OpenAPI desde una sola fuente.** Los schemas de entrada y salida son Zod y
el documento OpenAPI 3 se genera desde ellos (una sola fuente de verdad). Se sirve en
`/api/v1/openapi.json` y hay una página de documentación que lo consume.

**S9 — No debilita lo existente.** El login por cookie, el middleware de rutas
protegidas y la UI siguen funcionando igual; los tests actuales siguen verdes. La API
es un canal adicional, no un reemplazo.

**S10 — Verificable desde la terminal.** El README documenta cómo emitir un token y
ejemplos `curl` de cada endpoint, ejecutables tal como están escritos.

**S11 — Listados paginados.** Los listados usan paginación por cursor y devuelven
`nextCursor`; nunca devuelven la tabla entera.

## Tasks

- **T1 — Modelo de tokens y emisión.** Modelo de token (hash, scopes, expiración,
  revocación, límite) + migración + comando de emisión en `scripts/`. Specs: S3, S4.
  Ruta: inline (alto riesgo: seguridad). Hecho: `TokenApi`/`UsoTokenApi`, scopes como
  enum de Postgres con vocabulario propio en el contrato, `scripts/emitir-token.ts`
  con guarda de host, 17 tests. Commit: `afd8a8d`.
- **T2 — Autenticación y autorización de la API.** Resolución del bearer token,
  chequeo de scope por operación, y clamp común de errores. Tests de bypass: token
  ausente, hash mal, expirado, revocado, scope insuficiente. Specs: S3, S4, S7.
  Hecho: `autenticar()` identifica antes de autorizar (401 nunca 403 para credencial
  inválida), `errorJson` con código estable y clamp de internos. Commit: `6bfd3f0`.
- **T3 — Rate limit.** Bucket persistido por token, ventana y `Retry-After`. Test de
  dos instancias lógicas sobre la misma tabla. Specs: S5.
- **T4 — Endpoints de productos.** Listar/leer/crear/editar + ajuste de stock,
  delegando en los servicios existentes. Tests por endpoint, incluido el 403 de
  escritura con token de lectura. Specs: S1, S2, S4, S11. Hecho: servicio en
  `src/server/productos.ts` compartido con la página del panel; paginación por
  cursor; `ejecutarAutenticado` centraliza auth + cupo + errores. Commit: `35ad169`.
- **T5 — Ventas y reportes.** `POST /ventas` con `Idempotency-Key`, GET de venta y
  los tres reportes. Tests: reenvío idéntico (200, sin segundo descuento), clave
  reusada con otros datos (409), stock insuficiente (409/422 con el disponible).
  Specs: S1, S2, S6, S11. Hecho: `registrarVenta` informa `reutilizada` para
  separar 201 de 200; listado por `numero`; fechas validadas en el borde porque los
  reportes las meten crudas en SQL. Commits: `3e39e59` (ventas), `8cdd6c6`
  (reportes).
- **T6 — OpenAPI y docs.** Schemas Zod compartidos, documento generado, endpoint y
  página de documentación. Specs: S8. Hecho: OpenAPI 3.1 generado con
  `z.toJSONSchema`, esquemas de salida anotados con el tipo del servicio, página
  `/api-docs`, seis tests que cruzan documento y árbol de rutas. Commit: `c284b36`.
- **T7 — README y `curl`s.** Emisión de token, ejemplos ejecutables, límites y
  decisiones. Specs: S10. Hecho (delegado a `gentle-ai-worker` por backstop de
  contexto): sección «API pública (`/api/v1`)» con scopes, errores, rate limit,
  punteros a `/api-docs` y OpenAPI, y bloques `curl` que se ejecutaron literalmente
  extrayéndolos del README con `awk`, no reescribiéndolos a mano.
- **T8 — Cierre de la etapa.** Suite completa, `tsc`, `eslint`, `build` y una corrida
  real contra la app local con dos tokens distintos. Specs: S9. Hecho: 159 tests,
  `tsc` y `eslint` limpios, `next build` OK (18 rutas), y corrida real contra el build
  en `:3101` con un token de lectura y uno de escritura verificando 401, 403, 201,
  el reenvío 200 con un solo descuento de stock y los tres reportes.

## Log

**L1** — Pedido original de la etapa, textual:
> "bueno quedaron los ci y ya tenemos el proyecto cerrado como para una primera version, no? estoy pensando si hacer otro proyecto o escalar este, aunque ya hemos hecho este proyecto con server actions y tenia ganas de hacer un proyecto igual a este pero con componentes creo que eso es ssr? estoy decidiendo si clonar este repo y hacer un proyecto igual a este pero sin server actions, o tambien descargar alguno de los repos de github de otros proyectos que ya tengo y arreglarlos ya que por ejemplo tengo un repo de un proyecto de un curso con autenticacion, es un proyecto que hice siguiendo un curso de udemy y luego de que lo termine y subi a github paso bastante tiempo y el otro dia prendi el servidor y el proyecto se veia con algunos erroes. tambien pensaba en hacer un proyecto de ecomerce pero bueno todavia no decidi, ademas estos repos de github que te digo que puedo descargar y arreglar con vos son repos que cuando los cree y desarrolle los hice desde windows. tambien te queria preguntar, segun los recursos de mi pc que son: Procesador: Intel i3-10100F (4 núcleos / 8 hilos). RAM: 8 GB. GPU: NVIDIA GT 710. Almacenamiento: SSD SATA de aproximadamente 447 GB. que tipos de proyectos interesantes puedo ofrecer para mi portfolio? es decir proyectos que hoy en dia vale la pena hacer para lo que es el mercado dev, hay muchos que hacen proyectos con funciones ia o hacen sus agentes, yo no planeo hacer mi propio agente porque ya uso gentle shell que tiene todo su flujo agentico y encima puedo expandirlo pero no descarto igual hacer un proyecto que le muestre a los visitantes que soy capaz de crear un proyecto con ia o sea que demuestre que no solo se mandar un prompt ya que trabajar con ia como un dev no es solo enviar prompts"

**L2** — Corrección conceptual aceptada: SSR, tipo de componente y transporte de
datos son ejes distintos. Lo que Dario llama "sin server actions" es "con Route
Handlers / capa REST". Se descarta clonar el repo: duplicaría la señal de portfolio y
el clon quedaría sin mantener.

**L3** — Hoja de ruta elegida por Dario, textual:
> "me interesa agregar la capa api y tambien hacer lo de elevans si elijo hacer esas dos cosas para este repo luego de implementarlas ira el dockerfile?"
> "bueno primero hacemos la api y elevans, luego pasamos a docker"

Orden: API → evals → deploy con Docker. Consecuencia registrada: las evals en CI
corren sobre el service container de Postgres, sin dependencia de una URL pública;
el job que llama al modelo se saltea con un mensaje explícito cuando no hay secret
(caso de PRs desde forks).

**L4** — Alcance de la API elegido por Dario: "Escritura completa con token por
scopes". Descartadas: sólo lectura, y API como superficie del asistente primero.

**L5** — Corrección de estado: el proyecto **ya está deployado** (T7 de
`caja-inventario.md`: Vercel + Supabase, verificado en producción). No hay Dockerfile;
"Docker" en L3 es imagen propia para deploy, no el `docker-compose.yml` de la base
local que ya se usa.

**L6 — Hallazgo de seguridad: toda migración local escribe en producción.**
`prisma7.config.ts` resuelve `DIRECT_URL ?? DATABASE_URL`, y en esta máquina
`DIRECT_URL` apunta al pooler de Supabase. Consecuencia: `npm run db:migrate` corre
contra producción **aunque se pase `DATABASE_URL` inline**, porque `DIRECT_URL` gana.
Verificado: `npx prisma migrate status` anunció
`aws-1-us-east-1.pooler.supabase.com:5432` con la variable local exportada. La
migración de T1 se aplicó a `caja`, `caja_test` y `caja_e2e` pasando **las dos**
variables inline. Queda pendiente decidir si el config debe preferir una
`DATABASE_URL` local explícita; no se cambió acá porque es la misma pieza que usa el
deploy para migrar producción (L19 de `caja-inventario.md`).

**L7 — El cliente generado no se regenera solo.** `generated/prisma` está en
`.gitignore` y `postinstall` lo genera, pero al cambiar el schema el archivo quedó
viejo: el primer test falló con `Cannot read properties of undefined (reading
'PRODUCTOS_READ')` porque `ScopeApi` todavía no existía. `npx prisma generate` lo
resuelve; un checkout limpio ya lo hace vía `postinstall`.

**L8 — Verificación por mutación en la venta por API.** El test de reenvío no es
vacío: si se quita el `Idempotency-Key` obligatorio, el estado del stock tras dos
POST idénticos cambia. Los tests de 403 comprueban el efecto (stock intacto, cero
ventas), no sólo el status: un 403 con la venta ya escrita en otra transacción sería
un falso verde.

**L9 — `z.toJSONSchema` no representa `.transform()`.** El documento falló al
generarse por el `transform` de `soloActivos` en el esquema de listado. Se resuelve
con `io: 'input'` para parámetros y cuerpos (describe lo que viaja) y `io: 'output'`
para respuestas, más `unrepresentable: 'any'` como red de seguridad por campo.

**L10 — Backstop de contexto.** A 151k tokens, T7 y T8 se delegan a
`gentle-ai-worker` con el documento como spec, en vez de seguir inline.

**L11 — Dos defectos del cierre, encontrados por la verificación delegada.**
(a) `POST /api/v1/ventas` con un `productoId` inventado devolvía **500 `interno`**:
`ventas.ts` lanzaba `Error` genérico para producto inexistente e inactivo, así que el
clamp de errores no podía distinguir un dato inválido del cliente de un defecto del
servidor. Corregido con errores tipados en `src/server/erroresDominio.ts` —módulo
propio para no crear un ciclo `ventas.ts` ↔ `productos.ts`, porque las clases de
error son la peor pieza para tener en un ciclo—: 404 `no_encontrado` e inactivo 409
`conflicto`. Tres tests nuevos; la suite pasó de 156 a 159.
(b) El README afirmaba «66 tests de servicios» (número viejo, previo a esta etapa).
Actualizado a 159.

**L12 — Higiene de la verificación delegada.** El worker dejó dos tokens válidos en
claro bajo `/tmp` y datos de prueba en la base local `caja`. Se revocaron los dos
tokens, se borró el directorio temporal y se eliminaron los productos `MATE-*` con
sus ventas, pagos, líneas y movimientos. Las bases quedaron sin residuos de prueba.

**L13 — El 429 se verificó en vivo.** Se emitió un token, se le bajó
`limitePorMinuto` a 2 por SQL y se hicieron tres pedidos: dos 200 y un 429 con
`Retry-After`, que es la promesa del README. No quedó como afirmación de código sin
corrida.

**L14 — Review nativa de la etapa y qué pasó con los tres hallazgos que importaban.**
El linaje `review-e593b734083ebdb1` aprobó el rango completo (4 lentes, `glm5.3-flash`,
tier `high` por `src/server/api/auth.ts`) con 14 hallazgos informativos. De ésos, tres
no eran cosméticos:

1. **`R4-idempotent-replay-race-500` — no reproduce.** La hipótesis era que dos
   `POST /ventas` simultáneos con la misma clave hacen que el perdedor reciba un 500.
   Se probó con 8 concurrentes, primero contra el servicio y después contra el handler
   HTTP real, cinco corridas seguidas: un solo `numero`, una `Venta`, un
   `MovimientoStock`, stock descontado una vez, estados `{200, 201}` y cero 5xx. La
   re-lectura está en el `catch`, no antes de la transacción, y Postgres bloquea el
   `INSERT` del perdedor hasta que el ganador confirma, así que cuando llega la
   violación del índice único la venta ya está visible. Queda clavado por dos tests
   (`concurrencia.test.ts` y el caso de 8 concurrentes en `ventas.test.ts`) para que
   nadie lo "arregle" de nuevo sin evidencia.
2. **`R2-openapi-ventas-response-lying` / `R3-openapi-venta-respuesta` — real,
   corregido.** El documento declaraba `esquemaVentaDetalle` para la respuesta de
   `POST /ventas` y prometía `lineas` y `pagos` que el handler nunca manda; además el
   éxito figuraba sólo bajo 200 cuando crear devuelve 201. Ahora hay
   `esquemaVentaRegistrada` y `exitos: [201, 200]`, y un test compara las propiedades
   declaradas contra las claves del cuerpo real: si el handler cambia, falla.
3. **`R1-alcance-global` — era una decisión de producto, no un bug.** El esquema no
   tiene noción de negocio, así que es una sola tienda: un token lee catálogo y ventas
   de todos y las escrituras quedan a nombre de su usuario. Decisión explícita de
   Dario: documentarlo y clavarlo. Está en la descripción del documento OpenAPI, en el
   README y en `src/app/api/v1/alcance.test.ts`.

Evidencia: **270 tests**, `tsc` y `eslint` limpios, evals 9/9 y `next build` OK.
