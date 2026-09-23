# PROCUREMENT RESEARCH — Canonical Consolidation Report

Versión 1.1.1 · 2026-09-22. Informe de `PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1_1.md`. Incorpora la confirmación actual de Bru y el audit de inputs; no redefine la arquitectura ni el implementation plan. El cambio factual se registra en `PROCUREMENT_RESEARCH_v1_1_to_v1_1_1_PATCH_REPORT.md`. Las secciones históricas sobre D00–D18 y D1–D5 conservan su alcance v1.1/2026-09-18; no son una nueva inspección de esos originales.

## Estado de esta actualización

Cantidades incorporadas a SPEC §4.1; EEX incorporado a §6.5; CCR-08 y CCR-13 actualizados; DEP-01/06/07/08/10 distinguen lo conocido de lo pendiente. No se cambian objetivos, criterios ni la matriz de dependencias IMP-01–29. El detalle vigente está en §9 de este informe; el audit original y su CSV se conservan sin reescribir.

**Publicación:** archivos corregidos entregados en esta conversación. Se publicó además una nota factual en LAT-91 mediante `office_issue_update`, action ID `office-admin-7da9d984ae124fb78165`, y se comprobó mediante lectura independiente. Eso no reemplaza los Markdown del Mac/BruNode ni activa la SPEC 1.1.1 en el runtime.

# 1. Documentos leídos y baselines

La consolidación histórica v1.1 registró **19 fuentes leídas completas**: D00–D17 durante la consolidación v1.0 (el prompt y 17 documentos de contenido: 15 PDF, **185 páginas**, más tres textos), y D18 leído íntegramente durante este patch. El acumulado contiene 15 PDF y cuatro textos. No se afirma haber vuelto a leer las 185 páginas en esta fase.

Los **tres inputs de la fase histórica v1.1** fueron la SPEC v1.0, su Consolidation Report v1.0 y D18. Los dos Markdown v1.0 son baselines derivadas del mismo corpus; no se suman otra vez como fuentes independientes. Se revisaron contra D18 y se verificó la preservación de los bloques no afectados. D1–D5 son las etiquetas de decisiones dentro de D18, no los IDs bibliográficos D01–D05.

La lectura inicial incluyó cuerpo, apéndices, tablas, ecuaciones, provenance y páginas de notas; se contrastaron fórmulas/tablas críticas con renderizados. Las páginas citadas son físicas desde 1. La tabla conserva las huellas de los adjuntos efectivamente utilizados, sin contar notas internas, renderizados ni documentos externos mencionados pero no recibidos.

| ID | Documento leído íntegramente | Cobertura de lectura | SHA-256 del adjunto |
|---|---|---|---|
| D00 | Pasted text.txt | Texto íntegro | `6b22e406175619953cd8ef085916da1c35f2782efdbdde054c7c41cac9786648` |
| D01 | PROCUREMENT_RESEARCH_Master_Plan_P7_Canonical_Decisions_v1_0_2026-09-16.pdf | pp. 1–12 de 12 | `269da0f07b2b2eb1302c36093db772151cc1a77f7c52646394243044412e5915` |
| D02 | PROCUREMENT_RESEARCH_Master_Plan_P6_Canonical_Decisions_v1_0_2026-09-16.pdf | pp. 1–13 de 13 | `97513b334ddd7c7a632a1fbf63968aed6720f76c0d88e1d077550e2b90473e86` |
| D03 | PROCUREMENT_RESEARCH_Master_Plan_P5_Canonical_Decisions_v1_0_2026-09-16.pdf | pp. 1–12 de 12 | `0ff9e0bf8e1b50264f56e96607eeab6bf7b5cecd3aa9f9c3ef71e5dc6e3ad730` |
| D04 | PROCUREMENT_RESEARCH_Master_Plan_P1-P4_Canonical_Decisions_v1_0_2026-09-16.pdf | pp. 1–10 de 10 | `697def17ce9c795227aaf9fd2a41ba2519f777415c2d3872d9ddd51e56fb739e` |
| D05 | PROCUREMENT_RESEARCH_Master_Plan_Open_Points_v1_0_2026-09-16.pdf | pp. 1–10 de 10 | `af5db8b876081c46dc3a23337aae130a09f81c8aebe283013b271b3e49c9a82e` |
| D06 | PROCUREMENT_RESEARCH_Revision_Action_Plan_v1_0_2026-09-16.pdf | pp. 1–9 de 9 | `d3742e73bb42b919bdf7daf2b67ccae5bd5cbdff3e19774c27f437ceb8e81029` |
| D07 | accion_plan.md | Texto íntegro | `d46b5ad0cb81a30320644e8973590f805d3005e7d5c3a736e5d558fbc009b573` |
| D08 | Power_Gas_Plan_Maestro_v1_1_2026-09-14.pdf | pp. 1–19 de 19 | `85b2b8b09edc7414e32f66423712e685c76447569ced8e1fda0632608d3a999f` |
| D09 | PROCUREMENT_RESEARCH_Global_Reward_Architecture_v1_0_2026-09-16.pdf | pp. 1–6 de 6 | `c568a8dcefcdb1ed33e2e1e83e1ec3ebd8f29f4406130418fd53a3b43f2f6f11` |
| D10 | STRATEGY_RESEARCH_Strategy_Catalogue_and_Learning_Architecture_v1_0_2026-09-15.pdf | pp. 1–18 de 18 | `207bda4bdf78e161459cf41a56e936786af8c3bc679486226885dd64c08458c4` |
| D11 | STRATEGY_RESEARCH_Q02_Strategy_Catalogue_S1-S5_v0_1_2026-09-15.pdf | pp. 1–13 de 13 | `030950c7feaddd9a6f814e07e7c0a1c482263f7bded7a1d30e1dea22c2242b92` |
| D12 | STRATEGY_RESEARCH_Resolucion_13_Preguntas_v0_1_2026-09-15.pdf | pp. 1–20 de 20 | `eeda70c76706749fa20c9603fac0218a3e5eb5a74cb54534c58e7f714fff608a` |
| D13 | RESEARCH_Fundamental_Price_Drivers_v0_1_2026-09-15.pdf | pp. 1–11 de 11 | `d500535fa8e65b6eeddf4564383dfccb2d4e6a0a11b5c0ba4bc54a51f3a30ef8` |
| D14 | ALEXANDRIA_MARKET_DYNAMICS_SENTIMENT_RESEARCH_IDEA_V1.pdf | pp. 1–16 de 16 | `d822a5f1e223c2b0d0efa6c3fe422f1a0ab41e50371109d633c5d978d9f17d5b` |
| D15 | Power_Gas_Cuaderno_Investigacion_13_Preguntas_v1_2026-09-14.pdf | pp. 1–10 de 10 | `f814aed7d7999e83772c833591264cbf8f6e084506344142feacf5b41235d654` |
| D16 | eex-reference-price.md | Texto íntegro | `dfa9cfc8e84f27ea5440ff6c5968654999b71e0c6c7370ec6653178c8e71e260` |
| D17 | sortino-handout.pdf | pp. 1–6 de 6 | `8359d64717cced29a90094ea62bdc32e43ffbd965be93487707e2974fc138d22` |
| D18 | PROCUREMENT_RESEARCH_v1_1_PATCH_DECISIONS_D1-D5.md | Texto íntegro; 1.032 líneas | `41c67454486edce6023c854ce7a1a0a461ba473927c35d7913fb4535196f2c86` |

| Baseline derivada | SHA-256 preservado |
|---|---|
| SPEC v1.0, archivo original sin modificar | `979eacecba4dacc79f521ec97f5cafbed9096bec9c999275e8d51fb75d7c840f` |
| Consolidation Report v1.0, archivo original sin modificar | `0e2f333f741faeb3d56ccbabc52e8f74c4857c5cb5381c93425ac0b911ca4537` |

# 2. Precedence decisions

D18 es autoridad explícita posterior para D1–D5 y sus consecuencias mínimas sobre v1.0. Mantiene la baseline y prohíbe reconstruir la SPEC, reinterpretar decisiones frozen o reabrir P1–P7. Los estados históricos del corpus conservan la resolución de v1.0 salvo los cambios concretos registrados aquí. No se atribuye a D18 una fecha interna que no consta: su recepción y esta entrega son del 2026-09-18.

| Ámbito | Autoridad utilizada | Decisión de precedencia |
|---|---|---|
| Procurement, B/H/V, scoring y PIT | D04 P1–P4 | Reemplaza los estados históricos abiertos de D05/D08/D12 sin atribuir evidencia a lo sólo documentado. |
| Primer experimento | D03 P5.1–P5.9 | Respeta D04 y congela Gas Quarterly, S1, A0/A1, controller, paridad, refutación y OOS. |
| Evaluator | D02 P6.1–P6.10 | Respeta P1–P5; medir no incluye entrenar, optimizar ni reparar el diseño. |
| Learning y autonomía | D01 P7.1–P7.8 | Respeta P1–P6, refina arquitectura global/Value/governance y mantiene selección algorítmica dependiente de evidencia. |
| Global Reward | D09, refinado por D04/D01 en sus respectivos ámbitos | Un objetivo global; variantes numéricas siguen candidatas; inicial BUY/WAIT y Monthly ya tienen cierre posterior específico. |
| S1–S5 | D10 v1.0; guardrails D03/D01 | V1.0 reemplaza workbook D11; nombres canónicos del mapa p.2. Títulos ampliados y abreviaturas no crean Strategies nuevas. |
| Drivers | D13, con cierre posterior D06 Step 3 | 9+10+4 y fronteras cerrados; completeness/data mapping/poda no reabren el concepto. |
| Q01–Q13 y método | D12, D06 y cierres específicos P1–P7 | Se conserva intención y función de cada pregunta; antiguos OPEN no se copian como pendientes actuales. |
| Benchmark/scoring de referencia | D16/D17 incorporados por D08 y D04 | Se conserva matemática y distinción oficial/provisional. No se eleva una descripción de código externo a audit realizado. |
| Alexandria | Sólo contenido incorporado por D08/D12/D13 y contratos posteriores | Su semántica adoptada informa Z; escalas, fórmulas, workstreams, trading y gates propios no completan huecos de procurement. |
| Action Plan / Master Plan | D06/D07/D08, en lo no sustituido | Marco de trabajo y provenance; no recuperan autoridad sobre definiciones posteriores por contener más detalle. |
| Patch dirigido v1.1 | D18 §0 y D1–D5 | Baseline v1.0 permanece salvo adiciones/refinamientos explícitos: admisión Strategy, integración por rol, interfaz visual, handoff/typed dependencies y OD-01 fuera de alcance. P1–P7 no se reabren. |

Los cierres conceptuales y los estados de implementación, audit y evidence siguen separados. D1–D4 añaden contratos que pueden implementarse; no demuestran utilidad de candidatos, integración de JEV, cumplimiento de Paperclip ni funcionamiento de la interfaz. D5 confirma la separación económica ya existente y cambia la clasificación de OD-01.

# 3. Obsolete / replaced definitions

Se conservan **20 sustituciones históricas** y se añade **1 reclasificación de alcance v1.1**: SUP-21 para OD-01. Total del registro SUP: **21**. No se suman cinco SUP por el mero hecho de recibir D1–D5. La aclaración del origen de Hypothesis se registra como CCR-21, sin contar otra sustitución de una identidad frozen.

| ID | Clasificación | Supersedes | Canonical / fundamento |
|---|---|---|---|
| SUP-01 | RESOLVED_BY_PRECEDENCE | DCA como referencia informal del benchmark, antecedente v1.0 descrito en D08 p.2. | D08 pp.2,5 y D04 P2.1: Benchmark B es 1-0-1/3-1-3; baseline operativo es otro concepto. No se afirma haber leído el v1.0 no adjunto. |
| SUP-02 | RESOLVED_BY_PRECEDENCE | Interpretación informal de «tres meses y uno de delivery» para 3-1-3, recogida en D08 pp.2,4. | D16 §3 y D08 p.5: `[Q−4 meses,Q−1 mes)`; trimestre de referencia separado. No fija por sí solo calendario de ejecución. |
| SUP-03 | RESOLVED_BY_PRECEDENCE | Inventario incompleto con nueve grupos Gas y extraordinarios mezclados en base, D08 p.10/D15 p.2. | D13 §§4–7 y D06 Step 3 p.4: taxonomía 9 Power + 10 Gas + 4 Extraordinary y fronteras congeladas. |
| SUP-04 | RESOLVED_BY_PRECEDENCE | S1 incluye trayectoria reciente, D11 p.3. | D10 pp.2–4: S1 es estático Relative Price Location; trayectoria pertenece a S3. |
| SUP-05 | RESOLVED_BY_PRECEDENCE | S2 Anomalous Move + Normalization y su lógica de normalización, D11 p.5. | D10 pp.2,5–6: Anomaly Detection, dirección/magnitud/severidad; no presume reversión ni decide trend. |
| SUP-06 | RESOLVED_BY_PRECEDENCE | S3 Sustained Appreciation / Buy Earlier, D11 p.7. | D10 pp.2,7–8: Trajectory / Repricing; dirección, magnitud, ritmo y persistencia; evidencia de coste de WAIT, no mandato automático de perseguir subidas. |
| SUP-07 | RESOLVED_BY_PRECEDENCE | S4 Breakout / Rejection / Range Transition como familia provisional con reglas de acción, D11 p.9. | D10 pp.2,9–10: Structure / Range Transition; aceptación/rechazo/transición causal, evidence/gate por defecto; autoridad global según D01 P7.1. |
| SUP-08 | RESOLVED_BY_PRECEDENCE | S5 Favorable Pullback Within Buy-Justified Structure, D11 p.11. | D10 pp.2,11–12: Conditional Pullback Timing, consume premisa de compra válida; no necesita inventar una opinión propia ni autoridad de ejecución. |
| SUP-09 | TERMINOLOGY_ONLY | Llamar S1–S5 «Candidate Hypotheses» o «collection of hypotheses», D11 p.1/D09 p.2. | D03 pp.1,3,12 y D01 pp.1,3: son Strategies; P5.1 es una Hypothesis derivada de S1. |
| SUP-10 | RESOLVED_BY_PRECEDENCE | Propuesta inicial Power y posterior Gas, D08 p.15. | D03 P5.3 p.5: primer experimento únicamente Gas Quarterly; insuficiencia da HOLD, sin cambio de población. |
| SUP-11 | RESOLVED_BY_PRECEDENCE | Secuencia general propuesta de baseline/precio/Z/fundamentales/eventos, D08 p.15 y D05 p.7. | D03 P5.5/P5.9 pp.7,11: sólo A0 frente a A1=A0+S1; no rescate ni orden global futuro congelado. |
| SUP-12 | RESOLVED_BY_PRECEDENCE | Secuencia lineal «modelos → backtester → implementación → resultados», D07 paso 8. | D06 Step 8 pp.7–8 y D01 P7.2: Candidate Policy y Learning Loop obligatorio, offline/versionado y con revalidación. |
| SUP-13 | RESOLVED_BY_PRECEDENCE | Dirección inicial de local policies por Strategy y posterior meta-policy, D10 p.13/D09 pp.4–5. | D01 P7.1 p.3: primero una global Candidate Policy y Strategies como evidence generators; locales/meta requieren nueva versión justificada. |
| SUP-14 | RESOLVED_BY_PRECEDENCE | Bellman/Value sólo como posible arquitectura, D10 p.15/D09 pp.4,6. | D01 P7.6 pp.8–9: Value Layer explícita, V/Q y Bellman como formalización; Q-learning sigue primera familia RL candidata, no algoritmo productivo obligatorio. |
| SUP-15 | RESOLVED_BY_PRECEDENCE | Low-entropy/deterministic deployment como destino de la ruta de etapas, D10 p.16. | D09 §5.4 p.4 y D01 P7.4 p.6: stochastic policy calibrada puede permanecer; reducción de entropía depende del gate completo. D10 ya ofrecía low-entropy **o** deterministic, no exigía 100% determinismo; lo refinado es la ruta sugerida de etapas. |
| SUP-16 | RESOLVED_BY_PRECEDENCE | Prohibición general de self-promotion sin distinguir promoción de versión y autoridad, D10 p.16. | D01 P7.6/P7.8 pp.9,11: en nivel autorizado posterior puede automatizarse promoción de Policy Version; nunca autoampliar autonomía/envelope ni otros cambios prohibidos. |
| SUP-17 | RESOLVED_BY_PRECEDENCE | Frase «WAIT changes remaining volume» en D09 p.4 y explicación de Bellman D01 p.8. | D03 P5.4 p.6/D02 P6.3–P6.5 pp.5–7: WAIT conserva volumen. D01 p.1 reserva autoridad a P1–P6; la frase explicativa no cambia la transición operativa. |
| SUP-18 | RESOLVED_BY_PRECEDENCE | Campos publication/observed/known agrupados en el framing anterior, D08 p.11/D12 p.16. | D04 P4.2 p.8: referencia/evento, publicación, policy-consumable y revisión separados; publicado no implica consumible; timestamps máquina UTC. |
| SUP-19 | RESOLVED_BY_PRECEDENCE | Gate general SUFFICIENT / PARTIAL / INSUFFICIENT como salida de suficiencia, D12 p.16/D06 p.6. | D04 P4.4 p.9: disponibilidad por requisito y data-readiness por candidato en dos ejes. Las etiquetas antiguas no se mapean ciegamente uno a uno. |
| SUP-20 | TERMINOLOGY_ONLY | Nombre de trabajo Market Dynamics, Energy, Conviction and Sentiment Layer, D14 p.3. | D13 pp.2–3/D12 p.2: nombre adoptado Market Dynamics & Sentiment State. No importa por ello el resto de la arquitectura Alexandria. |
| SUP-21 | RESOLVED_BY_PRECEDENCE | SPEC v1.0 §23 y referencias asociadas clasificaban OD-01 — agregación económica entre productos/misiones — como OPEN DECISION. | D18 D5.1–D5.4: evaluación separada actual; OD-01 histórico pasa a OUT OF CURRENT SCOPE / FUTURE REQUIREMENT ONLY. No se infiere objetivo conjunto ni se pone un aggregator en el critical path. |

# 4. Canonical Conflict Review

**TRUE_OPEN_CONFLICT: 0.** Se preservan los conflictos/discrepancias resueltos en v1.0, incluida la frase sobre WAIT y volumen (SUP-17). D5 actualiza CCR-19 mediante precedencia explícita y SUP-21; el nuevo CCR-21 registra la aclaración de la frase introductoria de §8. D1–D4 no crean conflicto con los contratos P1–P7. Refinar dependencias consumidas/producidas no equivale a cambiar gates económicos.

Los 21 registros CCR no se suman a SUP: algunos identifican un pendiente histórico cerrado, un límite factual o una aclaración, y los que remiten a SUP no duplican su conteo.

| ID | Clasificación | Hallazgo | Resolución y Source / Authority |
|---|---|---|---|
| CCR-01 | OBSOLETE_DEFINITION | Master/Open Points tratan Procurement Contract y cantidad como conceptual abierto. | D04 P1 p.3 cierra volumen total conocido y dueño del sizing; datos de mandato/lotes se auditan. P5.2 cierra controlador experimental. |
| CCR-02 | OBSOLETE_DEFINITION | «H aún no definido» en D08 p.7/D05 p.4. | D04 P2.2 cierra significado all-in por obligación; fórmula operativa/ledger se completan con ejecución real, no se reabre H. |
| CCR-03 | OBSOLETE_DEFINITION | Sortino/C/mejora mínima/evidencia Monthly y Quarterly figuran pendientes en D05 p.5/D12 p.15. | D04 P2.3/P3 pp.4,6–7 cierra >1 Quarterly, C diagnóstico, mean(V)>0, 8 quarters/2 años y 24 meses; no usar el estado antiguo. |
| CCR-04 | OBSOLETE_DEFINITION | P5 aparece abierto en D05 p.7; propuesta de varios baselines en D12 p.18. | D03 P5.1–P5.9 cierra hipótesis, un baseline calendar, población, scope, paridad, OOS/refutación y única ablation inicial. |
| CCR-05 | OBSOLETE_DEFINITION | P6 aparece abierto en D05 p.8. | D02 P6.1–P6.10 cierra contrato completo. Esto no afirma implementación ni closure gate técnico aprobado. |
| CCR-06 | OBSOLETE_DEFINITION | P7 arquitectura/autoridad/exploración aparecen pendientes en D05 p.9. | D01 P7.1–P7.8 cierra arquitectura; algoritmos/umbrales/evidencia permanecen pendientes bajo §24. |
| CCR-07 | OBSOLETE_DEFINITION | Diez preguntas todavía no recibidas en D08 pp.9,18. | D15 pp.1,10 registra Q01–Q13; D12 y D06 consolidan resolución. No quedan diez preguntas documentales desaparecidas. |
| CCR-08 | INSUFFICIENT_EVIDENCE — cantidad aclarada por owner; campaña incompleta | Antecedentes D08 p.4/D15 p.2: 10 MW Monthly Power/Gas, «10 Energy» Power Quarterly, 60 MW Gas Quarterly. U-BRU 2026-09-22 confirma 10/10/60/20 MW (§4.1). | Cantidades actuales disponibles por confirmación de Bru; Power Quarterly actual = 20 MW, con «10 Energy» preservado como antecedente contradictorio. No es conversión ni prueba de vigencia histórica. DEP-01/02 permanecen pendientes para vínculo a campaña/delivery/ownership. U-AUDIT §§1,4,8. |
| CCR-09 | TERMINOLOGY_ONLY | Nombres cortos/títulos ampliados y abreviaturas posteriores, D10 pp.2,5,7,9/D09 pp.3–4; E5 en D13 pp.5,10. | Mappings: «Anomaly Detection and Shock Sizing» → Anomaly Detection; «Trajectory, Persistence and Repricing» → Trajectory / Repricing; «Structure, Range Interaction and Transition» y «Structure Transition» → Structure / Range Transition; «Conditional Timing» → Conditional Pullback Timing. E5 «Combustibles y mercados de generación relacionados» → Combustibles y mercados relacionados. Son aliases descriptivos, no conceptos adicionales. |
| CCR-10 | TERMINOLOGY_ONLY | Collision A0/A1, S1–S5, q_t y V. | Mantener namespaces §3.3; no fusionar ablation/autonomy, strategies/workstreams ni cantidades/Sentiment. |
| CCR-11 | RESOLVED_BY_PRECEDENCE | Drivers v0.1 declara completeness review pendiente y Revision declara concepto cerrado. | D06 Step 3 p.4: taxonomía cerrada; revisión adversarial/poda es evidencia futura. No reabrir por leer primero D13 p.9. |
| CCR-12 | TERMINOLOGY_ONLY | Las «escaleras» de familias de D14 §13/D08 p.12 podrían interpretarse como madurez obligatoria. | D01 P7.6.A p.8: paradigmas son herramientas de Representation Learning por subproblema. No existe requisito de pasar de supervised a unsupervised para llegar a RL. |
| CCR-13 | INSUFFICIENT_EVIDENCE — cobertura parcial reportada | Rango histórico comunicado 2020–2026; U-AUDIT 2026-09-22 ubica EEX fuera de app/reference: trades THE/DE desde 2020-11-02 y top-of-book desde 2025-07-25, ambos hasta 2026-07-28 en las raíces examinadas. | Extremos de particiones, no historia uniforme ni campañas elegibles certificadas. Conservar scope y límites PIT/derechos; no repetir ausencia global ni «siete años completos». §6.5; U-AUDIT §§1,7,8. |
| CCR-14 | INSUFFICIENT_EVIDENCE | Cuota agotada, endpoint 403 y referencias a código externo. | Estados históricos D06/D16, no audit actual. Se conserva dependencia benchmark/capacidad; no se afirma bloqueo de acceso actual ni implementación inspeccionada. |
| CCR-15 | INSUFFICIENT_EVIDENCE | Guard 0.01 reportado frente a valor potencialmente legítimo según procedimiento citado, D16 §5. | Registrar como anomalía de implementación a auditar, DEP-09; no validar el guard ni afirmar que fue corregido. |
| CCR-16 | TERMINOLOGY_ONLY | «Completed quarters» frente a n=n+ + n− en handout; exact-zero neutral en P3.4. | Reportar n_total y n_neutral; conservar n del handout para scoring. El mínimo de evidencia cuenta campañas completas. No introducir epsilon ni cambiar denominador. |
| CCR-17 | TERMINOLOGY_ONLY | Lista de run statuses podría tomarse como enum exclusivo con orden de severidad. | D02 P6.10 exige validity, availability, coverage y source status separados. Conservar todas las causas; ninguna prioridad escalar está canonizada. |
| CCR-18 | TERMINOLOGY_ONLY | S5 emite BUY NOW/WAIT, aunque P7 da autoridad global. | D10 p.11: action preference local; D01 P7.1: Candidate Policy tiene autoridad. S5 no envía compras directamente. |
| CCR-19 | RESOLVED_BY_PRECEDENCE | Reward global podía confundirse con agregado económico y v1.0 mantenía OD-01 como OPEN DECISION. | D18 D5 confirma evaluación separada por producto/Mission y reclasifica OD-01 fuera del alcance actual; SUP-21 registra el único reemplazo contado. D09 pp.2,6 sigue definiendo semántica compartida, no portfolio score. |
| CCR-20 | TERMINOLOGY_ONLY | Research PASS, closure P6 y promoción productiva se describen como «pasar». | Son gates distintos (§§5,14,16–18). Ninguno reemplaza los demás. |
| CCR-21 | TERMINOLOGY_ONLY | La introducción de §8 v1.0 decía «Una Hypothesis se deriva de una Strategy», mientras §3.1 ya decía «puede derivarse». | D18 D1.1–D1.3 hace explícitos los tres canales: §8 pasa a «puede derivarse» y remite a §8.7. Es aclaración/ampliación del recorrido, sin alterar S1–S5 ni P5.1; no se cuenta como una segunda sustitución de una identidad frozen. |

# 5. True open decisions

**Current open conceptual decisions: 0.** D1–D5 están FROZEN y P1–P7 no se reabren. Selección de parámetros, roles de herramientas, datos reales, validación de candidatos, diseño UI y materialización Paperclip se resuelven como implementación, audit o evidence bajo sus contratos; no son nuevas incertidumbres conceptuales del mandato actual.

## 5.1 OD-01 histórico: fuera del alcance actual

| ID histórico | Estado vigente | Decisión actual | Efecto sobre implementación | Condición de futura apertura / Source |
|---|---|---|---|---|
| OD-01 | OUT OF CURRENT SCOPE / FUTURE REQUIREMENT ONLY | Evaluar separadamente Power Monthly, Power Quarterly, Gas Monthly y Gas Quarterly, cuando apliquen. No score combinado, pesos conjuntos, portfolio objective ni pooling de muestras. | No bloquea ningún IMP del mandato actual; no existe tarea de portfolio aggregation en el critical path. | Sólo requerimiento explícito posterior del cliente o evidencia auditada de mandato que exija optimización conjunta, seguido de nueva definición versionada y governance. D18 D5.1–D5.4; SUP-21/CCR-19. |

Una futura exigencia conjunta deberá definir antes de usarse: propósito, productos/Missions incluidos, obligaciones/exposures, relación y solapamiento entre obligaciones, unidades, normalización, pesos, comparabilidad de benchmark, coverage ownership, reglas de muestra/evidencia, interpretación económica y governance. Esta lista condiciona una futura versión; no define ahora sus valores ni crea trabajo elegible. El Global Procurement Reward sigue compartiendo semántica, sin agregación multi-producto implícita (§10).

La eventual investigación de cobertura incompleta en stress no autoriza hoy un reward alternativo; está fuera del experimento normal y necesitaría un protocolo separado si se activa. La eventual adición de cantidad al action space, local policies, meta-policy o un nuevo driver requiere evidencia y nueva versión; no es una decisión pendiente que impida implementar la arquitectura congelada. Q08 permanece aparcada, no se convierte en un requisito conceptual abierto del núcleo.

**Patch authority:** D18 D5. No quedan decisiones conceptuales actuales abiertas por el mero hecho de que la arquitectura permita requisitos futuros.

# 6. Audit / evidence pending

**29 dependencias**: DEP-01–DEP-26 se conservan con su contenido, y D1/D2/D4 incorporan DEP-27–DEP-29. D5 no cierra ni elimina auditorías de unidades, relación de obligaciones, coverage ownership o comparabilidad. Los scopes condicionales por rol/candidato no son requisitos del primer experimento ni obligaciones de integrar herramientas.

| ID / tipo | Qué falta | Por qué importa / qué bloquea | Evidencia o responsable que lo resuelve |
|---|---|---|---|
| DEP-01 — AUDIT-DEPENDENT | Cantidades actuales en MW confirmadas (§4.1): Gas Monthly 10, Power Monthly 10, Gas Quarterly 60, Power Quarterly 20. Falta vincularlas a producto/hub/contrato, vigencia, campaña, periodo/horas/perfil y liquidación física/financiera. | Cantidades ejecutables, comparabilidad B/H y EUR; no inferir producto por residencia del cliente. | U-BRU y U-AUDIT para cantidades; fuentes reales de procurement para los campos restantes. No repetir la solicitud de cantidades ni cerrar DEP-01 por esa confirmación. D04 P1/P4.1; D08 p.4. |
| DEP-02 — AUDIT-DEPENDENT | Relación Monthly/Quarterly y ownership de cobertura: adicional, solapada o alternativa según mandato. | Evitar doble conteo y agregaciones ficticias. | Fichas de obligaciones/entrega y asignación de fills auditadas. D08 p.4; D12 Q01/Q03; D02 P6.5/P6.8. |
| DEP-03 — AUDIT-DEPENDENT | Fechas de campaña, ventanas operativas, trading calendar, pausa, deadline y decision boundaries concretos. | Instanciar oportunidades P5.2/P5.4; ventana benchmark no basta; las 11:00 no son default. | Mandato/calendario/fuente operativa, zona/DST documentados. D03 P5.2–P5.4; D02 P6.2. |
| DEP-04 — AUDIT-DEPENDENT | Terminal coverage rule y amendments/cancellations reales, si existen. | Cierre válido de residual; sin regla, COVERAGE_INCOMPLETE, sin fill inventado. | Contrato de procurement y operaciones versionado. D02 P6.5. |
| DEP-05 — AUDIT-DEPENDENT | Latencia, spread/slippage, fees, fills/partials/no-fill, lotes/redondeo y restricciones operativas reales. | P5.6/H; resultado económico HOLD hasta audit. | Ejecución/market data/mandato, reconciliación y sensibilidad predeclarada; mismos parámetros contractuales A0/A1. D03 P5.6; D02 P6.4. |
| DEP-06 — AUDIT-DEPENDENT | Lago EEX reportado en /srv/hot-data/EEX (§6.5). Falta inventario suficiente por instrumento/campaña: cobertura, resolución, unidades, missingness, revisiones, vínculo al mandato y permisos. | Data-readiness y campañas elegibles; no suponer historia por declaración general. | U-AUDIT §§1,3,7,8; IMP-03 incorpora/reconcilia scope EEX preservando el audit histórico app/reference; Data Sufficiency Matrix por requisito. Existencia no equivale a DATA_READY. D04 P4.1/P4.4. |
| DEP-07 — AUDIT-DEPENDENT | Metadata evento/retrieval/hashes reportada; publicación y consumo histórico no demostrados por retrieval posterior. Vintages de forecasts/fundamentales/eventos se auditan sólo para inputs utilizados por el consumidor. | Replay causal; campos sin prueba histórica quedan unavailable/proxy válido/forward-only. | U-AUDIT §7 para metadata y límites; fuente contemporánea y manifests para acreditar cada uso. No inferir causalidad ni inutilidad universal. D04 P4.2–P4.4; D13 §§3,7. |
| DEP-08 — AUDIT-DEPENDENT | Metodología D16/§5 disponible; proxy de un día e implementación sintética reportados. Falta benchmark de campaña reproducido/reconciliado con fuente oficial o autorizada y cobertura por fecha. | B final y admisión económica; reproducibilidad proxy no prueba equivalencia. | U-AUDIT §§6,7; fuente/reconciliación de benchmark e inspección independiente del engine aplicable. No solicitar otra vez la metodología ni tratar un proxy como oficial. D04 P2.1; D16 §§3–5; D02 P6.6. |
| DEP-09 — AUDIT-DEPENDENT | Comprobar guard de oficiales 0.01 y procedimiento/feed aplicable; acceso/entitlement real. | Posible exclusión errónea en régimen extremo y validez de reference rows. | Código/config autorizados y muestra fuente; fixture específico; no dar por corregido. D16 §5; D08 pp.6,14. |
| DEP-10 — AUDIT-DEPENDENT | Tooling de lectura y benchmark sintético reportados; capacidades completas, interfaces y derechos del entorno/fuentes siguen por auditar. Program.fs y HighResolutionProcurementModel.fs no localizados en el alcance, no declarados inexistentes. | Elegir menor herramienta suficiente y permitida; no construir plataforma por preferencia. | U-AUDIT §§3,6,7; capability audit del componente pertinente y comprobación de uso autorizado. Datos legibles no prueban derechos. D04 P4.5; D08 pp.3,11. |
| DEP-11 — EVIDENCE-DEPENDENT | Primera representación matemática S1, causal references, sampling/lookbacks y espacio de calibración. | A1 concreto; semántica static location ya congelada. | Research en development cronológico, estabilidad de parámetros, configuración frozen antes de OOS. D10 pp.3–4,14; D03 P5.5/P5.8. |
| DEP-12 — AUDIT-DEPENDENT | Campañas OOS disponibles por producto/misión activa y solapamientos: P5 reserva últimas 8 Gas Quarterly completas en ≥2 años; futuras evaluaciones Quarterly respetan ≥8/≥2 años y Monthly ≥24 meses, separadas. | Reservar población antes de calibración y cumplir mínimo de cada misión; insuficiencia → HOLD. | Historial auditado, ventanas de información y manifest de reserva/split/purge/embargo sin duración inventada. D03 P5.3/P5.8; D04 P3.3/P3.5. |
| DEP-13 — EVIDENCE-DEPENDENT | Resultado A0/A1 válido: Delta V, valor absoluto y gates de P3. | Supervivencia S1 y research PASS; ningún resultado adjunto lo prueba. | Run bundles P5/P6 sobre OOS sellado, accounting válido y execution auditado. D03 P5.7/P5.9. |
| DEP-14 — EVIDENCE-DEPENDENT | Estabilidad y no dependencia material de una campaña excepcional; robustez a regímenes/ejecución. | G_stability y lectura científica; no fijar umbral por conveniencia posterior. | Revisión/criterios de materialidad predeclarados y evidencia OOS; análisis de peores campañas/concentración. D04 P3.3; D01 P7.6.H; D08 p.16. |
| DEP-15 — EVIDENCE-DEPENDENT | Instanciación S2–S5: horizontes/normalizadores, persistencia, structure/range causal, premisa S5, invalidación/wait budget. | Experimentos posteriores; no cambia identidades ni entra en P5. | Research con baselines simples y ablations predeclaradas. D10 pp.5–12,17. |
| DEP-16 — EVIDENCE-DEPENDENT | Representaciones de Z y drivers, completitud adversarial basada en evidencia, redundancia y valor incremental. | Admisión/poda de capas; no impone usar los 23 bloques. | Audit observables + ablations; nueva taxonomía sólo por evidencia/contradicción material. D06 Steps 3–4; D13 pp.9–11. |
| DEP-17 — AUDIT-/EVIDENCE-DEPENDENT | Q07: resolución intradía, definición operativa de hora, ventanas candidatas, métricas/buckets y mínimo de observaciones. | Comparación fixed-time/dynamic window y entry-hour profile. | Audit intradía y experimento separado con igual lógica/obligación/ejecución. D12 Q07 p.11; D03 P5.4. |
| DEP-18 — EVIDENCE-DEPENDENT | Forma, parámetros y validación de Sizing Policy final. | Sizing aprendido y límites de cantidad aprobables. | Mandato auditado + experimentos de timing y sizing distinguibles. D04 P1.2; D01 P7.7. |
| DEP-19 — EVIDENCE-DEPENDENT | Parametrización numérica final de reward: g/normalización, posible dense feedback/shaping y asignación temporal. | Training reward utilizable; no crear reward local ni doble coste. | Distribuciones B/H/V válidas y prueba de alineación con objetivo global, frozen antes del test. D09 §§2–3,9–10. |
| DEP-20 — EVIDENCE-DEPENDENT | Suficiencia Markov/support de acciones, modelo de Value/Policy Learning, gamma, tau y entropía. | Selección RL/value learner; Q-learning es primer candidato. | Comparación contra soluciones simples, muestras/campañas efectivas y prueba de secuencialidad. D01 P7.6/P7 p.12; D10 p.15. |
| DEP-21 — EVIDENCE-DEPENDENT | Regla de weighting/sampling entre Replay/Shadow/Real y cadence de review/training. | Learning confiable entre fuentes de fuerza probatoria distinta. | Protocolo offline predeclarado/versionado con provenance conservada. D01 P7.2/P7.5, p.12. |
| DEP-22 — EVIDENCE-DEPENDENT | Evidencia Shadow prospectiva y después Real suficiente, consistencia con OOS y comportamiento ante intervención. | G_forward y reducción futura de supervisión. | Campañas prospectivas, logs non-interference, recomendaciones y fills reales separados. D01 P7.3/P7.5/P7.6.H. |
| DEP-23 — AUDIT-/EVIDENCE-DEPENDENT | Límites y triggers numéricos data/OOD/drift/deterioro económico; sizing y deadlines del envelope. | Autonomía segura; no fijar defaults optimizables por policy. | Mandatos/governance y distribuciones empíricas; controlador externo. D01 P7.7, p.12. |
| DEP-24 — EVIDENCE-DEPENDENT | Normalización E/P/D/S/F y umbrales de ascenso A1→A4; parámetros del futuro Autonomy Evidence Score. | Promoción de autonomía; no sube por tiempo o un único ratio. | OOS/Shadow/Real y decisión de governance versionada. D01 P7.6.H–J. |
| DEP-25 — AUDIT-DEPENDENT | Autoridad operativa concreta, primera aprobación humana, responsables, baseline/fallback autorizado y rollback viable. | Cualquier activación real; A0 calendar experimental no está autorizado automáticamente como fallback. | Responsable de operaciones/governance y autorización explícita; targets válidos bajo envelope vigente. D01 P7.3/P7.7/P7.8. |
| DEP-26 — AUDIT-DEPENDENT, sólo comercial | Ahorro comercial material y eventual umbral cliente C/otras exigencias reales, si se requieren. | Aceptación comercial; no modifica el research gate mean(V)>0 ni C diagnóstico. | Economía/mandato del cliente, fijación ex-ante separada. D04 P3.1/P3.2. |
| DEP-27 — AUDIT-DEPENDENT | Interfaces, permisos, estado y workflow reales del Paperclip existente: Project ON/OFF, routing, Queue/READY, dispatch, recovery, reviews y receipts. | Binding del handoff D4 sin rediseñar la oficina ni inventar configuración/estado; no bloquea su propio audit ni el contrato documental. | IMP-25: capability/compatibility audit factual y mapping de brechas contra §20.2; IMP-26 consume el alcance auditado para la extensión mínima y prueba su funcionamiento. D18 D4.1/D4.3–D4.14. |
| DEP-28 — AUDIT-/EVIDENCE-DEPENDENT, por componente/rol y sólo evaluación encargada | Capacidades reales, inputs/outputs, boundary/authority y resultado comparativo del rol externo propuesto; coste/latencia/carga cuando apliquen. JEV carece de rol preasignado. | Admisión específica ADMIT/HOLD/REJECT, no obligación de integrar ni prerequisite de P5. | IMP-28 y §11.6: role-discovery, hypothesis/comparator previos, evaluación no autoritativa, evidencia reproducible y removal/rollback. Cada rol conserva su resultado independiente; si ninguno aporta valor, componente fuera. D18 D2.1–D2.7. |
| DEP-29 — EVIDENCE-DEPENDENT, por futura Strategy Candidate | Validez/refutación, generalización, redundancia y valor económico/decisional de cada nueva Strategy con el Admission Contract completo. | Admisión de ese Evidence Generator; ningún candidato futuro se presume y una Strategy aportada por Bru no omite validación. | IMP-27 materializa el proceso; cada validación encargada dentro de ese alcance produce evidencia versionada bajo §8.7, §§5–6/13–15/19 según aplique. Datos críticos remiten a DEP-06/07/12 por scope. D18 D1.1–D1.6. |

## 6.1 Destino de los antiguos pendientes de research

| Fuente histórica | Destino vigente |
|---|---|
| D12 OPEN-01/03/06: sizing, Procurement State, contrato Quarterly | Conceptos P1/P5/P6 cerrados; DEP-01–05/18 para datos y policy final. |
| D12 OPEN-02/04/05: calendar baselines, catalogue y primera ablation | P5.2, D10 y P5.9 cerrados. Futuras combinaciones dependen de evidencia; no inventar ladder obligatorio. |
| D12 OPEN-07: entry-hour performance profile | DEP-17, experimento Q07 posterior. |
| D12 OPEN-08/09: sidecar/fallback | Q08 aparcado; DEP-25 si se requiere uso operativo. |
| D12 OPEN-10: completeness drivers | D06 Step 3 cierra taxonomía; DEP-16 para revisión basada en evidencia. |
| D12 OPEN-11/12: aceptación y scoring Monthly | D04 P3 cerrado; DEP-12–14 para evidencia y DEP-26 comercial. |
| D12 OPEN-13/14/15: datos, simulación, benchmark/H | DEP-01/05–10/14/20; herramienta se elige por incertidumbre y capacidad real. |
| D10 OPEN-S1-01…OPEN-S5-01 | DEP-11/15, parámetros y definiciones matemáticas dentro de identidades frozen. |
| D10 OPEN-ARCH-01/02 y OPEN-RL-01…03 | P7 cierra arquitectura inicial global; DEP-19–21 para variantes probadas y selección empírica. |
| D10 OPEN-EVAL-01; D09 §9 | DEP-04/05/08/19 para reward numérico; Monthly/action inicial ya cerrados; D18 D5 reclasifica OD-01 fuera del alcance actual (§23). |

D1–D5 no cierran por declaración ninguna dependencia empírica heredada. Los estados y cierres se registran por scope y receipt conforme a §25.2; un audit completo que descubre falta de datos no equivale a suficiencia, y una implementación de admisión no demuestra el valor de ningún candidato.

# 7. Items intentionally excluded

| Elemento excluido del contrato implementable actual | Motivo y destino |
|---|---|
| Fórmulas de scores, enums de cinco modos, rangos 0…1/−1…1, niveles Flight y endpoints concretos de Conviction de Alexandria | D14 los presenta como candidatos propios. Procurement adopta la semántica Z, no esos parámetros. No se usan para llenar un vacío. |
| Trading actions SELL/CLOSE/partial/BE/trailing, account-wide risk, Algo Strategy/Trading Ranges/LIT, Account Rule Profiles, Admission y G6 de Alexandria | Arquitectura y autoridad de otro proyecto, sin incorporación explícita a procurement. |
| Workstreams Alexandria D-R2/S1–S7, pilotos 2.5K/100K y UI/gauges | No son las Strategies S1–S5 de este proyecto ni parte del primer experimento. Los identificadores coincidentes se desambiguaron. |
| B0…B5 de Alexandria y orden global fijo para añadir Z/drivers/Strategies | Propuestas anteriores; P5.9 sólo congela A0 frente a A1=S1 añadido. Otras pruebas requieren protocolo nuevo. |
| Implementación, notebooks/model training, backtests o recomendaciones de compra durante esta entrega | D00 y D18 §3 exigen documentación antes de implementación; este patch entrega tres Markdown y prohíbe implementar código. Sólo se efectuó procesamiento documental, no programación del sistema investigado. |
| Elección definitiva de RL, vanilla Q-learning, gamma/tau, entropy schedule, pesos/normalización de reward o parámetros S1–S5 | El corpus no aporta selección empírica ni números aprobados. Se conservan como candidatos/dependencias §24 de la SPEC. |
| Conversiones asumidas de «10 Energy» a MW, MW a MWh o V a euros; hub inferido por residencia; suma Monthly+Quarterly | Valores y relaciones no se inventan. Las cifras históricas permanecen en provenance y las fichas reales se auditan. |
| C>2.25–3.00 como hard research gate, Sortino Quarterly como gate Monthly o PASS por ratio infinito | No son el contrato vigente P3. La referencia comercial y las fórmulas válidas sí se conservan. |
| Obligación de usar las 23 categorías como 23 features o todas las Strategies a la vez | Taxonomía/identidades congeladas no equivalen a utilidad probada ni a admisión de inputs. |
| Escenario de incomplete coverage con reward alternativo como funcionamiento normal | Completion es hard constraint; P6 declara coverage incompleta sin regla válida. Un stress específico exigiría su propio protocolo si se activa. |
| Activación de Q08 por proximidad del cierre de septiembre; envío de señales o mensajes externos | Q08 permanece aparcado; el corpus no concede shortcut de validación ni mandato de envío. |
| Vigencia actual de endpoints, cuota/403, código Program.fs/HighResolutionProcurementModel.fs/EexIo o regla externa EEX como hecho auditado hoy | D16 y revisiones describen estados históricos. No se accedió a esos sistemas ni se hizo verificación externa en la consolidación. |
| Afirmaciones de edge, PASS ya obtenido, campañas OOS suficientes, Shadow exitoso o autonomía concedida | No hay resultados ni receipts empíricos adjuntos que sostengan esas conclusiones. |
| Decisiones de precedentes no adjuntos como si se hubieran leído | Plan Maestro v1.0, DECISION_IMPLEMENTATION_PLAN_V1, repositorios y conversaciones citadas sólo se conocen por los documentos recibidos; no entran en el conteo de lectura. |
| S6 o un rol preasignado a JEV; integración por disponibilidad; admisión o edge ya demostrado | D18 D2 exige discovery/evaluación por rol y permite dejar el componente fuera si no aporta valor. |
| Candidatos nuevos admitidos por origen Bru, discovery o un PASS aislado | D18 D1 conserva tres canales y validación común; no se evaluó ni admitió un candidato real en este patch. |
| Rediseño de Paperclip, nuevo routing/READY threshold, segunda planificación o autorización de compra por handoff | D18 D4 preserva la oficina existente y limita Astra a ejecución del IMP graph; su estado real requiere DEP-27. |
| Frontend framework, charting library, layout, estilo, dashboard final o device strategy elegidos en este patch | D18 D3 congela Human Visual Observability y authority boundary; diseño/UI completos posteriores, sin borrar el requisito chart. |
| Portfolio aggregation actual, pesos conjuntos, pooled evidence o portfolio objective implícito | D18 D5 reclasifica OD-01 fuera del alcance actual; futura optimización requiere mandato/evidencia y nueva definición versionada. |

# 8. Confidence / limitations of the consolidation

La confianza es documental: D18 se leyó completo, los contratos nuevos se contrastaron por ámbito, se revisó adversarialmente el conjunto y se verificó el diff con las baselines. La comparación literal confirma que las definiciones S1–S5 de §§8.1–8.6 y los bloques económicos/experimentales preservados no cambiaron. P1–P7 **no se reabrieron**.

En la consolidación histórica v1.1 no se inspeccionaron BruNode, código externo, feeds, costes reales, datasets de campañas, permisos efectivos, JEV ni Paperclip. Esta revisión incorpora U-AUDIT, que reporta sus propias inspecciones acotadas; no las reejecuta ni certifica campos que siguen pendientes. La nota factual de LAT-91 es una publicación documental, no una auditoría completa de la Oficina. No se implementó frontend, se ejecutó una evaluación de mercado ni se emitió una admisión de Strategy o rol externo.

Persisten los límites de v1.0: algunos PDF densos exigieron contraste visual; D16 tiene LaTeX irregular normalizado sin cambiar su método; D16/D17 no declaran versión/fecha propia; las referencias externas y estados históricos de cuota/endpoints no son verificaciones actuales. El patch no introduce investigación web nueva ni completa parámetros económicos por inferencia.

La revisión de dependencias comprueba tanto ausencia de circularidad como ausencia de cierres falsos: un audit puede estar realizado y seguir documentando datos insuficientes; fixtures no cierran evidencia económica; cerrar ST no cierra IMP; los gates del acto productivo se comprueban antes de dicho acto. La materialización de un framework no admite un candidato ni declara verificadas capacidades externas. La reserva OOS y las distinciones iniciales de A1 continúan intactas.

## 8.1 Readiness y alcance del handoff v1.1

| Área | Cambio de estado documental | Estado que no se acredita |
|---|---|---|
| D1 Strategy / Capability Extension | Contrato CANONICAL / FROZEN; IMP-27 para materialización; DEP-29 por candidato futuro | Strategy nueva admitida, edge o execution authority |
| D2 External Model / Tool Integration | Contrato CANONICAL / FROZEN; IMP-28 y DEP-28 por rol encargado | Rol de JEV decidido, ADMIT emitido o integración obligatoria |
| D3 Operator Interface | Human Visual Observability y boundary CANONICAL / FROZEN; IMP-29 | UI completa construida, tecnología elegida o segunda verdad económica |
| D4 Astra / Paperclip | Handoff y typed dependency semantics CANONICAL / FROZEN; IMP-25/26 y DEP-27 | Binding auditado/implementado, Queue real READY o authority productiva |
| D5 OD-01 | OPEN DECISION v1.0 → OUT OF CURRENT SCOPE / FUTURE REQUIREMENT ONLY; cero decisiones conceptuales actuales abiertas | Portfolio objective definido o aggregate necesario para avanzar |

La matriz canónica de readiness contiene **31 componentes/filas**. Añade cuatro filas D1–D4 y reclasifica la fila de agregación; las demás mantienen su estado. No se aumenta una madurez empírica por cambiar documentación. El backlog contiene 29 IMPs, con una sola matriz de REQUIRES* y RESOLVES/PRODUCES; los cinco añadidos no crean una nueva planificación estratégica ni un aggregator.

## 8.2 Conteos y recomendación

| Conteo v1.1 | Valor | Convención |
|---|---:|---|
| Fuentes leídas completas, acumuladas | 19 | D00–D18; 185 páginas PDF más cuatro textos. No repite baselines como nuevas fuentes. |
| Inputs de la fase de patch | 3 | Dos baselines v1.0 y D18 completo. |
| Decisiones del patch incorporadas | 5 | D1–D5 FROZEN; ninguna tratada como dato empírico probado. |
| Registro SUP, total | 21 | 20 sustituciones históricas + 1 reclasificación de alcance D5. |
| Registros CCR | 21 | 20 heredados, CCR-19 actualizado; CCR-21 nuevo. Sin doble conteo SUP. |
| Conflictos reales abiertos | 0 | TRUE_OPEN_CONFLICT; no niega discrepancias históricas resueltas. |
| Current open conceptual decisions | 0 | OD-01 histórico fuera del alcance actual. |
| Audit/evidence dependencies | 29 | 26 heredadas + 3 nuevas; DEP-28/29 condicionales por rol/candidato. |
| Canonical IMPs | 29 | 24 IDs conservados + IMP-25–IMP-29; ningún IMP de portfolio aggregation. |
| Puntos del quality gate v1.1 | 23 | Verificación documental detallada en Patch Report. |

**Recomendación de handoff:** La SPEC v1.1 está lista para entregarse a Astra/Paperclip y ejecutar su canonical IMP graph con los límites de audit, evidence y autoridad explícitos, sin requerir una nueva planificación arquitectónica.

# 9. Actualización factual autorizada — 2026-09-22

## 9.1 Fuentes nuevas de conocimiento

La actualización se apoya en U-BRU y en [U-AUDIT](sources/AUDIT_INPUTS_ENERGY_MARKETS.md)/[U-MATRIX](sources/AUDIT_INPUTS_ENERGY_MARKETS.csv), definidos en SPEC §0.5. Son una confirmación del owner y dos entregables del mismo audit. Los 19 documentos D00–D18 no se declaran releídos ni se infla su conteo con copias del mismo resultado. La integridad de adjuntos y baselines consta en `PROCUREMENT_RESEARCH_v1_1_to_v1_1_1_PATCH_REPORT.md` y `SHA256SUMS`.

## 9.2 Cantidades actuales

| Producto | Mission | Cantidad confirmada | Unidad | Fuente actual |
|---|---|---:|---|---|
| Gas | Monthly | 10 | MW | Confirmación de Bru, 2026-09-22 |
| Power | Monthly | 10 | MW | Confirmación de Bru, 2026-09-22 |
| Gas | Quarterly | 60 | MW | Confirmación de Bru, 2026-09-22 |
| Power | Quarterly | 20 | MW | Confirmación de Bru, 2026-09-22 |

No deben volver a preguntarse. Power Quarterly **20 MW** es la confirmación actual: «10 Energy» de D08 p.4/D15 p.2/CCR-08 se conserva como antecedente contradictorio, no como dato vigente ni conversión a MW. No se afirma vigencia retrospectiva ni identidad de una campaña; periodo, perfil/horas y vínculo al mandato permanecen pendientes. Fuente: U-AUDIT §§1,4,5,8.

## 9.3 Datos existentes

| Raíz bajo `/srv/hot-data/EEX/` | Archivos en el audit | Primer / último día de partición observado |
|---|---:|---|
| `table=eex_derivative_trade/cmdty=NATGAS/area=THE` | 2.801 | 2020-11-02 / 2026-07-28 |
| `table=eex_derivative_trade/cmdty=POWER/area=DE` | 4.802 | 2020-11-02 / 2026-07-28 |
| `table=eex_derivative_top_of_book/cmdty=NATGAS/area=THE` | 9.251 | 2025-07-25 / 2026-07-28 |
| `table=eex_derivative_top_of_book/cmdty=POWER/area=DE` | 33.453 | 2025-07-25 / 2026-07-28 |

Son las cuatro raíces prioritarias reportadas por U-AUDIT, no un inventario exhaustivo por fila/campaña. Los 59.961 Parquet y 93 GB son cifras del lago completo reportadas por el audit; las fechas no implican cobertura uniforme. Los mappings G0BM/G0BQ y DEBM/DEBQ no sustituyen un contract master ni vinculan el dato al cliente. La auditoría histórica de IMP-03 no permite afirmar ausencia global en BruNode. Fuente: U-AUDIT §§1,3,7,8.

## 9.4 Lo pendiente y quién produce el resultado

| Tema | Situación documental actual | Tratamiento |
|---|---|---|
| Cantidades en MW | Confirmadas por Bru e incorporadas a §4.1 | No volver a preguntarlas; vincularlas a campaña |
| Originales de empresa | No encontrados en las rutas inspeccionadas; correos/otros sistemas no inspeccionados | Recuperar fuentes existentes antes de solicitar sólo los campos pendientes |
| Campaña/mandato | Producto/hub/contrato, delivery, calendario, ownership y residual no materializados | IMP-02 recupera/reconcilia; la confirmación numérica no acepta la campaña |
| Ejecución/costes | Conceptos definidos; valores reales no encontrados | Obtener fuentes aplicables, auditar y versionar en el alcance correspondiente |
| Datos EEX | Existencia y metadata reportadas; cobertura/PIT por uso/derechos pendientes | Ampliar/reconciliar IMP-03 sin repetir la ausencia global ni reiniciar receipts |
| Benchmark | Metodología existente, código/fixtures sintéticos reportados y proxy de un día | Aplicación/reconciliación por campaña pendiente; no pedir otra explicación general |
| OOS, Shadow y aprendizaje | Resultados/parametrizaciones futuros del proyecto | Los produce la investigación; no son documentos que deban existir antes |

No hay una nueva aceptación de IMP-02/03/08 emitida por esta edición. U-AUDIT reporta aceptación sintética de IMP-08 y la cita se limita a ese alcance; no es una nueva comprobación de su receipt de disco. Las observaciones no levantan gates factuales, ni conceden Real Execution. Fuentes: U-AUDIT §§6,9,10 y SPEC §25.

## 9.5 Qué cambia en el implementation plan

El plan sigue siendo SPEC §25. Se añade §25.3 como aplicación factual, **sin cambiar una sola fila de §25.1/§25.2**. Se conserva el trabajo aceptado y la revisión por scope. La siguiente implementación legítima utiliza datos ya disponibles y resuelve faltantes concretos; no transforma estas notas en otra fase de maintenance ni en una autorización genérica de ejecución.
