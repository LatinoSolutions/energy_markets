# BT-04 — Validación y handoff de la tabla de Backtests

Fecha: 2026-09-25. Base: `main` @ b0fee0e (BT-01, BT-02, BT-03 aceptados).
Estado de todo lo de abajo: `BENCHMARK_PROVISIONAL` / exploratorio. Nada es oficial ni canónico.

## 1. Qué se validó y cómo

Recalculé B, H, V y ΔV para **G0BQ-202601** y **G0BM-202510** directamente del lago EEX crudo
(`/srv/hot-data/EEX`), con un script Python que no importa nada del código de BT-01/BT-02/`src`
(`independent-check.py`), escrito desde SPEC v1.1.1 §5.2, §5.3, §5.5 y la regla de ejecución del cliente
(`02_execution_costs/execution_and_costs.md` §1: best ask de la última observación TOB ≤ 11:00 + 0.15 EUR/MWh).
Los archivos parquet que leyó tienen el mismo sha256 que el manifest de BT-01 (mismos bytes de entrada).

`compare.mjs` exige, además de comparar valores: B = media de sus referencias diarias y cobertura/missing
coherentes con `perDate` (§5.3), V = B − H y ΔV = H_BASELINE − H_ARM_A en cada lado (§5.5), que la diferencia
de ΔV sea exactamente la que traen los H, que una diferencia de H sólo se atribuya si hay fills con causa
reproducida y el H de BT-02 es el que dan sus propios fills (nunca por ausencia de fills), que BT-02 lleve el
mismo registro de benchmark que BT-01 (B, coverage, status, versionId y ventana) y que los hashes declarados
(calendario, ledger exploratorio, BT-01) coincidan con los archivos leídos.

El contraste encontró dos defectos de los productores aceptados. Ambos se corrigieron **en una versión nueva**
(v2); la v1 aceptada se conserva byte a byte con sus propios generadores (`operations/exploratory/build_tob_slots.py`
y `run-exploratory-backtest.mjs`, mismos sha256 que su `MANIFEST.json`); los generadores v2 viven en
`operations/exploratory/v2/`. Test: `test/exploratory/manifest-provenance.test.mjs`.

| Versión | Artefactos | Veredicto BT-04 |
|---|---|---|
| v1 (aceptada) | `operations/exploratory/*`, `operations/audit/BT-01/*` | `PASS_WITH_ATTRIBUTED_DIFFERENCES` (`validation-BT-04.json`) |
| v2 (vigente) | `operations/exploratory/v2/*`, `operations/audit/BT-01/v2/*` | `PASS`: B, H, V y ΔV iguales al independiente, diferencia 0 (`validation-BT-04-v2.json`) |

| Campaña | Valor | v1 | v2 = independiente |
|---|---|---|---|
| G0BQ-202601 | B (cobertura 65/65) | 33.399355 | 33.399340 |
| G0BQ-202601 | H BASELINE / ARM_A | 33.539000 / 34.636000 | 33.536583 / 34.636000 |
| G0BQ-202601 | ΔV ARM_A vs BASELINE | −1.097000 | −1.099417 |
| G0BM-202510 | B (cobertura 21/22, falta 2025-09-30) | 33.122512 | 33.122525 |
| G0BM-202510 | H BASELINE / ARM_A | 33.162500 / 33.200000 | iguales |
| G0BM-202510 | ΔV ARM_A vs BASELINE | −0.037500 | −0.037500 |

ARM_B y los brazos `@DEPTH` no tienen ledger diario guardado: sólo se verifica la aritmética V = B − H y ΔV.
Qué días compra cada brazo sale del ledger guardado (en v2 los días de decisión no cambiaron respecto de v1).

**H1 — TOB con Tm empatado (corregido en v2).** Varias filas TOB (EXPLICIT e IMPLIED) comparten el último Tm
antes de las 11:00; `build_tob_slots.py` v1 tomaba la última fila en orden de archivo en vez del best ask.
v2 toma el menor ask (a igual ask, el menor AskSz conocido). Cambian 66 slots; en los H: G0BQ-202601, 202604
y 202607 (p. ej. el 2025-11-25 de G0BQ-202601: 31.475 → 31.33).

**C1 — ventana y deduplicación del proxy §5.2 (corregido en v2).** La maquinaria IMP-05 truncaba Tm a segundos
enteros (17:15:00.xxx entraba en la ventana 17:00–17:15) y BT-01 deduplicaba por (Tm, precio, bid, ask),
fundiendo trades distintos. v2 conserva la fracción de segundo (incluidos microsegundos) y deduplica por
`observationKey` = sha256 de todas las columnas de mercado (`_row_sha256` no sirve: la misma observación en
otro pull trae otro hash). Impacto en B de las 13 campañas: hasta 1.3e-3 EUR/MWh (G0BM-202606); coberturas
iguales. El mismo arreglo cambia el receipt de muestra de IMP-05: nuevo `lake-benchmark-receipt-IMP-05-v2.json`
(B 61.568654 → 61.568848), la v1 se conserva.

## 2. Qué queda poblado (BT-02 v2, visible en la UI de Backtests vía BT-03)

- La UI consume ahora la v2 (`src/ui/canonical-inputs.mjs` → `BT02_RELEASES.v2`); la v1 sigue en disco, no se muestra.
- 13 de 21 campañas exploratorias con B provisional por campaña (3 G0BQ, 10 G0BM).
- En esas 13: H, V y ΔV por brazo. 63 valores V `PROVISIONAL`, 2 `PARTIAL` (ARM_A@DEPTH de G0BM-202602 y
  G0BM-202606: la profundidad visible no alcanzó el objetivo; la cobertura se informa aparte, no se mete en V).
- H lleva `hCostCompleteness: PARTIAL` en todos los brazos: fees excluidos, nunca cero.
- La fila oficial/canónica sigue `UNAVAILABLE` (fail-closed).

## 3. Qué no está poblado y por qué

| Falta | Motivo | Quién lo desbloquea |
|---|---|---|
| Fees EEX/ECC/broker en H | UNKNOWN; pedidos al cliente el 2026-09-24 (`mac-mirror/solicitud de informacion/Energy_Markets_Client_Market_Data_Request_2026-09-24.md` §2). El cliente los marca "unknown / excluded pending evidence" (`execution_parameters.csv`). | Cliente. No bloquea el resultado provisional. |
| Settlement oficial EEX (B oficial) | P-007 resuelta: el cliente no aporta feed oficial y remite al benchmark EEX del research team. No hay fuente oficial autorizada en el alcance. B sigue `BENCHMARK_PROVISIONAL`. | Nadie lo tiene pendiente hoy (REF: P-007, resuelta; no se reabre). |
| 8 campañas `UNAVAILABLE` (G0BM-202509, 202608–202612; G0BQ-202510, 202610) | Su ventana no cabe entera en el periodo de datos del backtest (`dataPeriod` 2025-08-12 → 2026-07-28): G0BM-202509 y G0BQ-202510 empiezan antes; G0BM-202608 y G0BQ-202610 terminan después; G0BM-202609–202612 aún no tienen ventana. | Las anteriores: **nadie**. El cliente respondió el 25-sep que no existe top of book anterior a julio de 2025, sólo trades, y que no se vuelva a pedir (`PLAN_STATUS.md`, fila UI-05). En el lago, las particiones TOB del 2025-07-25 al 2025-08-11 sólo traen spreads o filas outright sin ask (muestra revisada: 2025-08-04), así que con la regla de ejecución TOB del cliente esas dos campañas quedan `UNAVAILABLE` de forma permanente. Las posteriores: datos EEX más nuevos en el lago (ingesta interna) y el paso del tiempo. |

## 4. Abierto (ingeniería, no es para Bru)

- **Aceptación de la v2**: BT-01 v2, backtest exploratorio v2 y BT-02 v2 son versiones nuevas producidas aquí;
  su aceptación la decide la Oficina. La UI ya las consume (`BT02_RELEASES.v2`); la v1 sigue válida contra su
  manifest pero no se muestra.
- **Texto stale dentro de `v2/backtest-results.json`**: el check "Code pinned" dice
  `generator sha256 in operations/exploratory/MANIFEST.json`; para v2 el manifest es `operations/exploratory/v2/MANIFEST.json`.
  Corregirlo cambia el hash de los resultados y obliga a regenerar BT-01 v2, BT-02 v2 y el cálculo independiente
  v2 (lago); se dejó sin tocar para no mover artefactos ya contrastados.
- **Sólo 2 campañas contrastadas de forma independiente**; las otras 11 salen del mismo código corregido.
- **`UpdtAct` en la tabla de trades** (acciones de actualización/borrado de EEX): ni BT-01 ni el cálculo
  independiente las interpretan; cada fila cuenta como observación. Falta auditar si hay trades corregidos o
  anulados dentro de las ventanas.

## 5. Reproducir

```
# Lago (con techo de memoria; tiempos medidos el 25-sep, sin corte por el techo):
systemd-run --user --scope -p MemoryMax=3G -p MemorySwapMax=0 python3 operations/exploratory/v2/build_tob_slots.py operations/exploratory/v2/tob-slots-the-gas.json   # ~3 min
node operations/exploratory/v2/run-exploratory-backtest.mjs operations/exploratory/v2/tob-slots-the-gas.json operations/exploratory/v2/backtest-results.json
systemd-run --user --scope -p MemoryMax=3G -p MemorySwapMax=0 python3 operations/audit/BT-01/extract-campaign-proxy-rows.py   # ~12 min
systemd-run --user --scope -p MemoryMax=3G -p MemorySwapMax=0 python3 operations/audit/BT-04/independent-check.py --release v2   # ~5 min
# Sin lago, comprobación de reproducibilidad de cada versión:
node operations/audit/BT-01/build-campaign-benchmarks.mjs --version v1 --check   # y --version v2
node operations/exploratory/reconcile-bt02.mjs --version v1 --check              # y --version v2
node operations/audit/BT-04/compare.mjs --target v1 --check                      # y --target v2
node --test $(find test -name '*.test.mjs')
```
