# ST-27.1 — Strategy Admission framework: mapeo a criterios de aceptación

Packet: `WP-IMP-27-ST-1-v1.1`. Parent semántico: IMP-27. Project: Energy Markets
`96bbd5b1-94da-4781-8c2b-455fdfb28d1a`. SPEC: v1.1
`86c4bd4eeb5f9d0ebad94763128b221eb64525a2b7fff1007dab0af88b39cb6c`.
Este documento describe ingeniería de framework; no afirma edge, admisión real ni
cierre de DEP-29.

## Criterios del packet

| # | Criterio | Materialización | Evidencia |
|---|---|---|---|
| 1 | Los tres canales convergen en el mismo contrato §8.7.2; se rechazan colisiones de identidad, versión/provenance ausentes y contenido incompleto. | `channels.mjs` define los tres canales; `contract.mjs` valida los 24 campos semánticos; `registry.mjs` registra los tres canales en un proceso único y rechaza colisiones. | `channels.test.mjs`, `contract.test.mjs`, `registry.test.mjs` |
| 2 | La Strategy predefinida de Bru puede omitir discovery pero no validación ni prerequisites; completar campos no prueba readiness. | Canal 3 con `discoveryOmitted` explícito; `validationProposition` obligatoria; `validateExperimentReadiness` exige prerequisites + evidencia y rechaza estructuralmente false/null/vacíos o no-satisfacción, conservando FORMALIZED. | `channels.test.mjs`, `contract.test.mjs`, `lifecycle.test.mjs`, `registry.test.mjs` |
| 3 | Separación de lifecycle, data-readiness, run/research verdict y admisión; PASS nunca admite ni concede BUY/WAIT/orden/reward. | `lifecycle.mjs` namespaces `strategy_lifecycle`, `research_verdict` (reusado), `strategy_admission`; `resolveAdmissionFromVerdict` siempre NOT_ADMITTED; `ADMISSION_AUTHORITY` sólo otorga Evidence Generator. | `lifecycle.test.mjs`, `registry.test.mjs` |
| 4 | Cambio material crea nueva versión/experimento; FAIL/INVALID, provenance de evidencia y OOS consumido se preservan y no se resetean. | `recordVerdict` acepta un único veredicto por versión/experimento y rechaza reescribirlo (`VERDICT_ALREADY_RECORDED`), exigiendo `createNewVersion`; `admit` rechaza además cualquier versión con FAIL/INVALID en su historial. `createNewVersion` exige `materialChange`, conserva la identidad estable (canonical name e intake channel) y toma provenance del contrato entrante, preserva `priorFindings` (FAIL/INVALID, deduplicados), `evidenceRefs` append-only y `oosConsumption`; `consumeOos` irreversible. | `registry.test.mjs` |
| 5 | Tests de casos positivos y adversariales de todos los canales, prerequisites falsos/ausentes, PASS sin admisión y preservación de versiones. El receipt sólo reclama ingeniería de framework. | 59 tests en `test/strategy-admission/*.test.mjs`; `boundary-cases.json`. | `strategy-admission-tests.txt`, `strategy-admission-tests.tap` |
| 6 | ST_RECEIPT §20.2.8 completo, honesto, con scope/versión, fallos y hechos no resueltos; hashes de prerequisite preservados y prueba de no-escritura fuera de allowed_paths. | `operations/receipts/IMP-27-ST-1.json`; `environment-and-inputs.txt`; `write-set-manifest.json`. | Este directorio |

## Parent IMP-27 acceptance context

| Criterio del padre | Cobertura de ST-27.1 |
|---|---|
| Registro único de tres canales, campos/lifecycle y versiones | Cubierto: registro único, 24 campos, lifecycle namespaced y cadena de versiones. |
| Para evaluación concreta, evidencia y resolución de admisión con su scope | Framework habilitado; la evaluación concreta (DEP-29) queda fuera de alcance y no se ejecuta. |
| Bru puede omitir discovery pero no validación | Cubierto por canal 3 + validación obligatoria. |
| PASS no admite automáticamente | Cubierto: admisión explícita, FAIL/HOLD no admiten. |
| Cambio material conserva FAIL y crea versión/experimento | Cubierto. |
| No órdenes ni reward local | Cubierto: `ADMISSION_AUTHORITY.denies` incluye orden, BUY/WAIT, sizing y reward independiente. |
| Cierre técnico del framework no cierra DEP-29; una admisión concreta exige su evidencia real | Explícito: todos los candidatos/evidencias de test son sintéticos; no se declara admisión real ni DEP-29. |

## Límites explícitos

- No se propone ni evalúa ningún candidato real.
- No se adjudica evidencia automáticamente.
- No se modifica `src/contracts/index.mjs`; el módulo nuevo se importa directamente.
- No se toca Alexandria ni los directorios compartidos de la oficina.
- El timer de continuidad permanece OFF.
