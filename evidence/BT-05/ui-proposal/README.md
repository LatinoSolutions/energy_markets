# BT-05 — propuesta visual del control "Run backtest" (gate de Bru)

Fuente del gate: PLAN_STATUS.md, fila BT-05 (owner request 25-sep-2026): "un solo control
en la pantalla de Backtests (1 boton de ejecutar + el estado del job en la misma zona),
dentro del diseno visual ya aprobado en UI-03; sin paneles ni formularios extra. Gate:
antes de implementar la UI, entregar a Bru una propuesta visual (captura) y esperar su
aprobacion".

Estado: **APROBADA CON CAMBIOS** por Bru, P-009 (2026-09-25), sin captura nueva. Cambios
pedidos, ya aplicados en el código (tests "BT-05 P-009" en `test/backtest-jobs/bt-05.test.mjs`):
1. Línea de estado en frase completa, sin notación ni `NONE` (la arma el backend,
   `src/backtest-jobs/display.mjs`).
2. Mientras corre: `Running · started 15:00 UTC · 3 min elapsed`, con inicio y tiempo
   transcurrido publicados por el backend.
3. Franja superior: `OPERATOR INTERFACE · runs simulated backtests only · no real trading
   from this UI · unknown stays UNAVAILABLE / NOT CLOSED, never a value`.

`src/ui/server.mjs` sirve el control en `/backtests` cuando hay ejecutor configurado.
Las capturas de abajo son las de la propuesta original: muestran la línea en el formato
anterior (`SUCCEEDED · <ISO> · CURRENT · —`) y la franja anterior; no reflejan los 3 cambios.

## Qué se propuso (antes de P-009)

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

## Franja superior

Decidido en P-009 punto 3 (ver arriba).
