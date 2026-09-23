# ST-08.2 acceptance matrix

Packet `WP-IMP-08-ST-2-v1.1`, subtask ST-08.2, parent IMP-08. Project Energy
Markets `96bbd5b1-94da-4781-8c2b-455fdfb28d1a`. All inputs and expected values
are synthetic; this is not a research PASS and does not close IMP-08, DEP-13 or
P6.

| # | Criterio del packet | Materialización | Evidencia |
|---|---|---|---|
| 1 | API pública reutilizable sin lookup de expected results, dispatch por fixture ni import del oráculo; los 35 fixtures mapean a un test; C01–C12 trazados. | `src/economic-calculation/{reference,benchmark,bhv,scoring,index}.mjs` son funciones genéricas; `fixture-coverage-matrix.json` mapea los 35 fixtureId a tests ejecutados; los tests afirman valores literales. | `test/economic-calculation/*`, `fixture-coverage-matrix.json`, `economic-tests.txt` |
| 2 | Referencia/benchmark: proxy 101 desde 100/104, fuentes únicas y missing, B=105, oficial 102→106, corrección 103→106.5 por timestamp, missing que recalcula cobertura; ventanas 1-0-1/3-1-3 y fallback ±60; consumibilidad; guard 0.01. | `proxyReference`, `selectDailyReference`, `benchmarkB`, `isWithinWindow`, `isWithinFallbackWindow`, `isDecisionConsumable`, `classifyOfficialValidity`. | `benchmark.test.mjs` |
| 3 | B/H/V con H sintético y provenance de cobertura/unidad, signos, cobertura visible; missing/null/no finito/unidad incompatible sin coerción a cero; sin MW→MWh; sin fee→0; correcciones no cambian H. | `computeV`, `computeAllInH`, `computeTotalEur`, `classifyCoverage`. | `bhv.test.mjs` |
| 4 | Scoring Quarterly exacto +4/-1, +3/-1, +2/-2; neutrales preservan n_nonzero; población vacía/cero/n<2/grupos vacíos; sin epsilon/anualización; n no sustituido por n_total. | `scoreQuarterly`. | `scoring.test.mjs` |
| 5 | Monthly separado del screen Quarterly; mínimo de evidencia; C diagnóstico; poblaciones producto/Mission separadas; veredicto de research distinto de la aritmética; cobertura incompleta, benchmark provisional y entradas inválidas no se ocultan tras un score alto. | `monthlyDiagnostics` (HOLD de alcance con razón decidida por criterio económico y evidencia, no por el Sortino), `minimumEvidence`, `cDiagnostic`, `quarterlyResearchVerdict` con canal explícito `dataQuality` (INVALID si `invalidCount>0`; HOLD si cobertura no `full` o benchmark provisional; nunca PASS). | `scoring.test.mjs` (casos de ocultación de criterio 5 y casos Monthly), `bhv.test.mjs` |
| 6 | Salida real de tests; observaciones de LAT-126 (checks declarativos ahora ejecutables, coerción null de H/B rechazada); hashes de prerequisites y oráculo intactos; sin escrituras fuera de allowed_paths. | Suite ejecutada; `write-set-manifest.json`; `baseline-and-environment.txt`. | `economic-tests.txt`, `contracts-tests.txt`, `write-set-manifest.json` |
| 7 | ST_RECEIPT §20.2.8 completo, checkpoint y artefactos revisables; una revisión independiente nativa. | `operations/receipts/IMP-08-ST-2.json`; documento `continuity-checkpoint`. | Receipt + revisión nativa |

## Notas de independencia

- Los tests afirman valores literales transcritos del oráculo ST-08.1; no cargan
  `fixtures.json` ni regeneran expected results desde la implementación.
- El oráculo aceptado (`fixtures.json`, `independent-calculations.md`) permanece
  intacto; sus hashes se verifican en `write-set-manifest.json` y en el receipt.
- H es un valor all-in suministrado; no se implementa ninguna fórmula de ledger
  real.
