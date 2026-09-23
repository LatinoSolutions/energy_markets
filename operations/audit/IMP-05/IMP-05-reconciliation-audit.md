# IMP-05 · Reproducir benchmark y auditar reconciliación official/proxy

Fecha: 2026-09-23. Rama: `run/energy-markets-IMP-05-20260923-211322-opencode`.
Fuente normativa: SPEC v1.1.1 §25.1 IMP-05, §25.2.2 (REQUIERE: IMP-02, 03, 04
aceptados; REQUIRES_AUDIT DEP-01/03/06/07/10; DEP-08/09 no cerrados), §5.2–5.4,
§6, §19.3.1. Fuente de decisión técnica: assessment DEP-10
(`operations/audit/IMP-04/DEP-10-real-tooling-assessment.md`, revisión 11:
EXTEND de `economic-calculation.benchmark` con exactamente 12 capacidades).

## Qué se materializó (decisión EXTEND de DEP-10)

Las 12 capacidades del añadido viven en `src/economic-calculation/reconciliation.mjs`,
exportadas desde `src/economic-calculation/index.mjs`, y se cubren en
`test/economic-calculation/benchmark-imp05.test.mjs` (27 tests, todos pasan):

| Capacidad | Fuente | Nota |
|---|---|---|
| `benchmark.window.derive` | §5.3 | 1-0-1 `[S-1 mes,S)` y 3-1-3 `[Q-4 meses,Q-1 mes)`, recorte calendario |
| `benchmark.calendar.missing_dates` | §25.2.2, §5.3 | calendario esperado separado; missing trazados, nunca cero |
| `benchmark.status.provisional` | §5.4 | BENCHMARK_PROVISIONAL si la cobertura no es exclusivamente oficial |
| `benchmark.version` | §25.1, §5.4, §19.3.1 | versión sha256 del cómputo canónico; corrección → versión nueva, previa preservada |
| `reference.select.group_by_date_instrument` | §5.3 (revisión 10) | agrupa por fecha e instrumento exactos; corrección más reciente dentro del grupo; fechas sólo-proxy incluidas |
| `reference.select.validity_guard` | §5.3, §19.3.1 (revisión 11) | fila oficial sin `declaredValidity` nunca se promueve; angostamiento del default de compatibilidad legacy del componente IMP-08 |
| `reference.proxy.rows.exact_product_date` | §5.2 | filtro producto+fecha exactos; exclusión trazada de spreads y filas no accesibles |
| `reference.proxy.rows.deduplicate` | §5.2 | observaciones idénticas colapsan a una |
| `reference.proxy.window.strict` | §5.2 | 17:00/17:05–17:15 CE(S)T con conversión UTC/DST (Europe/Berlin, Intl) |
| `reference.proxy.means` | §5.2 | m_j=(bid+ask)/2, T̂, M̂ aritméticas sobre filas del producto/fecha exactos |
| `reference.proxy.window.fallback` | §5.2 | `nearby-60m` / `eex-derived-reference`, sólo si la estricta queda vacía |
| `reconciliation.official_proxy` | §5.4 | δ_d, conservación de ambos valores, setEqual / N, fail-closed |

## Caso 0.01 — investigación (§25.1, §19.3.1)

Cumplimiento por **validez declarada, nunca por valor**: 0.01 con validez
`valid-under-explicit-fixture-assumption` se selecciona como oficial; con
`unknown` cae al proxy; sin declaración queda excluido y fail-closed a missing
(`officialRowValidity`, `selectOfficialReferencesByDate`). No hay regla
canónica de rechazo de 0.01 (§5.4) y el helper aceptado `classifyOfficialValidity()`
sigue registrando el guard reportado como limitación una sola vez:
`reject-as-placeholder` es comportamiento reportado, no regla.

## Decisión de ingeniería declarada (no silenciosa)

El selector §5.3/IMP-05 (`selectOfficialReferencesByDate`) aplica el guard de
validez estricto. El hermano legacy `selectDailyReference()` conserva el default
de compatibilidad documentada de los fixtures sintéticos IMP-08 (revisión 11 lo
reproducía); el camino canónico v1.1.1 es el estricto y los tests de tooling
siguen verificando el comportamiento histórico del legacy sin confundirlo con
capacidad.

## Estado de reconciliación oficial (fail-closed, P-007 + DEP-06/07/08/09)

- La respuesta del cliente verificada (P-007, 23-sep-2026,
  `ENERGY_MARKETS_CLIENT_INPUTS_2026-09-23/full-package/03_sources_benchmark_access/sources_benchmark_access.md`,
  SHA-256 `bc693deff46332ab89be945d3a5e10511a46c02cce0c820434aa666f1d30a615`,
  incluido en el manifest de `OFICINA_INTAKE_VERIFICATION.json`, verificado
  byte-a-byte 2026-09-23T15:40Z)
  NO entrega feed/endpoint/formato/entitlement oficial de settlement ni
  override Fundamental: instruye usar el benchmark EEX del research team
  existente y resolver/versionar los edge cases (incluido 0.01) dentro de la
  implementación, no escalando al cliente como requisito Fundamental.
- `reference.read.official` sigue BLOQUEADA
  (`BLOCKED_PENDING_OFFICIAL_SETTLEMENT_SOURCE`, assessment DEP-10): el lago
  `/srv/hot-data/EEX` sólo contiene trade y top_of_book necesarios para el
  proxy; no hay lector oficial ni feed autorizado identificado.
- Por lo tanto el reconciliador `reconcileOfficialProxy()` reporta
  `equivalent: false` SIEMPRE: sustitución no demuestra equivalencia
  proxy≈settlement (§5.4). El benchmark reproducible conserva
  `BENCHMARK_PROVISIONAL`.
- Reconciliación ejecutada (los fixtures que cierran este corte): fixtures documentales §19.3.1 exactos (102 sobre
  100 → B=106 con proxy preservado; corrección 102→103 → 106.5; oficial que
  completa un missing recalcula conjunto/numerador/denominador; peso diario
  100+110→B=105).

## Correcciones de revisión 2026-09-23 (ciclo «corregir»)

- IMP05-REC-01: `buildDateMap`/`reconcileOfficialProxy` conservan procedencia
  por fecha en ambas vistas (`source`, `providerTimestamp`, `rowHash`; ausencia
  = `null`, nunca fila borrada) y exponen `receipt` sha256 del núcleo
  reconciliado, insumo del reconciliation receipt §25.1.
- IMP05-REC-02: `officialMinusProxy` sólo se expone cuando
  `equalityComparable` (N fechas sin cambios, §5.4) y es `−meanDelta`; con
  conjuntos distintos queda `null` (antes expuso la diferencia de medias de
  vistas desiguales).
- IMP05-PROXY-01: el fallback §5.2 se activa cuando la ventana estricta no
  tiene *datos utilizables* (precio finito o bid+ask finitos), no cuando
  carece de filas; «accesible» (disponibilidad declarada de la fila) y
  «utilizable» (contenido que alimenta T̂/M̂) quedan distinguidos.
- IMP05-PROV-01: en el assessment aceptado IMP-04, la versión semántica
  ST-08.5 (`contentHash`, receipt IMP-08) se conserva como versión de registro
  y la versión post-EXTEND ahora es `postExtensionContentHash`, recomputable
  desde `evidenceRefs` (ordenadas, «<sha256>  <path>\n»), con test que la
  verifica; `src/economic-calculation/reconciliation.mjs` entra en
  `evidenceRefs` con su hash real. Nunca se modifican los receipts aceptados.

## Benchmark reproducido sobre fechas auditadas del lago (ESTA ENTREGA)

Cierre del hallazgo de review IMP05-SCOPE-01 (§25.2.2: DEP-08/09 son
RESOLVES_AUDIT de IMP-05, no queda fuera de alcance; el «no requiere DEP-08/09
cerradas» sólo exime de blockers de inicio):

- Extracción read-only del lago EEX auditado (IMP-03 ST-03.2):
  `extract-lake-proxy-rows.py` → `lake-proxy-rows-IMP-05.json` (5 fechas
  auditadas reales, dedup exacto, reglas declaradas en el artefacto).
- Benchmark proxy-side + cobertura por fecha: `build-lake-benchmark.mjs` →
  `lake-benchmark-receipt-IMP-05.json` (receipt SHA-256
  `d977288890d2589d93521b5576969fd7e693e13c3e56639794071019c7f63283`,
  reproducible por `test/economic-calculation/benchmark-imp05-lake.test.mjs`
  desde el artefacto de extracción):
  - Contrato por fecha (regla provisional declarada): G0BQ Q4-26
    (`DE000C28QDW6`, ExpiryDate 2026-09-28), Gas Quarterly del contenido del
    lago; NO es el contrato de campaña.
  - B proxy-side con peso igual por fecha: las 5 fechas con referencia,
    `windowUsed: strict`, fuentes midpoints-only (la muestra del lago en esas
    fechas no aporta trades con Px utilizable).
  - Cobertura por fecha separada: 5/5 del calendario auditado de la muestra;
    missing trazado, nunca rellenado.
  - Estado §5.4: `BENCHMARK_PROVISIONAL` (informado, no elevado).
  - Reconciliación: vista oficial vacía (v. abajo) → `equivalent: false`
    fail-closed, con receipt de motor §25.1 reproducible y procedencia por
    fecha (hashes y timestamps de fila cuando estén disponibles).
- Bloqueadores factuales declarados (no «fuera de alcance»):
  - DEP-01/03 DOCUMENTED_ABSENCE (report aceptado IMP-02): no hay mandato real
    de campaña (Campaign ID, producto/contrato, calendario, deadline). Mientras
    falte, el B de campaña y la vista oficial no pueden producirse sin inventar;
    esta entrega reproduce la máquina sobre fechas auditadas reales.
  - DEP-06/07 parcial: sólo R-04 AVAILABLE NOW en el lago auditado (ST-03.2);
    ninguna fila oficial de estas fechas está disponible.

## Límites residuales

- La vista oficial (`reference.read.official`) sigue BLOQUEADA:
  `BLOCKED_PENDING_OFFICIAL_SETTLEMENT_SOURCE` (assessment DEP-10); el lago
  sólo contiene trade y top_of_book. P-007 está resuelta como instrucción del
  cliente de usar el benchmark EEX existente y resolver los edge cases dentro
  de la implementación; no significa que exista un feed oficial demostrado.
- Benchmark de campaña completa (calendario/contrato/metadata auditados,
  DEP-01/03 y DEP-08/09 de campaña) queda pendiente de un bloqueo factual
  registrado: requiere el mandato real, no la regla provisional declarada en
  esta entrega.
