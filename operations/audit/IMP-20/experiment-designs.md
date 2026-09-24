# IMP-20 — Diseños predeclarados de experimentos posteriores: S2–S5 y Z/drivers admitidos

Fecha: 2026-09-24. Parent: IMP-16 aceptado (resultado y límites del núcleo conservados; no exige S1 PASS).
Fuente normativa: `docs/canonical/v1_1_1/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1_1.md`, §25.1 fila IMP-20, §25.2 (DEP-15/16, REQUIRES*), §§7–10, §19. Código/tests: `src/imp20-experiments/` y `test/imp20-experiments/`.

## Qué es esta entrega

Materializa el objetivo de IMP-20: **diseñar** (predeclarar) los experimentos "después" del núcleo, no ejecutarlos. Cada diseño declara identidad de instancia (§25.2.1), capa(s) ensayada(s), topología de §8.6, arms con ablation, **misma contabilidad** que el núcleo (§25.1: valor marginal y redundancia con misma contabilidad), criterios de refutación predeclarados, scopes de audit/mapping a consumir (REQUIRES_AUDIT, no RESOLVES_AUDIT), desconocidos visibles y ruta de admisión posterior vía §8.7 — nunca automática.

## Los seis diseños predeclarados

| ID | Capa | Topología | Pregunta |
|---|---|---|---|
| IMP20-EX-S02-01 | S2 Anomaly Detection | Independent ablation | ¿El valor marginal de la evidencia de shock sobre A0/A1, con simetría up/down y sin convertir severity en BUY/WAIT? |
| IMP20-EX-S03-01 | S3 Trajectory / Repricing | Independent ablation (+ arm simplificada Dynamic Mode) | ¿Identifica establemente OOS cuándo WAIT empeora? ¿Dynamic Mode absorbe su valor? |
| IMP20-EX-S04-01 | S4 Structure / Range Transition | Parallel evidence producer | ¿Estados estructurales reproducibles point-in-time con valor de gate, sin absorber todo Dynamic Mode? |
| IMP20-EX-S05-01 | S5 Conditional Pullback Timing | Serial S1→S5 (hipótesis de composición) | ¿Esperar un pullback tras activarse la premisa S1 mejora coste sin dominar el riesgo de no-fill? |
| IMP20-EX-Z01-01 | Z_t = (m,e,c,q,u) | Independent ablation (completa y por subsets) | ¿Alguna representación de Z añade valor económico frente a representaciones más simples? Poda por ablation. |
| IMP20-EX-D01-01 | Drivers E1–E9/G1–G10/X1–X4 | Independent ablation (por muestra mapeada) | Mapping a fuentes reales + redundancia/valor marginal de los bloques mapeados; áritica/completitud por evidencia (§7.2.5). No 23 features obligatorias. |

## Guardas duras implementadas (fail-closed, con test)

- **No ampliar P5** (§25.1): ninguna población/baseline/OOS/S1/verdict modificable; no rescue de hipótesis refutadas (§13.9).
- **No 23 drivers obligatorios** (§7.2): mapping por muestra; taxonomía cerrada declarada (`§7.2.5`).
- **No meta-policy automática** (§8.6/§9.2): la híbrida sólo es candidata de research (`topologyResearchOnly`); ninguna outcome concede admisión u autoridad (§8.7.4, §§16–18).
- **Un solo reward global** (§10.1): sin rewards económicos por capa.
- **Paridad de contabilidad** (§8.6/§13.9): toda arm comparte B, controller/sizing, execution P5.6, evaluator P6 y frontera OOS; comparator = evidencia previa de IMP-16 (DEP-13/14) consumida **read-only**.
- **REQUIRES_AUDIT ≠ RESOLVES_AUDIT** (§25.2.1/§25.2.2): scopes declarados como `resolvesAudit=false`.
- **Testing traceability**: hash de los diseños ligado por test al SHA-256 real del doc canónico (`666a9735…ff3ef3`).

## Desconocidos visibles (registros activos)

- `UNK-EEX-AUDIT` (todos): audit DEP-06/07 del lago EEX pendiente; benchmark UNRECONCILED. Bloquea ejecutar el run económico; NO bloquea esta predeclaración. Trabajo interno (IMP-03/05/06).
- `UNK-SURPRISE-REFERENCE` (Z/drivers): SURPRISE exige expectativa documentada previa (§7.2.1); sin ella queda UNAVAILABLE.
- `UNK-Z-CALCULUS` (Z): cálculos concretos m/e/c/q/u no congelados por §7.1; no se importan números de Alexandria.
- `UNK-SERIAL-ADMITTED-LAYERS` (S5 serial): la ejecución serial depende de las capas realmente admitidas por §8.7; el diseño no presume admisiones.

No hay entrada HUMAN_DECISION en este alcance: todo pendiente es ingeniería/auditoría interna o evidencia futura por detalles de los contratos vigentes.
