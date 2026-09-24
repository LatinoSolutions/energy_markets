# UI-04: requisitos de datos, estado del backtest y TO-DO

Fecha: 24-sep-2026. Rama: `run/energy-markets-UI-04-20260924-owner` (solo rama, NO desplegado en :8788).
Commits: `64156e8` (fidelidad DES-01 integrada), `664acf8` (loader canónico + /health). Tests: 1493/1493.

## 0. Mensaje para Bru

**Resultado:** hoy NO se puede correr un backtest honesto de Gas Quarterly. La causa es de data, no de código.

1. El precio de ejecución canónico es el best ask del top-of-book. En el lago EEX solo existe desde
   2025-07-25 y solo para el front quarter. Las campañas empiezan en 2021Q1.
2. Solo hay 3 campañas completas: 2026Q1, 2026Q2 y 2026Q3. Las 3 caen dentro de las últimas 8, que la
   SPEC (§13.8) reserva como OOS final. Usarlas para backtest quema el OOS.
3. Con menos de 8 campañas elegibles la reserva OOS queda en HOLD (IMP-09), y el motor se niega a correr
   A0/A1 sin reserva sellada (`src/p5-experiment/run.mjs:135-150` exige manifest congelado; `freeze.mjs:76-83` lo niega si la reserva no es RESERVED). Es correcto que se niegue.

**Lo que sí quedó hecho en la rama:**
- La UI es la del mockup DES-01 (corrección de fidelidad af4d01b integrada).
- La UI arranca cargando el único manifest canónico acreditado (IMP-03). /health dice exactamente qué cargó
  y qué falta. No se muestra ningún valor sin atestación: cero datos demo.
- Las razones UNAVAILABLE de cada panel ahora dicen la causa real.

**Decisiones que solo tú (o el cliente) puedes tomar, en orden de impacto:**
- **D1. Historia de precios 2021Q1-2025Q3.** Opción A: backfill del top-of-book histórico desde EEX (adquisición
  de data nueva; que la API lo permita es HIPÓTESIS, no verificado). Opción B: usar precios de trades
  (`Px`, existen desde 2020-11-02) como referencia de fill, con spread y slippage conservadores. B cambia la
  regla de referencia que dio el cliente: necesita su OK.
- **D2. Costes reales:** fees EEX/ECC y del broker por MWh. Hoy son UNKNOWN y el sistema bloquea la
  economía (HOLD). Es un dato del cliente.
- **D3. Reglas conservadoras de fill** (sección 3): propuesta de ingeniería lista, falta tu visto bueno.

## 1. Por pantalla: qué hay y qué falta

| Pantalla | Muestra hoy (rama) | Falta | Tipo de hueco |
|---|---|---|---|
| Replay | ERROR `NO_CANONICAL_DECISION_BOUNDARY`; 17 requisitos del manifest IMP-03, todos MISSING | decision boundary canónico; price series atestada (PIT value attestations) | data + proceso |
| Backtests | brazos A0/A1 "NO ESTIMATE" con causa real | runs P5/P6 persistidos sobre episodios reales + receipts IMP-14 | proceso no corrido (bloqueado por D1) |
| Research | S1-S5/Z "NO CANONICAL RECORD" | registry IMP-27 acreditable + camino de records no-PIT al boundary | wiring + contrato |
| Campaigns & Runs | sin campañas ni runs | IMP_RECEIPT de IMP-02 (ficha GAS-Q-2021Q1 existe en disco) + camino no-PIT | audit + contrato |

## 2. Data real verificada en el lago `/srv/hot-data/EEX` (93 GB, 59.961 parquet)

- Trades NATGAS/THE: 2020-11-02 a 2026-07-28, 282.693 filas; G0BQ 63.915 filas con maturity (65.307 en total; maturities 2021Q1-2029Q1).
- Top-of-book NATGAS/THE: 2025-07-25 a 2026-07-28, 94,7 M filas, solo front quarter (202510..202610).
- Problemas encontrados: 14 variantes de schema en trades (columnas ausentes), 49.862 filas duplicadas entre pulls,
  25.249 trades G0BQ sin precio (`VolumeOnly`), spreads mezclados en pulls de quarterlies, quotes de un solo
  lado, cambio de modo de captura el 2026-06-12 (trades truncados), último día parcial.
- Integridad física: 0 archivos ilegibles, 0 archivos vacíos.
- No existe en `src/` ningún lector del lago: solo scripts de audit.

## 3. Sesgos de backtest: estado del motor de fill (contraste con Alexandria)

Bien resuelto: no hay look-ahead en la decisión (PIT, consumable ≠ published), la baseline es price-blind,
el benchmark no entra a la decisión, y los costes UNKNOWN nunca se tratan como cero (HOLD).

Huecos que harían un primer backtest optimista, por gravedad:
1. **Fill más grande que la profundidad visible.** Se llena hasta 12 MW/día al best ask, pero el libro
   muestra 1 MW casi siempre (2025-11-20, Q1-26: 22.253 de 27.897 asks deduplicados con 1 MW, el 80 %). Regla propuesta: fill limitado al
   `AskSz` visible, el resto queda como residual abierto. Alexandria tampoco modela profundidad.
2. **Quote viejo y latencia 0.** Se toma "el último ask ≤ decisión" sin edad máxima
   (`src/execution-contract/causal-fill.mjs:52`). Propuesta: primer ask ≥ decisión + latencia, con edad
   máxima y nunca de otro día (equivalente a la regla de Alexandria "entrada en la barra siguiente").
3. **Sin loader canónico ni filtro de instrumento.** Un spread o un implied podría convertirse en precio de
   fill. Propuesta: loader único con filtro ISIN + maturity + `Simple Instrument`, dedup por `_row_sha256`,
   validación de ask > 0 y bid < ask, con recuentos de excluidos.
4. **Historia insuficiente** (D1).
5. **Costes incompletos** (D2). Slippage 0,15 EUR/MWh plano y provisional.
6. **Timestamps:** `causal-fill.mjs:18` usa `Date.parse`, trunca microsegundos y deja al llamante la
   conversión 11:00 Berlin → UTC. Propuesta: el parser estricto `pit-views/time.mjs` y una sola función
   de calendario Berlin con DST.
7. **Supervivencia:** el OOS solo admite quarters COMPLETE; los excluidos deben reportarse con motivo.
8. **Multiple testing:** no hay registro de trials; el acceso al OOS se auto-declara.

## 4. TO-DO ordenado

| # | Qué | Tipo | Entrada existente | Condición de cierre verificable |
|---|---|---|---|---|
| 1 | Decidir D1 (backfill TOB o trades con spread) | decisión Bru/cliente | lago trades 2020-11-02..2026-07-28 | decisión escrita en owner patch |
| 2 | Medir cobertura top-of-book por campaña a las 11:00 Berlin | audit | `operations/audit/IMP-09/eex-quarterly-episode-evidence.json` | tabla por campaña con días con ask |
| 3 | Loader canónico lago → priceObservations | implementación (no existe) | scripts de audit IMP-05/IMP-09 | artifact con hash + receipt IMP-03 con claims DEP-06/07 |
| 4 | Endurecer fill (profundidad, frescura, latencia, parser estricto) | implementación | `causal-fill.mjs`, `replay.mjs` | tests de phantom fill en rojo antes y en verde después |
| 5 | Sellar OOS (últimas 8 elegibles) como receipt IMP-09 | proceso | `src/oos-reservation/*` | `sealedOosCount: 8` en receipt aceptado |
| 6 | IMP_RECEIPT de IMP-02, 05, 09, 15, 20 | audit | artifacts ya en `operations/audit/` | `verifyAcceptedArtifact` ok para cada uno |
| 7 | Fees reales (D2) | data del cliente | carpeta `solicitud de informacion` del espejo | execution contract sin UNKNOWN |
| 8 | Runner CLI A0 sobre episodios de desarrollo | implementación (no existe) | `buildReplayBundle`, `runP6Replay` | ledger + run receipt IMP-14 persistidos |
| 9 | Camino de records no-PIT (receipts, fichas, registry) al boundary | contrato IMP-29 | `backend-records.mjs` | decisión de contrato + tests |
| 10 | Mostrar runs en Backtests/Campaigns | wiring | punto 8 y 9 | /health `canonicalData: true` |

Comandos: no hay entry point ejecutable para 3, 5 y 8; no se inventa ninguno.
