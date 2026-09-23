# IMP-04 · DEP-10 — Capability assessment de herramientas reales

Fecha: 2026-09-23. Fuente normativa: SPEC v1.1.1 §6.4 (auditar permisos de uso y
capacidades/contrato del backtesting existente), §6.5 (tooling reportado) y
§25.1 IMP-04 ("Interfaces reales, fixtures sintéticos, constraints de uso";
entregable: capability assessment y decisión de reutilizar/extender/construir).

Este artefacto registra la materialización de DEP-10 que antes sólo existía como
framework sobre componentes sintéticos. El assessment vive en
`src/tooling-selection/real-tooling.mjs` y se consume en
`test/tooling-selection/real-tooling.test.mjs`.

## Backtesting existente (§6.4) — audit component-by-component

§6.4 exige auditar "permisos de uso y capacidades/contrato del backtesting
existente". El audit factual sobre este worktree es:

1. **En el repo Energy Markets** (`src/`) no existe ningún componente de
   backtesting: el símbolo no aparece en código, tests ni contratos; sólo en
   comentarios que citan la SPEC. Los módulos existentes aceptados cubren
   cálculo/admisión/rol-evaluación, no un backtester.
2. En la referencia histórica, `reference/plan/accion_plan.md:46` declara la
   secuencia «modelos → backtester → implementación → resultados» como paso
   futuro; la SPEC §6.5 corte 2026-09-22 reporta como tooling existente sólo el
   script de lectura EEX y el benchmark de `src/economic-calculation/benchmark.mjs`,
   con "no un benchmark validado de campaña" (hub pendiente DEP-08/09).

Hallazgo: **el backtesting existente está AUSENTE** en el alcance auditado. No
hay componente que reutilizar ni extender para backtesting, y no corresponde a
IMP-04 construir uno: la necesidad de construir exige demostración auditada
para el consumidor que lo requiera (§6.4: "construir un engine completo sólo
si la auditoría demuestra necesidad"). La decisión de abajo queda
delimitada a los soportes de benchmark que consume IMP-05 y
NO se presenta como resolución de la parte backtesting de §6.4 más allá del
alcance auditado: esa parte se registra como pendiente de consumidor (ver
Límites).

## Capacidades que IMP-05 necesita (con fuente)

La lista anterior (`benchmark.calculate`, `benchmark.coverage`,
`reference.select`) no tenía fuente y omitía §5.4. La lista vigente está en
`IMP05_CAPABILITY_SOURCES` (`src/tooling-selection/real-tooling.mjs`), cada
capacidad con su cita a la SPEC v1.1.1. Un test comprueba que cada sección
citada existe. Se separa en los dos soportes que IMP-05 consume (§25.2.2 IMP-04:
"decisión técnica aplicable al soporte que consuma esa herramienta"):

- **Cálculo/reconciliación:**
  - `benchmark.calculate` y `benchmark.coverage` (§25.1, §5.3);
  - `benchmark.calendar.missing_dates` (§25.2.2 IMP-05 "calendario de benchmark", §5.3 calendario de fechas esperadas separado y missing trazados);
  - `benchmark.status.provisional` (§5.4 `BENCHMARK_PROVISIONAL`);
  - `benchmark.window.boundaries` y `benchmark.window.derive` (§25.1 "fronteras correctas" y "1-0-1/3-1-3", §5.3);
  - `reference.select` (§5.3) y `reference.proxy` (§5.2);
  - `reconciliation.official_proxy` (§25.1 "sustitución oficial sin borrar proxy", §5.4);
  - `benchmark.version` (§25.1 "B versionado", §5.4);
  - `official.value_0_01.treatment` (§25.1 "caso 0.01 investigado", §5.4).
- **Lectura de referencias reales:**
  - `reference.read.trades`, `reference.read.top_of_book` (§5.2, §6.5);
  - `reference.read.official` (§5.3, §25.2.2 IMP-05 REQUIRES_AUDIT DEP-06/07).

## Inventario auditado

El inventario del tooling existente es el que reporta §6.5 «Tooling y
benchmark»: `src/economic-calculation/benchmark.mjs`, `generate_eex_snapshot.py`
«y su entorno de lectura» (`REAL_TOOLING_INVENTORY`, con el hash de la SPEC).
**Hipótesis (no la nombra la fuente):** el entorno de lectura es el venv
`/home/op/apps/power-markets-explorer/.venv-data`. Ni §6.5 ni U-AUDIT lo
nombran; se deduce porque el script importa `duckdb`, el `python3` del
sistema no lo tiene y ese venv del mismo proyecto sí: DuckDB 1.5.5 (MIT) y
pyarrow 25.0.1 (Apache-2.0), verificados en sus `dist-info`. La versión
anterior de este audit omitía el entorno de lectura. Ambas decisiones se derivan con ese inventario y exigen que cada
componente inventariado tenga assessment y que no haya assessments ajenos a él.

## Herramientas auditadas

| Componente | Cubre | No cubre (verificado en código) | Derechos / IP | Usable |
|---|---|---|---|---|
| `economic-calculation.benchmark` (`benchmark.mjs`, `reference.mjs`; IMP-08) | calculate, coverage, window.boundaries, reference.select, reference.proxy, 0.01 (tratamiento por validez declarada, no por valor) | calendar.missing_dates (`benchmarkB` recibe `expectedDates` como número; no lista las fechas missing); status.provisional (no emite status); window.derive (ninguna función deriva [S-1 mes,S) ni [Q-4,Q-1)); official_proxy (`selectDailyReference` devuelve sólo el valor elegido, sin δ_d ni ambos valores); version (`benchmarkB` no emite versión) | Código propio; IP none | sí |
| `power-markets-explorer.venv-data.duckdb` (entorno de lectura) | reference.read.trades: el `read_parquet` del QUERY lee por trade `Px`, `Tm`, `InstrumentISIN`, `TrdDate`, `TrdID`, `Sz`, `UpdtAct`, `_retrieved_at_utc`, `_row_sha256` | top_of_book (esquema no inspeccionado; §6.5 sólo dice que añade bid/ask: hipótesis, no se declara); official (§6.5 sólo reporta raíces trade y top_of_book); la ventana 17:05–17:15 y producto/fecha exactos son consulta de IMP-05 | rights unknown (licencias del motor no acreditan derechos sobre datos), IP unknown | no (pendiente) |
| `power-markets-explorer.generate_eex_snapshot` | ninguna capacidad de IMP-05 (declara sólo `eex.snapshot.candles_4h`) | reference.read.trades: lee y deduplica `eex_derivative_trade` internamente, pero su interfaz (`candle = {time, open, high, low, close, volume}` en cubos de 14400 s) no expone precio ni hora de cada trade, que §5.2 necesita para T̂ en la ventana 17:05–17:15; top_of_book y official tampoco | rights unknown, IP unknown (SPEC §6.5:626) | no (pendiente) |

## Decisión factual

1. **Soporte de cálculo de IMP-05: EXTEND `economic-calculation.benchmark`**
   - Se añaden sólo `benchmark.calendar.missing_dates`, `benchmark.status.provisional`, `benchmark.window.derive`, `reconciliation.official_proxy` y `benchmark.version`.
   - Lo cubierto se reconcilia de forma exacta: 14 salidas reales contra los fixtures documentales de §19.3.1, sin tolerancia (criterio provisional, ver Límites):
     - B=105, count 2, coverage 2/3;
     - corrección 102→103 da B=106.5;
     - proxy 101;
     - oficial con timestamp más reciente = 103;
     - ventana [inicio,fin);
     - 0.01 con validez declarada se selecciona; con validez `unknown` se excluye y cae al derivado (100, `trades-only`).
   - `classifyOfficialValidity()` devuelve `canonicalRejectionRule: "none"` para toda entrada. No se usa como evidencia porque no discrimina.
   - Contrastar el guard 0.01 reportado con la fuente aplicable (§19.3.1, §25.2.2 IMP-05) queda para IMP-05 y exige `reference.read.official`.
   - **Juicio de auditoría, no cita de la SPEC:** el componente es "casi suficiente". Lo que falta son fórmulas cerradas de §5.3/§5.4 sobre salidas que ya produce (`extensionRationale`).
   - Implementar las 5 capacidades es trabajo de IMP-05, no de IMP-04.
2. **Soporte de lectura de referencias reales: BLOQUEADO (`BLOCKED_PENDING_RIGHTS_AUDIT`)**
   - El script EEX no cubre ninguna capacidad de lectura. La versión anterior de este audit le atribuía `reference.read.trades`; era falso: su interfaz sólo entrega velas 4H (corrección de la revisión 7, verificada por test contra el script con su hash).
   - `reference.read.trades` la cubre el entorno de lectura (DuckDB sobre el lago), con derechos/IP `unknown` → `blockedCapabilities: [reference.read.trades]`.
   - `reference.read.top_of_book` y `reference.read.official` no las cubre ningún componente auditado → `uncoveredCapabilities`.
   - Con componentes inventariados de derechos pendientes, la necesidad de construir no está demostrada.
   - No se extiende ni se construye otro lector mientras ese estado siga sin resolver: `unknown` no se degrada ni a permiso ni a "no existe".
   - Top-of-book y settlement oficial no los cubre ningún componente auditado. Además, §5.4 deja "pendiente la alineación empírica del proxy con un feed oficial o externo autorizado".
   - **Esto bloquea IMP-05** para datos reales: su REQUIRES_AUDIT (§25.2.2) incluye DEP-06/07 y DEP-10 "herramienta/uso autorizado". Lo resuelve una acreditación de derechos del lago EEX y de una fuente oficial, que sólo puede aportar el owner.

Esta decisión no concede autoridad de producción y no acredita benchmark de
campaña (DEP-08/09) ni data-readiness del lago (DEP-06/07).

## Reglas de decisión endurecidas (review 2026-09-23)

- Reconciliación exacta. Se rechaza cualquier tolerancia distinta de 0 y cualquier valor vacío o no finito (`undefined`, `null`, `NaN`, `Infinity`, `""`, `[]`).
- BUILD exige componentes auditados y un inventario del soporte con evidencia (`auditInventory`): cada componente inventariado debe tener assessment (`INVENTORY_NOT_AUDITED`) y no se admiten assessments fuera del inventario (`ASSESSMENT_NOT_INVENTORIED`). Si se aporta, el inventario se exige igual para REUSE/EXTEND.
- Si un componente con derechos `unknown` cubre lo que se construiría, el resultado es bloqueo, no BUILD. Para BUILD, además, cualquier componente inventariado con derechos pendientes bloquea aunque no cubra nada todavía.
- BUILD y EXTEND no reimplementan lo que ya cubre otro componente usable (`EXISTING_COVERAGE_NOT_RESOLVED`).
- `validateToolingSelection` re-deriva la decisión desde los mismos assessments. Rechaza:
  - la elección a mano entre varios componentes suficientes;
  - assessments sin versión, evidencia o derechos;
  - cualquier selección distinta de la derivada;
  - un record cuyos `requiredCapabilities`, `targetAssessment`, `auditTrace`, `rationale` o `authority` contradigan la auditoría.
- El conjunto auditado es fijo: los tres componentes del inventario de §6.5 (benchmark, script EEX y su entorno de lectura). Un test lo comprueba, y quitar un componente da `INVENTORY_NOT_AUDITED`.
- Las capacidades de lectura se comprueban contra la interfaz real: un test lee el script (hash `01353f73…`), extrae los campos que emite; otro comprueba que el QUERY lee de `read_parquet` cada columna por trade atribuida al entorno y los hashes de `dist-info/RECORD` del venv; y se exige que un componente declare `reference.read.*` sólo si expone los campos de `REFERENCE_READ_REQUIRED_OUTPUTS` (§5.2/§5.3).

## Hashes de procedencia (bytes en este worktree)

- `src/economic-calculation/benchmark.mjs` — `0db32ff428fe41482904803664c448b9c3d984d234aff0a1bdfa91db34bc17c1`
- `src/economic-calculation/index.mjs` — `04217b163082ac848a5088a2120fb201d32b64ab9e6737b2179e7b20da2e8d66`
- `operations/receipts/IMP-08-IMP_RECEIPT.json` — `43b56173f021331a889393d3697f1ca8bdf40491e450798238044ac8decc9625`
- `/home/op/apps/power-markets-explorer/scripts/generate_eex_snapshot.py` — `01353f730d1bcba4a6cf83098b43914ee743212006aedf7ce8e548a95e491740`
- `.venv-data/.../duckdb-1.5.5.dist-info/RECORD` — `585ea64989741e6a35be3d3912dc8158c6ecac777857e666464428945a12fe8f`
- `.venv-data/.../pyarrow-25.0.1.dist-info/RECORD` — `c2658c5e3b843700ad96e5173d6006a889edeaa2f4a8351118f64fb25a3b55ca`
- `src/economic-calculation/reference.mjs` — `c8597ac83ba540b0de8b64dc2907e0e7e7c32417a02e06ee442f29d5514e511b`
- SPEC v1.1.1 — `666a9735d9daf62764582f017056171acae52070d18499b26c5c6e426cff3ef3`

## Reproducción

```
node --test test/tooling-selection/real-tooling.test.mjs
```

## Límites residuales (OPEN_ITEM)

- `auditInventory` es opcional para REUSE/EXTEND en la API genérica (su criterio en §25.1/§25.2.2 es la reconciliación independiente); es obligatorio para BUILD. Las decisiones reales DEP-10 lo aportan siempre.
- El inventario lo declara quien llama, con evidencia. La API genérica sólo valida forma y coherencia con los assessments; un inventario inventado con evidencia bien formada no se detecta (mismo límite de procedencia que la reconciliación). En la decisión real, el inventario es una constante atada por test al texto y hash de la SPEC §6.5. Su completitud descansa en esa fuente (que reporta U-AUDIT), no en un escaneo del entorno.

- El validador verifica estructura y consistencia interna (salidas reales +
  fixtures `permitted` con cómputo independiente + cobertura de salidas clave),
  no procedencia criptográfica: la evidencia sigue siendo declarada por el
  llamador. Verificación por ejecución/hash de artefacto queda fuera de una
  librería pura y no es parte de este corte.
- Tolerancia: la SPEC v1.1.1 no fija tolerancia para reconciliar salidas de tooling. Se aplica exactitud como **criterio provisional**, por analogía con §14.8 (volumen y costes "reconcilian exactamente"), §19.3.1 ("reconciliación exacta de unidades") y §19.3 (sin epsilons en scoring). Confirmarlo o fijar un margen es decisión de Bru; un margen canónico iría por §20.2.12.
- §6.4 backtesting: la auditoría de capacidades/permisos del backtesting
  existente se cierra en el alcance auditado con el hallazgo AUSENTE (no hay
  componente). Su "resolución" para un futuro consumidor de backtesting
  corresponde a otro IMP con necesidad demostrada; aquí no se construye ni se
  presupone.
