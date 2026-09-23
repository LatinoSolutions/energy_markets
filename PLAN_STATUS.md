# PLAN_STATUS — Energy Markets / Procurement Research

Fuente normativa: `docs/canonical/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1.md`, §25.1 (objetivos y acceptance) y §25.2.2 (dependencias).
La columna REQUIERE copia solo los IMP de §25.2.2; los requisitos de audit/evidencia (DEP-xx) están en la SPEC y se leen allí.
Los REQUIERE son idénticos en la SPEC v1.1.1 del 22-sep (comparado columna por columna el 23-sep).

## Reglas

- Estados válidos: `aceptado`, `en_curso`, `pendiente`, `pausado`.
- Un IMP está LISTO cuando es `pendiente` y todos sus REQUIERE están `aceptado`. Eso lo calcula la oficina, no se escribe.
- Solo Bru (o una revisión aprobada que Bru acepta en la oficina) pasa un IMP a `aceptado`. Un agente nunca se marca `aceptado` a sí mismo.
- Si un IMP necesita datos que solo Bru tiene, se anota en NOTA y se sigue con lo que sí se puede hacer.

## Tabla

| IMP | ESTADO | REQUIERE | OBJETIVO | NOTA |
|---|---|---|---|---|
| IMP-01 | aceptado | — | Materializar contratos de identidad/versiones y namespaces. | Receipt `operations/receipts/IMP-01-IMP_RECEIPT.json`, 2026-09-19. |
| IMP-02 | pendiente | IMP-01 | Reconstruir ficha de una campaña Gas Quarterly y relaciones de obligación. | Cantidades 10/10/60/20 MW confirmadas por Bru (SPEC §4.1). Falta contrato, delivery, calendario y ownership (DEP-01–04): datos de Bru. |
| IMP-03 | aceptado | IMP-01 | Ejecutar data audit y poblar Data Sufficiency Matrix. | Receipt 2026-09-19, scope "negative audit only". §25.3: ampliar inventario con el lago `/srv/hot-data/EEX`. |
| IMP-04 | pendiente | IMP-03 | Seleccionar herramienta mínima suficiente. | |
| IMP-05 | pendiente | IMP-02, IMP-03, IMP-04 | Reproducir benchmark y auditar reconciliación official/proxy. | |
| IMP-06 | pendiente | IMP-01, IMP-03 | Construir vistas decision-time y evaluation separadas. | |
| IMP-07 | pendiente | IMP-02, IMP-03 | Poblar/versionar execution contract y cost ledger P5.6. | |
| IMP-08 | aceptado | IMP-01 | Materializar cálculo B/H/V y scoring con casos límite. | Receipt 2026-09-22. Fixtures sintéticos, no campaña real. |
| IMP-09 | pendiente | IMP-02, IMP-03, IMP-07 | Identificar y reservar el final OOS antes de cualquier selección/calibración S1. | |
| IMP-10 | pendiente | IMP-02, IMP-07 | Implementar controlador Calendar-only / price-blind. | |
| IMP-11 | pendiente | IMP-03, IMP-06, IMP-09, IMP-10 | Instanciar S1 mínimo y A1. | |
| IMP-12 | pendiente | IMP-01, IMP-02, IMP-06, IMP-07, IMP-10 | Construir replay y ledgers P6. | |
| IMP-13 | pendiente | IMP-08, IMP-12 | Codificar fixtures previamente verificados a mano. | |
| IMP-14 | pendiente | IMP-01, IMP-05, IMP-06, IMP-07, IMP-12 | Materializar run receipts y reproducibilidad. | |
| IMP-15 | pendiente | IMP-05, IMP-07, IMP-08, IMP-13, IMP-14 | Cerrar instrumento P6 y campaña manual end-to-end. | |
| IMP-16 | pendiente | IMP-09, IMP-11, IMP-15 | Confirmar reserva OOS intacta, congelar bundle P5 completo y ejecutar A0/A1. | |
| IMP-17 | pendiente | IMP-01, IMP-12, IMP-14 | Materializar Experience con provenance y atribución. | |
| IMP-18 | pendiente | IMP-16, IMP-17 | Implementar captura Shadow y verificar non-interference. | |
| IMP-19 | pendiente | IMP-15, IMP-16, IMP-17 | Implementar ciclo offline y evaluar Value/Policy Learning. | §25.2.2: IMP-16 y/o IMP-18 según procedencia; aquí se exige IMP-16. |
| IMP-20 | pendiente | IMP-16 | Diseñar después experimentos de S2–S5 y Z/drivers admitidos. | |
| IMP-21 | pendiente | IMP-15, IMP-16 | Evaluar Q07 en protocolo separado. | |
| IMP-22 | pendiente | IMP-16 | Investigar Sizing Policy y extensiones de misión. | |
| IMP-23 | pendiente | IMP-01, IMP-07, IMP-17 | Materializar enforcement externo del envelope y rollback. | |
| IMP-24 | pendiente | IMP-16, IMP-18, IMP-23 | Materializar governance, primera activación humana y después progresión autorizada por fases. | IMP-19 solo para versiones de ese Learning Loop. |
| IMP-25 | aceptado | — | Auditar Paperclip existente y mapear su workflow al handoff canónico, preservando la oficina. | Receipt 2026-09-19. |
| IMP-26 | en_curso | IMP-01, IMP-25 | Vincular la SPEC y canonical IMP graph a la ejecución del office, extendiendo sólo las brechas verificadas. | En curso en Paperclip (Astra). Bru, 23-sep: dejarlo seguir. No lanzar desde la Oficina. |
| IMP-27 | aceptado | IMP-01 | Materializar el Strategy Admission framework y validaciones acotadas de candidatos futuros. | Receipt 2026-09-19, solo framework. |
| IMP-28 | aceptado | IMP-01 | Materializar evaluación por rol de componentes externos. | Receipt 2026-09-19, solo framework. |
| IMP-29 | pendiente | IMP-01, IMP-06 | Materializar Operator Interface Boundary y exposición backend que soporte Human Visual Observability. | |
