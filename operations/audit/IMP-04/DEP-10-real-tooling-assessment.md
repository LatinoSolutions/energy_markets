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

La lista vigente está en `IMP05_CAPABILITY_SOURCES`
(`src/tooling-selection/real-tooling.mjs`), cada capacidad con su cita a la
SPEC v1.1.1. Un test comprueba que cada sección citada existe. Se separa en
tres soportes (§25.2.2 IMP-04: "decisión técnica aplicable al soporte que
consuma esa herramienta"; §5.2: oficial, derivado y benchmark son "tres
valores diferentes"):

- **Cálculo/reconciliación:**
  - `benchmark.calculate` y `benchmark.coverage` (§25.1, §5.3);
  - `benchmark.calendar.missing_dates` (§25.2.2 IMP-05 "calendario de benchmark", §5.3);
  - `benchmark.status.provisional` (§5.4 `BENCHMARK_PROVISIONAL`);
  - `benchmark.window.boundaries` y `benchmark.window.derive` (§25.1 "fronteras correctas" y "1-0-1/3-1-3", §5.3);
  - `reference.select` (§5.3), `reference.select.group_by_date_instrument`
    (§5.3 «Para cada fecha de negociación d se selecciona una referencia»;
    revisión 10: `selectDailyReference()` tomaba el máximo timestamp global de
    filas mezcladas) y `reference.select.validity_guard` (§5.3 «existe fila
    oficial válida» + §19.3.1 «contrastar validez aplicable»; revisión 11: el
    selector promovía por defecto una fila sin `declaredValidity`) y
    `reference.proxy` (§5.2);
  - **obtener T̂/M̂ desde filas** (§5.2 «filas accesibles y deduplicadas del producto y fecha exactos»; revisión 8):
    `reference.proxy.rows.exact_product_date`, `reference.proxy.rows.deduplicate`,
    `reference.proxy.window.strict` (17:05/17:00–17:15 CE(S)T con conversión UTC/DST),
    `reference.proxy.means` (m_j, T̂, M̂) y `reference.proxy.window.fallback`
    (±60 min, `nearby-60m` / `eex-derived-reference`);
  - `reconciliation.official_proxy` (§25.1, §5.4);
  - `benchmark.version` (§25.1 "B versionado", §5.4);
  - `official.value_0_01.treatment` (§25.1 "caso 0.01 investigado", §5.4).
- **Lectura de filas EEX para el proxy:** `reference.read.trades` y
  `reference.read.top_of_book` (§5.2, §6.5). Cada una exige precio o bid/ask,
  hora, instrumento, ShortCode+Maturity, fecha de negociación y hash de fila
  (`REFERENCE_READ_REQUIRED_OUTPUTS`).
- **Lectura del settlement oficial:** `reference.read.official` (§5.3, §25.2.2
  IMP-05 REQUIRES_AUDIT DEP-06/07). Exige precio de settlement, **timestamp de
  proveedor**, **validez declarada de la fila**, fecha de negociación e
  instrumento: §5.3 decide «entre correcciones oficiales prevalece el timestamp
  de proveedor más reciente» sobre una «fila oficial válida», y el contrato real
  de `selectDailyReference()` elige por ese timestamp y aplica la validez.
  Revisión 9: la lista anterior omitía el timestamp y ningún test la
  contrastaba contra la SPEC ni contra el contrato real. Revisión 10: sin
  `official.declaredValidity` una fila 0.01 sin declaración se seleccionaba como
  oficial; el contrato ahora exige la validez (§19.3.1 «Oficial 0.01») y
  `validateCapabilityAssessment` rechaza un assessment de lectura que no exponga
  todas las salidas exigidas, conservando el bloqueo.

## Uso autorizado de los datos EEX (P-005)

Bru resolvió el 2026-09-23 (P-005) que los datos EEX disponibles para Energy
Markets están autorizados para este uso dentro del proyecto. El texto literal
está en `operations/audit/IMP-04/OWNER-DECISION-P-005-EEX-RIGHTS.md`
(sha256 `874488c4…`), y es la evidencia de `usageRights: permitted` del script
EEX y de su entorno de lectura. No es un documento contractual y no se
presenta como tal. No acredita DATA_READY, PIT, calendario contractual ni
vínculo al mandato (§6.5; DEP-06/07 siguen abiertas).

`ipExposure: none` para ambos es **juicio de auditoría IMP-04, no afirmación de
Bru**: ejecución local sobre archivos locales, motor open-source (DuckDB MIT,
pyarrow Apache-2.0 según sus `METADATA`) y script de un paquete privado
(`package.json` `"private": true`), sin modelo propietario de terceros.

## Inventario auditado

El inventario del tooling existente es el que reporta §6.5 «Tooling y
benchmark»: `src/economic-calculation/benchmark.mjs`, `generate_eex_snapshot.py`
«y su entorno de lectura» (`REAL_TOOLING_INVENTORY`, con el hash de la SPEC).
**Hipótesis (no la nombra la fuente):** el entorno de lectura es el venv
`/home/op/apps/power-markets-explorer/.venv-data`. Se deduce porque el script
importa `duckdb`, el `python3` del sistema no lo tiene y ese venv del mismo
proyecto sí: DuckDB 1.5.5 y pyarrow 25.0.1.

## Esquema real del lago (revisión 8)

Inspeccionado con `DESCRIBE` del DuckDB del venv sobre tres particiones reales
(`EEX_LAKE_SCHEMA_SAMPLES`, con sha256; un test lo repite):

- `eex_derivative_trade` (NATGAS/THE 2025-11-20): `Px`, `Tm`, `InstrumentISIN`,
  `InstrumentType`, `ShortCode`, `Maturity`, `TrdDate`, `TrdID`, `Sz`,
  `UpdtAct`, `_retrieved_at_utc`, `_row_sha256`, entre otras.
- `eex_derivative_top_of_book` (NATGAS/THE 2025-11-20 y POWER/DE 2025-08-12):
  `BidPx`, `AskPx`, `Tm`, `InstrumentISIN`, `InstrumentType`, `ShortCode`,
  `Maturity`, `TrdDate`, `_retrieved_at_utc`, `_row_sha256`, entre otras.
- Todas las columnas son VARCHAR. Top-of-book trae también spreads
  (`InstrumentType` «Futures Spread» en POWER/DE), que el filtro de producto
  exacto debe excluir.

## Herramientas auditadas

| Componente | Cubre | No cubre (verificado en código/esquema) | Derechos / IP | Usable |
|---|---|---|---|---|
| `economic-calculation.benchmark` (`benchmark.mjs`, `reference.mjs`; IMP-08) | calculate, coverage, window.boundaries, reference.select, reference.proxy (combina medias dadas), 0.01 (por validez declarada) | calendar.missing_dates; status.provisional; window.derive; official_proxy; version; `reference.select.group_by_date_instrument` (revisión 10: `selectDailyReference()` no acota por fecha/instrumento); `reference.select.validity_guard` (revisión 11: el default de compatibilidad de `declaredValidity()` PROMUEVE una fila sin `declaredValidity`, reproducido con la fila 0.01 del review); y las cinco capacidades de filas del proxy: `proxyReference()` recibe `tradesMean`/`midpointsMean` ya calculadas. Existen piezas reutilizables (`isWithinWindow()`, `isWithinFallbackWindow()`, filtro de producto y dedup por fecha de `selectBenchmarkReferences()`), pero operan sobre referencias diarias u horas locales, no sobre filas intradía con Tm UTC | Código propio; IP none | sí |
| `power-markets-explorer.venv-data.duckdb` (entorno de lectura) | reference.read.trades y reference.read.top_of_book (columnas verificadas en el esquema real) | official (el lago no tiene settlement); filtros, ventana, dedup y medias son del soporte de cálculo | permitted (P-005); IP none (juicio de audit) | sí |
| `power-markets-explorer.generate_eex_snapshot` | ninguna capacidad de IMP-05 (declara sólo `eex.snapshot.candles_4h`) | trades: su interfaz sólo emite velas 4H; top_of_book y official tampoco | permitted (P-005); IP none (juicio de audit) | sí |

## Decisión factual

1. **Cálculo de IMP-05: EXTEND `economic-calculation.benchmark`**
   - Se añaden exactamente 12 capacidades: `benchmark.calendar.missing_dates`,
     `benchmark.status.provisional`, `benchmark.window.derive`,
     `reference.select.group_by_date_instrument`,
     `reference.select.validity_guard`,
     `reference.proxy.rows.exact_product_date`, `reference.proxy.rows.deduplicate`,
     `reference.proxy.window.strict`, `reference.proxy.means`,
     `reference.proxy.window.fallback`, `reconciliation.official_proxy` y
     `benchmark.version`. La versión anterior decía que bastaban 5; omitía
     obtener las medias desde filas (revisión 8), la agrupación por
     fecha/instrumento de la selección oficial (revisión 10) y el guard de
     validez declarada de la fila oficial (revisión 11).
   - El guard de validez (`reference.select.validity_guard`, §5.3 «existe fila
     oficial válida» + §19.3.1 «contrastar validez aplicable») es el caso del
     review: el componente PROMUEVE por defecto una fila oficial sin
     `declaredValidity` (default de compatibilidad de `declaredValidity()`,
     reproducido con la fila 0.01 del review: con proxy 100 devuelve 0.01 como
     `official`). El fixture `official001MissingValidityValue` registra ese
     comportamiento observado con cómputo manual independiente y declara que
     la capacidad NO está demostrada: exigir el campo en la interfaz del
     lector no hace que el selector rechace una fila que llegue sin él.
     Implementar el guard es trabajo de IMP-05.
   - Lo cubierto se reconcilia de forma exacta: 15 salidas reales contra los
     fixtures documentales de §19.3.1 (B=105, count 2, coverage 2/3, corrección
     102→103 da 106.5, proxy 101, oficial más reciente 103, ventana [inicio,fin),
     0.01 declarado válido se selecciona, con validez `unknown` cae a 100
     `trades-only` y sin declaración se promueve — comportamiento observado,
     no capacidad).
   - **Juicio de auditoría, no cita de la SPEC:** el componente es "casi
     suficiente"; lo que falta son reglas cerradas de §5.2/§5.3/§5.4 sobre
     entradas o salidas que ya maneja (`extensionRationale`).
   - Implementar las 12 capacidades es trabajo de IMP-05, no de IMP-04.
2. **Lectura de filas EEX (trades y top-of-book): REUSE
   `power-markets-explorer.venv-data.duckdb`**
   - Único componente usable que cubre ambas. El script EEX no cubre ninguna.
   - Reconciliación exacta con fixtures sintéticos (§25.1 IMP-04): pyarrow
     escribe dos filas de trades y dos de top-of-book (una de ellas spread) en
     Parquet con particiones hive; DuckDB las lee con las mismas opciones que el
     script (`hive_partitioning`, `union_by_name`); las 22 salidas clave
     coinciden con lo escrito (`buildEexReadEnvironmentReconciliation`).
3. **Lectura del settlement oficial: BLOQUEADA
   (`BLOCKED_PENDING_OFFICIAL_SETTLEMENT_SOURCE`)**
   - Ningún componente del inventario auditado la cubre y todos son usables:
     la derivación llega a BUILD y falla por `MISSING_NECESSITY`. No se
     construye un lector sin saber qué feed, formato ni entitlement leer
     (§6.4: construir sólo si el audit demuestra necesidad).
   - El bloqueo distingue tres estados (revisión 11): (a) el hecho auditado
     dentro del inventario de §6.5 (ningún componente cubre
     `reference.read.official`, verificado contra assessments e interfaz
     real); (b) lo desconocido FUERA del inventario (la completitud del
     inventario descansa en §6.5/U-AUDIT, no en un escaneo del entorno:
     componentes no inventariados son DESCONOCIDOS, no ausentes); y (c) la
     dependencia externa P-007 (fuente autorizada de settlement, esperando al
     cliente), que bloquea IMP-05 pero NO declara un reader oficial
     disponible ni fabrica su formato/entitlement.
   - IMP-05 puede avanzar con B provisional: §5.4 y §25.2.2 IMP-05 («Un
     benchmark aún provisional conserva esa condición»).

## Fuente oficial de settlement — búsqueda (P-005)

P-005 pide determinarla primero desde las fuentes canónicas. Resultado
(`OFFICIAL_SETTLEMENT_SOURCE_SEARCH`, cada fuente con hash y un test):

- SPEC v1.1.1 §5.4 exige alinear el proxy «con un feed oficial o externo
  autorizado» sin nombrarlo; §6.5 sólo registra las raíces trade y top_of_book.
- `/srv/hot-data/EEX` sólo contiene `table=eex_derivative_trade` y
  `table=eex_derivative_top_of_book`.
- U-AUDIT (`AUDIT_INPUTS_ENERGY_MARKETS.md` §9, punto 3) la lista como paquete
  externo pendiente.
- D16 (`eex-reference-price.md` §4) e IMP-03 registran un HTTP 403 histórico en
  el endpoint de settlement «spr»: es un hallazgo, no una fuente disponible.
- P-005 declara que la fuente concreta no fue especificada.

Conclusión: ninguna fuente accesible la identifica. Es un hecho externo; se
pregunta a Bru por ese único dato.

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
- Las capacidades de lectura se comprueban contra la interfaz real: un test lee el script (hash `01353f73…`) y extrae los campos que emite; otro ejecuta `DESCRIBE` con el DuckDB del venv sobre las particiones reales con hash y comprueba cada columna atribuida al entorno; y se exige que un componente declare `reference.read.*` sólo si expone los campos de `REFERENCE_READ_REQUIRED_OUTPUTS` (§5.2/§5.3). Para `reference.read.official` el contrato incluye el timestamp de proveedor de §5.3 y la validez declarada de la fila (§§5.3, 19.3.1), y tests lo ligan a la SPEC y a `selectDailyReference()`. `validateCapabilityAssessment` rechaza el assessment de lectura que no exponga todas las salidas exigidas (`read-capabilities.mjs`), no sólo un test.

## Hashes de procedencia (bytes en este worktree)

- `src/economic-calculation/benchmark.mjs` — `0db32ff428fe41482904803664c448b9c3d984d234aff0a1bdfa91db34bc17c1`
- `src/economic-calculation/index.mjs` — `04217b163082ac848a5088a2120fb201d32b64ab9e6737b2179e7b20da2e8d66`
- `operations/receipts/IMP-08-IMP_RECEIPT.json` — `43b56173f021331a889393d3697f1ca8bdf40491e450798238044ac8decc9625`
- `/home/op/apps/power-markets-explorer/scripts/generate_eex_snapshot.py` — `01353f730d1bcba4a6cf83098b43914ee743212006aedf7ce8e548a95e491740`
- `.venv-data/.../duckdb-1.5.5.dist-info/RECORD` — `585ea64989741e6a35be3d3912dc8158c6ecac777857e666464428945a12fe8f`
- `.venv-data/.../pyarrow-25.0.1.dist-info/RECORD` — `c2658c5e3b843700ad96e5173d6006a889edeaa2f4a8351118f64fb25a3b55ca`
- `src/economic-calculation/reference.mjs` — `c8597ac83ba540b0de8b64dc2907e0e7e7c32417a02e06ee442f29d5514e511b`
- `operations/audit/IMP-04/OWNER-DECISION-P-005-EEX-RIGHTS.md` — `874488c4a91a3813ab322a51c6ee1af4244d0391c6f467b382c9b0225cf8c564`
- `/home/op/apps/power-markets-explorer/package.json` — `7b74c57654ddcb4465d526e8a04e428a7c9b78000b42a0898f26be0278d69037`
- Partición trade NATGAS/THE 2025-11-20 — `87af47d82a5af9238b92104539dacd860c872fb95c88c12e94292a0aadf0810f`
- Partición top-of-book NATGAS/THE 2025-11-20 — `8452f2afa426df01f0f871b11b28f95c3c9dd5c691087280bbff16937a116586`
- Partición top-of-book POWER/DE 2025-08-12 — `7337bfa59f57dbe0984b355f3bb3bad5a4b3933eff5830a837a80026610db9af`
- `AUDIT_INPUTS_ENERGY_MARKETS.md` — `96e0b76356f901acdaf4fed9634908818ecd4d78627955d7217792367143710f`
- `reference/documentation/eex-reference-price.md` (D16) — `dfa9cfc8e84f27ea5440ff6c5968654999b71e0c6c7370ec6653178c8e71e260`
- `operations/audit/IMP-03/audit-report.md` — `3fad9a93ee235f1c3a6745365736071ebb214c4393cdd41fcb53c3355f95758d`
- SPEC v1.1.1 — `666a9735d9daf62764582f017056171acae52070d18499b26c5c6e426cff3ef3`

## Reproducción

```
node --test test/tooling-selection/real-tooling.test.mjs
```

## Límites residuales (OPEN_ITEM)

- La reconciliación del lector necesita el venv `.venv-data` en BruNode: los tests y `deriveRealImp05ToolingDecisions()` ejecutan su `python` (la del sistema no tiene duckdb). Fuera de BruNode fallan de forma explícita.
- La capacidad de lectura es de columnas crudas VARCHAR. Parseo numérico, conversión Tm UTC → CE(S)T y exclusión de spreads son parte de los añadidos del soporte de cálculo (IMP-05).
- Settlement oficial bloqueado hasta que se identifique la fuente (ver «Fuente oficial de settlement»).

- `auditInventory` es opcional para REUSE/EXTEND en la API genérica (su criterio en §25.1/§25.2.2 es la reconciliación independiente); es obligatorio para BUILD. Las decisiones reales DEP-10 lo aportan siempre.
- El inventario lo declara quien llama, con evidencia. La API genérica sólo valida forma y coherencia con los assessments; un inventario inventado con evidencia bien formada no se detecta (mismo límite de procedencia que la reconciliación). En la decisión real, el inventario es una constante atada por test al texto y hash de la SPEC §6.5. Su completitud descansa en esa fuente (que reporta U-AUDIT), no en un escaneo del entorno.

- El validador verifica estructura y consistencia interna (salidas reales +
  fixtures `permitted` con cómputo independiente + cobertura de salidas clave),
  no procedencia criptográfica: la evidencia sigue siendo declarada por el
  llamador. Verificación por ejecución/hash de artefacto queda fuera de una
  librería pura y no es parte de este corte.
- Tolerancia: la reconciliación de salidas clave es EXACTA. Es una decisión de
  ingeniería (no una pendiente del owner): la SPEC v1.1.1 reconcilia
  "exactamente" en todo el pipeline económico — §14.8 (volumen y costes
  "reconcilian exactamente una vez"), §19.3.1 ("la conversión y la
  reconciliación exacta de unidades forman parte de estas comprobaciones") y
  §19.3 (scoring "sin epsilon ni PASS artificial") — y la independencia que
  exige el criterio de IMP-04 sólo se prueba si el recálculo replica el
  componente bit a bit: cualquier margen > 0 aprobaría un componente que se
  desvía de su propio cómputo independiente (revisión 6: tolerancia 999999
  reconciliaba 1 contra 1000000). Un margen canónico distinto requeriría
  SPEC_CHANGE_REQUEST (§20.2.12); aquí no se relajó ninguna tolerancia para
  hacer pasar resultados.
- §6.4 backtesting: la auditoría de capacidades/permisos del backtesting
  existente se cierra en el alcance auditado con el hallazgo AUSENTE (no hay
  componente). Su "resolución" para un futuro consumidor de backtesting
  corresponde a otro IMP con necesidad demostrada; aquí no se construye ni se
  presupone.
