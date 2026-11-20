# Evals del asistente

Casos versionados que prueban el asistente contra `/api/v1`, no contra prosa: cada
caso declara el pedido, el fixture que reproduce, las tool calls esperadas y el
estado esperado en la base (una `Venta`, el stock exacto, el `MovimientoStock`).

- `cases/*.json` — un caso por comportamiento. Los nombres de campo son técnicos
  (inglés); el pedido y los nombres de producto son datos del usuario (español).
- `fixtures/*.json` — respuestas del modelo en el formato OpenAI-compatible de GLM
  (`choices[].message`, `usage`, `tool_calls`), un bloque de respuestas por intento.

**Los fixtures de este repo son escritos a mano, no capturados de una llamada real:
la primera corrida live los reemplaza.** Hasta entonces prueban el harness (elección
de tool, argumentos, topes, idempotencia, efectos), no el modelo.

## Cómo se corren

```bash
DATABASE_URL="postgresql://caja:caja@localhost:5433/caja_test?schema=public" npm run evals
```

Offline es el nivel por defecto: fixtures + transporte en proceso contra los Route
Handlers, sin red, sin servidor, sin costo y sin secretos. Recorre los nueve casos,
imprime una fila por caso (resultado, tool calls, tokens de entrada y salida,
latencia) y una fila total; sale con código 1 si alguno falla.

```bash
npm run evals -- --live
```

Live corre los mismos casos contra el modelo real. Necesita
`ASISTENTE_MODELO_API_KEY`; si falta, imprime una línea de skip y sale 0.

La base tiene que terminar en `_test`: el corredor trunca tablas entre casos y se
niega a tocar cualquier otra (misma regla que `src/test/guard.ts`). Sólo escribe su
propia semilla: un usuario, un token con scopes acotados y los productos del caso.
