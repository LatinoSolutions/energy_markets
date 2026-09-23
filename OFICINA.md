# Energy Markets — instrucciones para agentes lanzados por la Oficina propia

Owner: Bru. Desde 2026-09-23 la Oficina propia (`/srv/hot-data/energy-markets/oficina`) trabaja junto a Paperclip en este repo.
Paperclip sigue trabajando en paralelo con sus propias reglas (AGENTS.md). Estas reglas son solo para agentes de la Oficina.

## Fuente de verdad

- SPEC normativa: `docs/canonical/v1_1_1/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1_1.md` (22-sep). La v1.1 queda como antecedente. Leer §25.1 y §25.2 del IMP asignado y las secciones que cite.
- Estado del plan: `PLAN_STATUS.md`. Qué está aceptado, qué está listo, qué depende de qué.
- `/srv/hot-data/energy-markets/reference` es procedencia histórica, no requisitos nuevos.

## Cómo se trabaja

- Cada tarea corre en su propio git worktree y su propia rama `run/...`. Trabaja solo dentro del directorio actual.
- Haz commits en tu rama. No hagas merge a `main`, no hagas push, no cambies de rama.
- Tests: `node --test $(find test -name '*.test.mjs')`. Todo cambio de código va con su test. Los tests tienen que pasar antes de terminar.
- No inventes datos, fees, evidencia ni receipts aceptados. Si falta un dato que solo Bru tiene, dilo en el resumen final y avanza con lo que sí se puede.
- No marques un IMP como `aceptado` en `PLAN_STATUS.md`. Eso lo decide Bru en la Oficina.
- Si la SPEC se contradice, no la cambies en silencio: descríbelo en el resumen final con cita exacta (sección y texto).
- No toques `operations/audit/IMP-26`, `operations/patches` ni nada de Paperclip.

## Resumen final obligatorio

Termina siempre con un bloque:

```
RESUMEN
- Qué hice:
- Archivos:
- Tests: (comando y resultado)
- Falta / bloqueos:
```
