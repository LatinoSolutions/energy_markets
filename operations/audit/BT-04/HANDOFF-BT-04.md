# BT-04 — Validación y handoff de la tabla de Backtests

Fecha: 2026-09-25. Base: `main` @ b0fee0e (BT-01, BT-02, BT-03 aceptados).
Estado de todo lo de abajo: `BENCHMARK_PROVISIONAL` / exploratorio. Nada es oficial ni canónico.

## 1. Qué se validó y cómo

Recalculé B, H, V y ΔV para **G0BQ-202601** y **G0BM-202510** directamente del lago EEX crudo
(`/srv/hot-data/EEX`), con un script Python que no importa nada del código de BT-01/BT-02/`src`
(`independent-check.py`), escrito desde SPEC v1.1.1 §5.2, §5.3, §5.5 y la regla de ejecución del cliente
(`02_execution_costs/execution_and_costs.md` §1: best ask de la última observación TOB ≤ 11:00 + 0.15 EUR/MWh).
Los 669 archivos parquet que leyó tienen el mismo sha256 que el manifest de BT-01 (mismos bytes de entrada).

`compare.mjs` compara contra los artefactos de BT-01/BT-02 y exige que cada diferencia sea ruido de
coma flotante (≤ 1e-9) o que tenga una causa **reproducida**. Resultado: `PASS_WITH_ATTRIBUTED_DIFFERENCES`, 0 sin explicar
(`validation-BT-04.json`).

| Campaña | Valor | BT-01/BT-02 | Independiente | Veredicto |
|---|---|---|---|---|
| G0BQ-202601 | B (cobertura 65/65) | 33.399355 | 33.399340 | diferencia −1.5e-5, atribuida (C1) |
| G0BQ-202601 | H BASELINE (60 fills) | 33.539000 | 33.536583 | 59/60 fills iguales; 1 atribuido (H1) |
| G0BQ-202601 | H ARM_A (5 fills) | 34.636000 | 34.636000 | igual |
| G0BQ-202601 | ΔV ARM_A vs BASELINE | −1.097000 | −1.099417 | diferencia = efecto de H1 |
| G0BM-202510 | B (cobertura 21/22, falta 2025-09-30) | 33.122512 | 33.122525 | diferencia +1.3e-5, atribuida (C1) |
| G0BM-202510 | H BASELINE / ARM_A | 33.162500 / 33.200000 | iguales | igual |
| G0BM-202510 | ΔV ARM_A vs BASELINE | −0.037500 | −0.037500 | igual |

Los V difieren exactamente en (diferencia de B − diferencia de H). ARM_B y los brazos `@DEPTH` no tienen ledger
diario guardado: sólo se verifica la aritmética V = B − H y ΔV (coincide). Qué días compra cada brazo sale del ledger
guardado; volver a decidirlo sería re-ejecutar la estrategia, cosa que BT-02 excluye.

**C1 — probado.** Con dos elecciones de implementación de BT-01, mi fórmula reproduce BT-01 fecha por fecha
(≤ 1.2e-12): (a) BT-01 trunca la hora a segundos enteros, así que 17:15:00.xxx entra en la ventana estricta;
(b) BT-01 deduplica por (Tm, precio, bid, ask) y funde filas de mercado distintas (p. ej. dos trades con
TrdID distinto, mismo Tm y precio). Impacto en B ≤ 1.5e-5 EUR/MWh.

**H1 — probado.** En 4 de 76 fills hay varias filas TOB (EXPLICIT e IMPLIED) con el mismo Tm, el último antes de las 11:00.
`build_tob_slots.py` se queda con la última fila en orden de archivo, no con el best ask. En 3 casos coincidió con el
mínimo. El 2025-11-25 (G0BQ-202601) eligió 31.475 EXPLICIT en vez de 31.33 IMPLIED: H de BASELINE queda +0.145/60 =
+0.0024 EUR/MWh. Sin corregir aquí: cambiarlo implica modificar la regla de ejecución y volver a ejecutar el backtest exploratorio
aceptado, cosa que no permite BACKTEST_TABLE_UNLOCK_PLAN (Non-negotiable semantics).

Dato útil de paso: `_row_sha256` del lago **no** sirve como clave de deduplicación; la misma observación
bajada en otro pull tiene otro hash (visto el 2025-09-09 en G0BQ-202601).

## 2. Qué queda poblado (BT-02, visible en la UI de Backtests vía BT-03)

- 13 de 21 campañas exploratorias con B provisional por campaña (3 G0BQ, 10 G0BM; coberturas en
  `campaign-provisional-benchmarks-BT-01.json`).
- En esas 13: H, V y ΔV por brazo. 63 valores V `PROVISIONAL`, 2 `PARTIAL` (ARM_A@DEPTH de G0BM-202602 y
  G0BM-202606: la profundidad visible no alcanzó el objetivo; la cobertura se informa aparte, no se mete en V).
- H lleva `hCostCompleteness: PARTIAL` en todos los brazos: fees excluidos, nunca cero.
- La fila oficial/canónica sigue `UNAVAILABLE` (fail-closed).

## 3. Qué no está poblado y por qué

| Falta | Motivo | Quién lo desbloquea |
|---|---|---|
| Fees EEX/ECC/broker en H | UNKNOWN; pedidos al cliente el 2026-09-24 (`mac-mirror/solicitud de informacion/Energy_Markets_Client_Market_Data_Request_2026-09-24.md` §2). El cliente los marca "unknown / excluded pending evidence" (`execution_parameters.csv`). | Cliente. No bloquea el resultado provisional. |
| Settlement oficial EEX (B oficial) | P-007 resuelta: el cliente no aporta feed oficial y remite al benchmark EEX del research team. No hay fuente oficial autorizada en el alcance. B sigue `BENCHMARK_PROVISIONAL`. | Nadie lo tiene pendiente hoy (REF: P-007, resuelta; no se reabre). |
| 8 campañas `UNAVAILABLE` (G0BM-202509, 202608–202612; G0BQ-202510, 202610) | Su ventana no cabe entera en el periodo de datos del backtest (`dataPeriod` 2025-08-12 → 2026-07-28): G0BM-202509 y G0BQ-202510 empiezan antes; G0BM-202608 y G0BQ-202610 terminan después; G0BM-202609–202612 aún no tienen ventana. | Las anteriores: historial TOB pedido al cliente el 2026-09-24 (§1 de la misma solicitud). Las posteriores: datos EEX más nuevos en el lago (ingesta interna) y el paso del tiempo. |

## 4. Trabajo de ingeniería abierto (no es para Bru)

- **H1**: resolver empates de Tm en `build_tob_slots.py` con el best ask (mínimo) y fijar/versionar si los asks IMPLIED
  cuentan (hoy cuentan). Requiere volver a ejecutar el backtest exploratorio en un camino con techo de memoria (BT-05), nueva
  versión de resultados y rehacer BT-02.
- **C1**: en la maquinaria IMP-05 (`src/economic-calculation/reconciliation.mjs`) y en el worker de BT-01, usar
  tiempo con fracción de segundo en los límites de ventana y deduplicar por todas las columnas de mercado.
  Cambia la metodología del benchmark aceptado → nueva versión de benchmark, no se toca en silencio.

## 5. Reproducir

```
systemd-run --user --scope -p MemoryMax=3G -p MemorySwapMax=0 python3 operations/audit/BT-04/independent-check.py   # ~4 min; corrió con ese techo sin ser cortado (pico no medido)
node operations/audit/BT-04/compare.mjs --check           # compara con BT-01/BT-02 hash-bound
node --test test/bt04/validation.test.mjs
```
