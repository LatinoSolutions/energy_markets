# BT-05 — propuesta visual del control "Run backtest" (gate de Bru)

Fuente del gate: PLAN_STATUS.md, fila BT-05 (owner request 25-sep-2026): "un solo control
en la pantalla de Backtests (1 boton de ejecutar + el estado del job en la misma zona),
dentro del diseno visual ya aprobado en UI-03; sin paneles ni formularios extra. Gate:
antes de implementar la UI, entregar a Bru una propuesta visual (captura) y esperar su
aprobacion".

Estado: **PROPUESTA, NO APROBADA.** Mientras no conste la aprobación de Bru, la app no
sirve el control (`src/ui/server.mjs` no lo inserta; test "BT-05 gate UI"). El endpoint
backend `/api/backtest-jobs` y la tool MCP sí funcionan.

## Qué se propone

- Zona: cabecera de la página Backtests, a la derecha del título, junto a las etiquetas de brazos.
- Un botón `Run backtest` (clase `.btn` de UI-03) y debajo una sola línea de estado copiada
  del backend: `status · finishedAt · vigencia (CURRENT/SUPERSEDED/NONE) · failure.code`.
- Mientras corre: botón deshabilitado y la línea muestra `RUNNING`; se refresca sola cada 3 s.
- Si el mismo commit + datos + parámetros ya tienen resultado, el backend no recalcula y
  el control muestra `REUSED`.
- Sin tarjeta, tabla, formulario ni campos editables.

## Capturas

Los valores del job en las capturas son **ILUSTRATIVOS** (run_id de ceros): no son runs reales.

| Archivo | Estado | sha256 |
|---|---|---|
| `backtests-idle.png` | último run exitoso y vigente | `d78dfac698a7e2d6a29df2db8f0f40bc26a8fd986165c16365da06828936df00` |
| `backtests-running.png` | job en curso | `63b1dd9899d2d48be3fe35874d119d46e7d3b156204f36ab403230df1efbdf33` |

Regenerar: `node evidence/BT-05/ui-proposal/make-proposal.mjs` escribe `backtests-{idle,running}.html`;
la captura se tomó con Chromium headless (Playwright) a 1440×760.

## Punto para decidir junto con la aprobación

La franja superior de UI-03 dice "OPERATOR INTERFACE · read-only · … · no real execution from
this UI". Con el botón, la UI deja de ser sólo lectura (lanza un backtest; no ejecuta
operaciones reales). No se cambió ese texto: es parte de lo que Bru aprueba.
