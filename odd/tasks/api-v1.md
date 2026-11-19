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
  Ruta: inline (alto riesgo: seguridad).
- **T2 — Autenticación y autorización de la API.** Resolución del bearer token,
  chequeo de scope por operación, y clamp común de errores. Tests de bypass: token
  ausente, hash mal, expirado, revocado, scope insuficiente. Specs: S3, S4, S7.
- **T3 — Rate limit.** Bucket persistido por token, ventana y `Retry-After`. Test de
  dos instancias lógicas sobre la misma tabla. Specs: S5.
- **T4 — Endpoints de productos.** Listar/leer/crear/editar + ajuste de stock,
  delegando en los servicios existentes. Tests por endpoint, incluido el 403 de
  escritura con token de lectura. Specs: S1, S2, S4, S11.
- **T5 — Ventas y reportes.** `POST /ventas` con `Idempotency-Key`, GET de venta y
  los tres reportes. Tests: reenvío idéntico (200, sin segundo descuento), clave
  reusada con otros datos (409), stock insuficiente (409/422 con el disponible).
  Specs: S1, S2, S6, S11.
- **T6 — OpenAPI y docs.** Schemas Zod compartidos, documento generado, endpoint y
  página de documentación. Specs: S8.
- **T7 — README y `curl`s.** Emisión de token, ejemplos ejecutables, límites y
  decisiones. Specs: S10.
- **T8 — Cierre de la etapa.** Suite completa, `tsc`, `eslint`, `build` y una corrida
  real contra la app local con dos tokens distintos. Specs: S9.

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
