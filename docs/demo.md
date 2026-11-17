# Recorrido de demo — 10 minutos

Guion para grabar o presentar el sistema en vivo. Cada bloque tiene qué hacer y qué decir.
El orden está pensado para que la parte aburrida (login) pase primero y el cierre sea el
reporte, que es lo que un cliente quiere ver.

Antes de empezar: `npm run db:up && npm run db:migrate && npm run db:seed && npm run dev`.

---

## 1. Acceso (0:00 – 1:00)

Abrir `http://localhost:3000` sin sesión. La URL redirige a `/login`.

> "Todo el panel está detrás de sesión. El acceso se valida con un hash bcrypt y la sesión
> es una cookie firmada, así que no se puede falsificar ni editar desde el navegador."

Entrar con `admin@caja.local` / `caja1234`.

**Para mostrar el error:** entrar de nuevo en `/login` después de autenticarse — redirige al
panel en vez de mostrar el formulario otra vez.

## 2. Catálogo (1:00 – 2:30)

Ir a **Productos**.

> "Seis productos de demo con precio y stock. Los que están en cinco unidades o menos se
> marcan en ámbar: es la alerta de reposición."

Señalar un producto de precio conocido. Mencionar que los precios están en centavos.

> "El dinero se guarda en centavos enteros. No es detalle de estilo: sumar precios en punto
> flotante acumula errores y una caja que no cierra es un problema del negocio."

## 3. Venta (2:30 – 5:00)

Ir a **Registrar venta**. Agregar dos productos distintos, subir la cantidad de uno, elegir
medio de pago, registrar.

> "El total que ves acá es informativo. El que se cobra lo calcula el servidor con los
> precios reales, dentro de la transacción. El navegador no decide cuánto se cobra."

Volver a **Productos** y mostrar que el stock bajó.

**El momento clave:** intentar vender más unidades de las que hay.

> "El sistema rechaza la venta y no deja stock negativo. Y esto no es una validación de
> formulario: es un bloqueo de fila en la base, así que funciona aunque dos personas vendan
> el último ítem al mismo tiempo."

Volver a **Productos** para confirmar que el stock no cambió.

## 4. Reportes (5:00 – 8:00)

Ir a **Reportes** con el rango de la última semana.

> "Ventas por día con los días sin movimiento incluidos en cero, top de productos, y la caja
> del día por medio de pago."

Mencionar el detalle que casi nadie implementa:

> "Los días se calculan en horario de Argentina, no UTC. Si uso la fecha UTC, una venta de
> las 23:30 cae en el día siguiente y la caja del día no cierra."

## 5. Cierre (8:00 – 10:00)

**Salir** y volver a entrar. Después intentar abrir `/reportes` sin sesión.

> "Sin sesión, la ruta ni siquiera se renderiza: el guard corre antes. Lo verifiqué con un
> pedido anónimo, porque la primera versión del guard estaba en el layout y filtraba el
> catálogo completo en el cuerpo de la respuesta aunque el navegador redirigiera."

Cerrar con el estado del proyecto: 54 tests, verificación por mutación de las partes
críticas, y las limitaciones conocidas.

---

## Preguntas previsibles

**"¿Funciona con varias cajas a la vez?"** Sí para el stock: la transacción serializa las
ventas del mismo producto. No hay multi-sucursal — está fuera de alcance a propósito.

**"¿Qué pasa si se cae la base en medio de una venta?"** La transacción revierte completa: no
quedan ni la venta, ni las líneas, ni el movimiento de stock.

**"¿Cómo sé que los reportes no mienten?"** Cada consulta tiene tests con datos sembrados y
fechas conocidas, incluida una venta a las 23:30 para el borde de zona horaria.

**"¿Por qué no usaste un framework de autenticación?"** Un rol y una sesión no lo justifican.
Con un solo rol, meter un framework agrega dependencia y superficie de configuración sin
resolver nada que no esté resuelto en 70 líneas auditables.
