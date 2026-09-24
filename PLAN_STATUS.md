# PLAN_STATUS — Energy Markets / Procurement Research

Fuente normativa: `docs/canonical/v1_1_1/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1_1.md` (22-sep, reemplaza a v1.1), §25.1 (objetivos y acceptance), §25.2.2 (dependencias) y §25.3 (audit de inputs).
La columna REQUIERE copia solo los IMP de §25.2.2; los requisitos de audit/evidencia (DEP-xx) están en la SPEC y se leen allí.
Los REQUIERE son idénticos en la SPEC v1.1.1 del 22-sep (comparado columna por columna el 23-sep).

## Reglas

- Estados válidos: `aceptado`, `en_curso`, `pendiente`, `pausado`.
- Un IMP está LISTO cuando es `pendiente` y todos sus REQUIERE están `aceptado`. Eso lo calcula la oficina, no se escribe.
- Solo Bru (o una revisión aprobada que Bru acepta en la oficina) pasa un IMP a `aceptado`. Un agente nunca se marca `aceptado` a sí mismo.
- Si un IMP necesita datos que solo Bru tiene, se anota en NOTA y se sigue con lo que sí se puede hacer.
- Las tareas `UI-*` son extensiones de producto añadidas explícitamente por Bru; quedan fuera del grafo normativo §25.2.2, pueden depender de IMP aceptados y nunca cambian la SPEC ni sus criterios de aceptación.

## Tabla

| IMP | ESTADO | REQUIERE | OBJETIVO | NOTA |
|---|---|---|---|---|
| IMP-01 | aceptado | — | Materializar contratos de identidad/versiones y namespaces. | Receipt `operations/receipts/IMP-01-IMP_RECEIPT.json`, 2026-09-19. |
| IMP-02 | aceptado | IMP-01 | Reconstruir ficha de una campaña Gas Quarterly y relaciones de obligación. | Cantidades 10/10/60/20 MW confirmadas por Bru (SPEC v1.1.1 §4.1, §25.3). Según el audit del 22-sep (`docs/canonical/v1_1_1/sources/AUDIT_INPUTS_ENERGY_MARKETS.md`:242 y :251) faltan Campaign ID, producto/hub/contrato, delivery, calendario y ownership: incorporar lo confirmado sin inventar el resto y dejar esos campos como faltantes explícitos. |
| IMP-03 | aceptado | IMP-01 | Ejecutar data audit y poblar Data Sufficiency Matrix. | Receipt 2026-09-19, scope "negative audit only". §25.3: ampliar inventario con el lago `/srv/hot-data/EEX`. |
| IMP-04 | aceptado | IMP-03 | Seleccionar herramienta mínima suficiente. |  |
| IMP-05 | aceptado | IMP-02, IMP-03, IMP-04 | Reproducir benchmark y auditar reconciliación official/proxy. |  |
| IMP-06 | aceptado | IMP-01, IMP-03 | Construir vistas decision-time y evaluation separadas. |  |
| IMP-07 | aceptado | IMP-02, IMP-03 | Poblar/versionar execution contract y cost ledger P5.6. |  |
| IMP-08 | aceptado | IMP-01 | Materializar cálculo B/H/V y scoring con casos límite. | Receipt 2026-09-22. Fixtures sintéticos, no campaña real. |
| IMP-09 | aceptado | IMP-02, IMP-03, IMP-07 | Identificar y reservar el final OOS antes de cualquier selección/calibración S1. |  |
| IMP-10 | aceptado | IMP-02, IMP-07 | Implementar controlador Calendar-only / price-blind. |  |
| IMP-11 | aceptado | IMP-03, IMP-06, IMP-09, IMP-10 | Instanciar S1 mínimo y A1. |  |
| IMP-12 | aceptado | IMP-01, IMP-02, IMP-06, IMP-07, IMP-10 | Construir replay y ledgers P6. |  |
| IMP-13 | aceptado | IMP-08, IMP-12 | Codificar fixtures previamente verificados a mano. |  |
| IMP-14 | aceptado | IMP-01, IMP-05, IMP-06, IMP-07, IMP-12 | Materializar run receipts y reproducibilidad. |  |
| IMP-15 | aceptado | IMP-05, IMP-07, IMP-08, IMP-13, IMP-14 | Cerrar instrumento P6 y campaña manual end-to-end. | Ingeniería del instrumento completa y revisada (closure gate/receipt §14.10, items fail-closed; IMP15-H1..H7 cerrados y reproducidos; suite 1085/0). Registro corregido 24-sep (IMP15-H8): la identidad de campaña de research es determinista por producto+período/maturity (GAS-Q-YYYYQn) y NO se requiere Campaign ID comercial ni campaign/fills/ownership live (aclaración del owner, puntos 1–8, P-006 RESUELTA 23-sep-2026, record IMP-02; IMP-02 aceptado). El cierre entregado se demuestra sobre fixture sintética declarada — el receipt NO se declara implementation-ready (§14.10). Bloqueo real del REQUIRES_AUDIT §25.2.2 DEP-01–09 [campaña manual real y parámetros utilizados] para el acceptance del parent: un cierre sobre episodio REAL de la campaña Gas Quarterly exige lago EEX auditado por instrumento/episodio (DEP-06/07 AUDIT-DEPENDENT; CCR-13: extremos de particiones THE/DE 2020-11-02..2026-07-28, no historia uniforme ni campañas elegibles certificadas, §6.5) y benchmark B reconciliado (IMP-05: UNRECONCILED) — trabajo de ingeniería/auditoría interno (scope IMP-03/05/06 en curso), no un hecho externo ni un dato que solo Bru tenga. El ACTO que depende de eso es el acceptance del parent: coincidencia manual/evaluator en B/H/V/coverage sobre el episodio real. |
| IMP-16 | aceptado | IMP-09, IMP-11, IMP-15 | Confirmar reserva OOS intacta, congelar bundle P5 completo y ejecutar A0/A1. |  |
| IMP-17 | aceptado | IMP-01, IMP-12, IMP-14 | Materializar Experience con provenance y atribución. |  |
| IMP-18 | aceptado | IMP-16, IMP-17 | Implementar captura Shadow y verificar non-interference. |  |
| IMP-19 | aceptado | IMP-15, IMP-16, IMP-17 | Implementar ciclo offline y evaluar Value/Policy Learning. | §25.2.2: IMP-16 y/o IMP-18 según procedencia; aquí se exige IMP-16. |
| IMP-20 | aceptado | IMP-16 | Diseñar después experimentos de S2–S5 y Z/drivers admitidos. |  |
| IMP-21 | aceptado | IMP-15, IMP-16 | Evaluar Q07 en protocolo separado. |  |
| IMP-22 | aceptado | IMP-16 | Investigar Sizing Policy y extensiones de misión. |  |
| IMP-23 | aceptado | IMP-01, IMP-07, IMP-17 | Materializar enforcement externo del envelope y rollback. |  |
| IMP-24 | aceptado | IMP-16, IMP-18, IMP-23 | Materializar governance, primera activación humana y después progresión autorizada por fases. | IMP-19 solo para versiones de ese Learning Loop. |
| IMP-25 | aceptado | — | Auditar Paperclip existente y mapear su workflow al handoff canónico, preservando la oficina. | Receipt 2026-09-19. |
| IMP-26 | aceptado | IMP-01, IMP-25 | Vincular la SPEC y canonical IMP graph a la ejecución del office, extendiendo sólo las brechas verificadas. | Owner decision 24-sep: EM-SPEC-OWNER-PATCH-2026-09-24-01 rebindea el runtime a la Oficina canónica propia; conservar audit histórico, revalidar delta factual actual y extender sólo brechas verificadas. |
| IMP-27 | aceptado | IMP-01 | Materializar el Strategy Admission framework y validaciones acotadas de candidatos futuros. | Receipt 2026-09-19, solo framework. |
| IMP-28 | aceptado | IMP-01 | Materializar evaluación por rol de componentes externos. | Receipt 2026-09-19, solo framework. |
| IMP-29 | aceptado | IMP-01, IMP-06 | Materializar Operator Interface Boundary y exposición backend que soporte Human Visual Observability. |  |
| UI-01 | aceptado | IMP-29 | Materializar la primera UI visual de Replay, Backtests, Research y Campaigns & Runs sobre el Operator Interface Boundary aceptado. | Owner-added 23-sep-2026. Referencias: `docs/product/UI-01_VISUAL_REFERENCE_BRIEF.md`; source Mac `/Users/brunillo/Documents/energy_markets/strategy_visualizations_documents`; destino BruNode `/srv/hot-data/oficina-data/design-references/energy-markets/strategy_visualizations_documents/`. Mockups/docs son referencia visual no normativa; no inventar data downstream ni cambiar SPEC. |
| DES-01 | aceptado | IMP-29 | Producir una propuesta visual BLIND de Claude para Energy Markets, independiente del diseño GPT/referencias existentes. | Completado 24-sep-2026 en proyecto aislado `energy-markets-claude-blind-ui`, commit `c35510b`: prototipo navegable + rationale + 8 screenshots. Blindness preservada; no inspeccionó UI/referencias/GPT existentes. |
| DES-02 | aceptado | DES-01 | Gate humano de selección y freeze visual: Bru compara propuesta Claude blind vs propuesta GPT/reference y decide diseño final o híbrido. | OWNER DECISION 24-sep-2026: seleccionar Claude Blind UI como dirección visual de Energy Markets. La propuesta GPT queda reservada como referencia para Alexandria más adelante. |
| UI-03 | aceptado | UI-01, DES-02 | Integrar en la UI productiva la dirección visual Claude Blind seleccionada por Bru, preservando exactamente los contratos/semántica del Operator Interface Boundary. | Owner decision 24-sep-2026. Fuente visual seleccionada: proyecto aislado `energy-markets-claude-blind-ui`, commit `c35510b`; usar layout/interaction/visual language, NO sus datos demo ni sus supuestos inventados B/H/V/ΔV, T0+84, CI90% o Procurement committee. Bind sólo datos canónicos; desconocidos siguen UNAVAILABLE/ERROR fail-closed. Implementar sin publicar/activar ejecución real. |
| UI-02 | aceptado | UI-03, IMP-24 | Servir la UI elegida por Bru de Energy Markets en una ruta web estable y entregar una URL navegable. | Owner-added 24-sep-2026; actualizado tras design freeze. Acceptance: servir la implementación aceptada de UI-03; reutilizar infraestructura existente cuando sea posible; exponer Replay, Backtests, Research y Campaigns & Runs desde una URL estable con health check; no cambiar semántica/cálculos del Operator Interface Boundary ni inventar datos; estados UNAVAILABLE/ERROR siguen fail-closed; no abrir exposición pública nueva ni tocar ejecución real/capital; añadir tests de ruta/navegación y documentar comando/servicio + URL final para Bru. |
| UI-04 | aceptado | UI-02, IMP-29 | Verificar/reutilizar la fidelidad 1:1 ya corregida por Claude y poblar Replay, Backtests, Research y Campaigns con datos canónicos disponibles; entregar requisitos y TO-DO de lo faltante. | OWNER REQUEST 24-sep-2026. Instrucción literal a Claude: “queremos que se vea nuestra página de User Interface uno a uno con el mockup que mandaste, rellena con los datos que tengamos y los que no tenemos o los que faltes nos haces una lista y ahí tenemos una lista como de to-do”. Restricción: cero datos demo/fabricados; cada valor visible debe tener productor/manifest canónico verificable. Si falta un dato, dejar la superficie honesta UNAVAILABLE/ERROR y registrar el TO-DO exacto con productor, input requerido, proceso/run necesario y criterio de cierre. Aclaración posterior de Bru: CLAUDE OPUS 5.5 EXCLUSIVO, sin sustitución barata. Ver docs/product/UI-04_OWNER_BRIEF_2026-09-24.md. Pausa de dispatch/follow-ups automática sólo para proteger esta asignación; no rehacer el diseño ya corregido. |
