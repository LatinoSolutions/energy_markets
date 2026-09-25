# Energy Markets: modo TRADES en el backtest (Gas + Power, Quarterly + Monthly)

Fuente normativa: `docs/canonical/v1_1_1/OWNER_PATCH_TRADES_MODE_2026-09-25.md` (`EM-SPEC-OWNER-PATCH-2026-09-25-03`). Leerlo entero antes de cualquier TR-*.
Tareas `TR-*`: extensiones de producto añadidas por Bru el 25-sep-2026; mismas condiciones que las `UI-*` y `BT-*` de `PLAN_STATUS.md`.

## Goal
Añadir al backtest un segundo modo de observación y ejecución, `TRADES`, para validar las estrategias en la ventana larga que solo cubren los trades; contrastarlo con `TOB` en el puente; y mostrar cada medición en la UI de Backtests. Las 4 misiones: Gas Q, Gas M, Power Q, Power M.

## Non-negotiable semantics
- Alcance completo: cada TR-* cubre las 4 misiones; Power no tiene tarea aparte (Bru, 25-sep). Una tarea no se acepta si deja una misión fuera sin declararlo como bloqueo de data.
- Control TOB = release exploratorio v2 (`operations/exploratory/v2/`). No se reescribe ni se re-corre.
- `src/exploratory/backtest.mjs` y `src/exploratory/comparison.mjs` NO se editan (hashes fijados en manifests que la UI verifica, `src/ui/canonical-inputs.mjs:70-83`). El motor TRADES vive en ruta versionada nueva.
- Ningún parámetro de TRADES-v1 se elige mirando resultados de estrategia. TR-01..TR-03 son solo de mercado y calendario.
- El OOS histórico no se lee con estrategia antes del freeze de TR-04. Cada lectura queda en el registro de acceso.
- Todo loader filtra por zona; la selección de hora del brazo HOUR solo ve Development.
- Cero cálculo en la UI; valor sin artefacto hash-bound = `UNAVAILABLE`.
- Los agentes de la Oficina NO corren escaneos completos del lago ni backtests completos: construyen productores y los prueban con fixtures chicos. Los escaneos (TR-01, TR-03) y los runs (TR-06) se lanzan como jobs por la ruta de BT-05, disparados por Bru, con pico de RAM medido.
- Fees UNKNOWN/excluded, nunca cero. `BENCHMARK_PROVISIONAL` explícito.

## Work

### TR-01: Fuente canónica de trades, regla de elegibilidad y cobertura
Precondición: archivo del cliente `eex-sealed-production-outright-2020-11-02--2026-09-11.tar.zst` descargado y SHA-256 verificado.
- Inventario del archivo: tablas, commodities, áreas, instrumentos, fechas; contenido de `eex_derivative_reference` (último día de negociación por contract, relación con `ExpiryDate`).
- Comparación contra `/srv/hot-data/EEX` en NATGAS/THE y POWER/DE: filas, duplicados, cobertura por instrumento y día, cambio de ingesta del 2026-06-12.
- Implementar la regla de trade elegible del patch 03 §3.1: clave de dedup, Delete point-in-time (verificar qué hora lleva la fila Delete), regla de `FromBrokenSpread` y de trades sin `AgrsrAct`, medidas sobre la historia completa.
- Reproducir como artefacto las mediciones preliminares del patch 03 §0 (densidad, días sin trades, duplicación).
- Primera fecha de ask usable en TOB POWER/DE; calendario de negociación de Power DE.
- Salida: `DATA_SOURCE_DECISION` + manifest. Si la fuente elegida no es el lago actual, declarar qué artefactos quedan stale (B de BT-01).

Acceptance: productor probado con fixtures (dedup, Delete PIT, elegibilidad); decisión de fuente explícita; job de escaneo lanzado por Bru; panel de cobertura en TR-07.

### TR-02: Zonas y OOS histórico (versión de la reserva IMP-09)
- Materializar ventanas por misión (Quarterly 3-1-3, Monthly 1-0-1) para Gas y Power desde el calendario, SIN leer precios.
- Función de reserva nueva y versionada en `src/oos-reservation/` (no modifica `reserveSealedOos`, fijo en 8 campaigns y solo Quarterly, `reservation.mjs:34-35`): Development, OOS, embargo, puente, post-puente, forward y purge según patch 03 §4, para las 4 misiones por separado; IDs canónicos. La reserva IMP-09 y su HOLD quedan intactas.
- Registro de acceso reutilizando `recordOosAccess` (`reservation.mjs:478`) con propósitos de acceso de TRADES.
- Registrar los episodios ya vistos por el backtest TOB exploratorio (puente).

Acceptance: test propio de que el productor no abre columnas de precio (`Px`, `AskPx`, `BidPx`); `OUTCOME_LIKE_FIELDS` solo filtra nombres de resultado y no sirve para esto; lista de campaigns por zona y misión; cobertura por campaign desde TR-01 visible, sin sustituir campaigns.

### TR-03: Mediciones de mercado en el puente (sin estrategia)
Por mercado, misión, instrumento y slot (08:00-17:30 Berlin, cada 30 min), en 2025-08-12 .. 2026-07-28:
- antigüedad del último trade elegible en el instante de decisión;
- % de slots con observación dentro de límites de frescura candidatos;
- diferencia entre observación TRADES (`LAST_TRADE` y `SLOT_VWAP`) y best ask en ESE instante, por distancia a entrega, por lado agresor, y condicionada a "observación por debajo de la media de las 10 previas" (estado de compra de DIP10, calculable sin correr la estrategia);
- mitad cronológica de calibración y mitad de evaluación, por separado.

Acceptance: no lee ledgers ni resultados de estrategia (test); job lanzado por Bru; vista de calibración en TR-07.

### TR-04: Contrato TRADES-v1 y freeze (gate humano)
- Versión nueva del contrato de ejecución (IMP-07) para TRADES, sin tocar el contrato TOB.
- Límite de frescura, regla de dato ausente, penalización trade->ask por mercado y misión (separada del 0,15), grilla de sensibilidad.
- Gate del puente predeclarado: % decisiones BUY/WAIT iguales, MW comprados, precio de fill, H, ΔV, signo y orden Baseline / DIP10 / HOUR; declarado que los resultados TOB del puente ya son conocidos.
- Config con hash.
Gate: Bru aprueba el freeze antes de cualquier run de estrategia en TRADES.

### TR-05: Motor TRADES (ruta versionada)
Depende de BT-05 (run_id, manifest por run, resultado vigente único).
- Loaders parametrizados por mercado y misión, en ruta nueva; el loader TOB también se generaliza en ruta nueva (el v2 lee gas THE, `operations/exploratory/v2/build_tob_slots.py`, con `EEX_TOB_LAKE` por variable de entorno) para que el contraste del puente exista en las 4 misiones.
- Productos y volúmenes por misión: Power no puede caer en la rama Monthly por defecto (hoy `backtest.mjs:53`, `:57` y `TARGET_MW` en `:25` solo conocen G0BQ/G0BM).
- Campo de observación propio (`price`, `observationTm`, `observationRule`), y benchmark proxy que lo consume explícitamente (el actual lee `entry.ask`; con `price` daría B* = null en silencio).
- Ventana por calendario (patch 03 §3.4), no por días con observación.
- Brazos `LAST_TRADE` y `SLOT_VWAP`; `DEPTH` no disponible.
- ΔV entre brazos solo con los dos brazos completos (el benchmark se cancela); V absoluto entre modos no se compara sin referencia común.
- Brazo HOUR: walk-forward dentro de Development (patch 03 §5.4), no leave-one-out.
- Tests: artefactos v2 byte-idénticos, sin look-ahead (`Tm` <= decisión), Delete PIT, frescura, dato ausente, filtro por zona, HOUR solo en Development, fill.

### TR-06: Runs de las 4 misiones (los lanza Bru)
Development (walk-forward para la hora) -> puente (mitad de evaluación contra el gate de TR-04) -> OOS histórico (una apertura registrada). Scoring por campaign; métricas por día-decisión como diagnóstico. Pico de RAM por run.

### TR-07: UI de Backtests (diseño APROBADO por Bru 2026-09-25)
Depende de UI-05 y UI-06 (misma pantalla). Referencia visual aprobada: /srv/hot-data/oficina-data/design-selections/energy-markets/TR-07-prototipo-2026-09-25/prototipo-tr07.html (sha256 d1fd75a72c8d7f3c0923d3132d02db4b2d6cae78fb23433f107f55d82f85cb6f), opción B. Calcar layout; los datos salen solo del backend.
- Selector de mercado/misión (Gas Q, Gas M, Power Q, Power M) y selector de modo `TOB` | `TRADES`.
- En `TRADES`, selector de período: All, Development, Historical OOS, Bridge.
- Barra de zonas (Development, Historical OOS, embargo, Bridge, post, Forward) con borde en lo que cubre la vista.
- Panel de contraste TOB vs TRADES arriba y a ancho completo, antes de la vista del modo (Bru 2026-09-26, ajuste al prototipo), plegado en 1 línea mientras TRADES no se haya corrido; visible solo cuando la vista incluye el puente; fuera del puente, 1 línea: "Contrast only exists for the bridge, 2025-08-12 to 2026-07-28".
- Botón "Expand calibration charts": abre a ancho completo la superposición TOB/TRADES día por día y la distribución (último trade − ask) de TR-03.
- Chart de efecto pareado con el hover de UI-06 en ambos modos.
- Paneles de cobertura (TR-01), zonas y accesos OOS (TR-02) y contrato congelado (TR-04) dentro del mismo diseño.
- Textos fijos "real EEX best ask" (`src/ui/render.mjs:756`, `:1052`, `:1388`) parametrizados por modo.
- Lo que no exista todavía: `NOT RUN YET` / `UNAVAILABLE`, nunca un número.
Gate: la revisión verifica fidelidad al prototipo aprobado; no se piden capturas nuevas a Bru.

### TR-08: Forward shadow
Fecha de inicio de la ingesta viva a verificar (Bru indica 1-nov-2026). El forward corre con el contrato TOB sobre ask vivo; en paralelo registra las decisiones `LAST_TRADE` y `SLOT_VWAP` para comparar cada hipótesis contra lo que el TOB vivo habría hecho. Requiere extender `src/shadow/capture.mjs`, que hoy usa el fill canónico TOB (`src/execution-contract/causal-fill.mjs`) y consume el brazo A1 de P5, no DIP10: declarado como alcance de esta tarea.
