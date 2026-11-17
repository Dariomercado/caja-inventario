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
  `test`. Specs: S1, S9. Ruta: inline. Commit: _(pendiente)_
- **T2 — Modelo de datos y migración.** Schema Prisma de las seis entidades con constraints
  (stock no negativo donde corresponda, FKs, precios en centavos); migración inicial y
  seed con datos de demo. Specs: S5. Ruta: inline. Commit: _(pendiente)_
- **T3 — Núcleo transaccional.** Servicio de venta: cálculo de totales en centavos,
  descuento de stock dentro de transacción con bloqueo de fila, registro de pago.
  Tests de concurrencia (dos ventas simultáneas, stock insuficiente). Specs: S6. Ruta:
  inline. Commit: _(pendiente)_
- **T4 — Reportes SQL.** Las tres consultas de S7 como servicios con tests sobre datos
  sembrados; bordes de fecha y zona horaria. Specs: S7. Ruta: inline. Commit: _(pendiente)_
- **T5 — Autenticación.** Login de un rol: hash de contraseña, cookie de sesión
  `httpOnly`, protección de rutas, cierre de sesión. Tests. Specs: S2, S3. Ruta: inline
  (alto riesgo: seguridad). Commit: _(pendiente)_
- **T6 — UI.** Login + tres pantallas consumiendo los servicios. Specs: S8. Ruta: inline.
  Commit: _(pendiente)_
- **T7 — Deploy.** PostgreSQL gestionado + hosting de Next.js, variables de entorno,
  migración en producción, smoke test contra la URL real. Specs: S3. Ruta: inline.
  Commit: _(pendiente)_
- **T8 — Documentación y demo.** README con arquitectura y decisiones técnicas, más el
  recorrido de 10 minutos. Specs: S10. Ruta: inline. Commit: _(pendiente)_

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
