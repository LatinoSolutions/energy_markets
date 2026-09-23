# ST-28.1 — Framework de evaluación por rol: mapeo a criterios de aceptación

Packet: `WP-IMP-28-ST-1-v1.1`. Parent semántico: IMP-28 (LAT-113). Project:
Energy Markets `96bbd5b1-94da-4781-8c2b-455fdfb28d1a`. SPEC: v1.1
`86c4bd4eeb5f9d0ebad94763128b221eb64525a2b7fff1007dab0af88b39cb6c`.
Este documento describe ingeniería de framework; no afirma valor empírico,
admisión de rol real ni cierre de DEP-28.

## Criterios del packet

| # | Criterio | Materialización | Evidencia |
|---|---|---|---|
| 1 | Registrar las cuatro clases de §11.6.1 y los catorce campos de §11.6.2; identidad exacta componente/rol/protocolo/versión y comparator/value hypothesis predeclarados en readiness. | `roles.mjs` declara las cuatro clases; `contract.mjs` define 5 campos de identidad + 14 de §11.6.2; `registry.markEvaluationReady` exige prerequisites y evidencia. | `roles.test.mjs`, `contract.test.mjs`, `registry.test.mjs`, `boundary-cases.json` |
| 2 | JEV sin clasificación previa; outcomes independientes por rol, sin admitir otro rol ni confundir research verdicts. | No hay rol por defecto ni S6; `role_admission` separado de `research_verdict` (HOLD namespaced); `recordOutcome` escribe sólo su (componente, rol). | `roles.test.mjs`, `outcomes.test.mjs`, `registry.test.mjs` |
| 3 | Evaluación inicial sin autoridad productiva; requested ≠ granted; Strategy/Evidence exige gate IMP-27/§8.7; Execution/Governance exige validación separada. | `initialAuthorityGrant()=[]`, `hasProductiveAuthority()=false`; `validateStrategyAdmissionGate`; `validateRealActionPrerequisite` devuelve NO_PRODUCTIVE_AUTHORITY / MISSING_AUTHORITY_VALIDATION. | `outcomes.test.mjs`, `registry.test.mjs`, `boundary-cases.json` |
| 4 | Preservar coste/latencia/carga y desconocidos, overlap, reproducibilidad y retirada/rollback; ingeniería no es procurement edge; sin rol con valor no hay integración. | `contract.mjs` valida costBurden (desconocido con razón) y rollback; `validateValueClaimDomain` rechaza PROCUREMENT_EDGE fuera de Strategy/Evidence; `evaluateIntegration` nunca integra y exige ADMIT. | `contract.test.mjs`, `roles.test.mjs`, `registry.test.mjs`, `boundary-cases.json` |
| 5 | Tests de protocolo incompleto, evidencia/gates ausentes, separación por rol, sin autoridad/default JEV y outcomes/versiones inmutables. El framework no cierra DEP-28 ni admite componente. | 30 tests en `test/role-evaluation/*.test.mjs` + 14 casos límite; todos los fixtures sintéticos. | `role-evaluation-tests.txt`, `role-evaluation-tests.tap`, `boundary-cases.json` |
| 6 | ST_RECEIPT §20.2.8 completo, honesto, con scope/versión, fallos y hechos no resueltos; hashes de prerequisite preservados y prueba de no-escritura fuera de allowed_paths. | `operations/receipts/IMP-28-ST-1.json`; `environment-and-inputs.txt`; `write-set-manifest.json`; `validate-receipt.mjs`. | Este directorio |

## Parent IMP-28 acceptance context

| Criterio del padre | Cobertura de ST-28.1 |
|---|---|
| Registro por componente/rol, hypothesis/comparator/boundary, evidencia reproducible, ADMIT/HOLD/REJECT y retirada/rollback | Framework habilitado: contrato, readiness, outcomes namespaced e inmutables, evidencia y rollback. |
| JEV sin clasificación previa; cuatro clases y outcomes independientes | Cubierto: sin rol por defecto, cuatro clases, aislamiento por rol. |
| Rol Strategy/Evidence pasa por §8.7 | Cubierto estructuralmente: readiness exige gate externo aceptado IMP-27/§8.7. |
| Engineering se mide operacionalmente sin reclamar edge | Cubierto: `PROCUREMENT_EDGE_NOT_ALLOWED` para roles no Strategy/Evidence. |
| Execution/Governance recibe validación separada | Cubierto: `MISSING_AUTHORITY_VALIDATION` sin validación §§16–18. |
| Ningún rol gana autoridad durante discovery | Cubierto: cero autoridad productiva en todo outcome. |
| Sin valor suficiente en ningún rol, componente fuera | Cubierto: `evaluateIntegration` con `NO_QUALIFYING_ROLE`, nunca integra. |
| No S6 por defecto, integración obligatoria, duplicación Paperclip, auto-admisión ni redefinición frozen | Cubierto: sin S6, sin integración, overlap declarado, sin auto-admisión. |

## Límites explícitos

- No se evalúa ni compara ningún componente real (JEV incluido).
- No se ejecuta role-discovery, capability evaluation ni comparador estadístico.
- No se integra ninguna herramienta ni se concede autoridad.
- No se modifica `src/contracts/index.mjs` ni `src/strategy-admission/**`; el
  framework se importa directamente y reutiliza `src/contracts` read-only.
- No se cierra DEP-28 ni se admite ningún rol real.
- No se toca Alexandria ni los directorios compartidos de la oficina.
- El timer de continuidad permanece OFF.