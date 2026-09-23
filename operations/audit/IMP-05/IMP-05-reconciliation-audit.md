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

- La respuesta del cliente verificada (P-007,
  `ENERGY_MARKETS_CLIENT_INPUTS_2026-09-23/full-package/03_sources_benchmark_access/sources_benchmark_access.md`)
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

## Límites residuales

- B reproducido sobre campañas/fechas auditadas (DEP-08/09) queda PENDIENTE:
  este corte materializa la metodología y sus fixtures sintéticos; no abarca
  campañas reales ni su metadata oficial.
- La reconciliation sobre snapshots del lago real (trades/top-of-book por
  fecha/instrumento auditado) es el consumo de este soporte por el audit de
  fechas; este corte no produce una receipt de reconciliación real.
