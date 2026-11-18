# Caja e inventario

Sistema de punto de venta con control de stock: registra ventas, descuenta inventario y
cierra la caja del día. Construido como pieza de portfolio para mostrar trabajo real de
base de datos — transacciones, concurrencia y SQL de reportes — sobre una interfaz acotada.

## Lo que hace

- **Catálogo** con precio y stock, con alerta de stock bajo.
- **Registrar venta** con varias líneas, medio de pago y total calculado en el servidor.
- **Reportes**: ventas por día, productos más vendidos y caja del día por medio de pago.
- **Login** de un rol con sesión firmada.

## Las tres cosas que vale mirar

Si vas a leer sólo un archivo, que sea `src/server/ventas.ts`.

### 1. El stock no puede quedar negativo, ni con concurrencia

Registrar una venta bloquea la fila del producto con `SELECT ... FOR UPDATE` dentro de una
transacción. Dos ventas simultáneas del último ítem se serializan: la segunda ve el stock
ya descontado y se rechaza.

Los bloqueos se adquieren **en orden de id**, no en el orden en que llegan los ítems. Sin
eso, dos ventas con los mismos productos en orden inverso se esperan mutuamente hasta el
timeout: un deadlock que en producción aparece una vez cada tanto y es dificilísimo de
reproducir.

Está verificado por mutación: quitando `FOR UPDATE`, el test de concurrencia falla con las
dos ventas completadas.

### 2. El dinero es entero, siempre

Se guarda en **centavos**. Sumar `0.1 + 0.2` en punto flotante da `0.30000000000000004`, y
una caja que no cierra es un bug de negocio, no de redondeo.

El precio unitario se **congela** en cada línea de venta: si mañana cambia el precio del
producto, las ventas de ayer siguen valiendo lo que valían.

### 3. "Día" significa día local

Los reportes calculan los límites del día en `America/Argentina/Buenos_Aires`, no en UTC.
Una venta de las 23:30 ya pertenece al día siguiente en UTC; sin ese manejo, la caja diaria
no cierra. También verificado por mutación: cambiando la zona a UTC, el test de la venta de
las 23:30 falla.

## Stack

| Pieza | Elección |
| --- | --- |
| Framework | Next.js 16 (App Router) + TypeScript |
| Base de datos | PostgreSQL 16 |
| ORM | Prisma 7 con driver adapter (`@prisma/adapter-pg`) |
| Estilos | Tailwind CSS 4 |
| Tests | Vitest |

## Arquitectura

```
src/
├─ server/            lógica de negocio, sin componentes
│  ├─ ventas.ts       transacción de venta (el corazón)
│  ├─ reportes.ts     las tres consultas de agregación
│  ├─ auth.ts         hash, credenciales, firma de sesión (node:crypto)
│  ├─ sesion-edge.ts  misma verificación con Web Crypto, para el middleware
│  └─ sesion.ts       helpers de sesión del lado servidor
├─ app/
│  ├─ (panel)/        rutas protegidas: layout con guard, productos, ventas, reportes
│  ├─ login/          pantalla de acceso
│  ├─ api/auth/       endpoints de login y logout
│  └─ actions/        server actions
├─ middleware.ts      guard de rutas, corre antes del render
└─ lib/               prisma (singleton), formateo de dinero
```

**Por qué el guard está en `middleware` y no en el layout.** Estuvo en el layout primero, y
fue una fuga de datos: Next renderiza layout y página en paralelo, así que cuando el layout
llama a `redirect()` la consulta a la base ya se ejecutó y el cuerpo de la respuesta ya
llevaba el catálogo. Un pedido anónimo devolvía 200 con los datos. El middleware corre antes
del render, así que ninguna lectura ocurre. Queda en dos capas: el middleware valida firma y
expiración; el layout valida contra la base que el usuario siga activo.

## Datos

```
Usuario ──< Venta ──< LineaVenta >── Producto
              │                          │
              ├──< Pago                  │
              └──< MovimientoStock >─────┘
```

`Producto.stock` es el valor autoritativo y `MovimientoStock` es el libro mayor: cada cambio
queda registrado con `stockLuego`, el stock resultante. Duplicar parece redundancia, pero es
lo que permite bloquear la fila en la transacción y lo que hace el historial reconstruible.

## Correr en local

Requisitos: Docker, Node 20+ y una terminal.

```bash
npm install
cp .env.example .env          # completar DATABASE_URL y SESSION_SECRET
openssl rand -hex 32          # el valor para SESSION_SECRET

npm run db:up                 # PostgreSQL en Docker (puerto 5433)
npm run db:migrate            # aplicar migraciones
npm run db:seed               # datos de demo
npm run dev
```

Hay una tercera variable, `DIRECT_URL`. En local es opcional: si no está, las
migraciones usan `DATABASE_URL` y todo funciona igual. Con un proveedor que expone una
conexión *pooled* deja de ser opcional — ver **Deploy**.

Credenciales de demo: `admin@caja.local` / `caja1234`.

### Tests

```bash
# Requiere una base aparte; el setup aborta si el nombre no termina en _test.
docker exec caja-inventario-db psql -U caja -d caja -c 'CREATE DATABASE caja_test;'
DATABASE_URL="postgresql://caja:caja@localhost:5433/caja_test?schema=public" npm test
```

Los tests truncan tablas antes de cada caso y **abortan si la base no termina en `_test`**:
mejor negarse a correr que borrar datos de desarrollo por accidente.

## Deploy

Un proveedor de Postgres gestionado (Supabase, Neon) expone **dos** cadenas de conexión, y
usar la equivocada falla de forma poco obvia:

| Variable | Qué URL | Para qué |
| --- | --- | --- |
| `DATABASE_URL` | pooled (puerto 6543) | la aplicación en cada request |
| `DIRECT_URL` | directa (puerto 5432) | migraciones, que necesitan locks que el pooler no da |
| `SESSION_SECRET` | — | nuevo `openssl rand -hex 32`, **distinto** al de desarrollo |

Antes del primer deploy hay que crear el esquema en la base de producción. Se usa
`migrate deploy`, **no** `migrate dev`: el segundo es interactivo, puede proponer un
`reset` y está pensado para evolucionar el schema en desarrollo.

```bash
npm run db:migrate:prod     # prisma migrate deploy; toma DIRECT_URL del .env
```

Y después del `migrate deploy` hay que sembrar la base una única vez:

```bash
npm run db:seed
```

El seed es **idempotente** (`upsert`, no borra nada) y es lo que crea el usuario de demo: sin
él no hay con qué loguearse en producción. Las credenciales de demo son públicas a
propósito, porque es un entorno de demostración con datos de demostración.

## Decisiones y por qué

| Decisión | Motivo |
| --- | --- |
| Dinero en centavos enteros | Punto flotante no suma exacto; una caja que no cierra no es un bug cosmético |
| Precio congelado por línea | Los reportes históricos no deben moverse cuando cambia un precio |
| Stock como columna + libro mayor | Permite `FOR UPDATE` y mantiene la historia auditable |
| Bloqueo en orden de id | Evita deadlocks entre ventas con ítems en orden distinto |
| Total calculado en el servidor | El navegador no puede decidir cuánto se cobra |
| Usuario de la venta desde la sesión | Un `usuarioId` del formulario sería atribución falsificable |
| Guard en middleware | Un guard en el layout filtra datos: renderiza en paralelo con la página |
| Sesión firmada con HMAC, no JWT | Sin dependencias, y el formato se audita en 40 líneas |
| `bcrypt` costo 12 | ~300 ms por hash; encarece la fuerza bruta sin molestar al login |
| Hash señuelo si el email no existe | Sin eso, el tiempo de respuesta revela qué cuentas existen |

## Fuera de alcance, a propósito

Multi-tenant, roles múltiples, panel de administración genérico, gestión de usuarios,
facturación electrónica y devoluciones. El objetivo es un sistema chico y completo, no una
plataforma.

## Estado

Funcional en local, con 54 tests. El deploy está pendiente.
