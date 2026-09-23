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

## Client inputs — Fundamental — 23-sep-2026

Paquete original del cliente, copiado y verificado byte-a-byte (15 archivos / 51.608 bytes):
`/srv/hot-data/oficina-data/client-inputs/energy-markets/ENERGY_MARKETS_CLIENT_INPUTS_2026-09-23/full-package/`

Receipt de verificación de la Oficina:
`/srv/hot-data/oficina-data/client-inputs/energy-markets/ENERGY_MARKETS_CLIENT_INPUTS_2026-09-23/full-package/OFICINA_INTAKE_VERIFICATION.json`

Antes de trabajar en un IMP que consuma datos de cliente, lee sólo las piezas pertinentes y contrástalas con la SPEC; el paquete aporta evidencia factual del cliente pero **no sustituye ni modifica la SPEC**. No inventes campos que el paquete no entregue.

Routing mínimo:
- IMP-02: `01_campaigns/*` + `ESTADO_INPUTS.csv`.
- IMP-05: `03_sources_benchmark_access/*` + `ESTADO_INPUTS.csv`. El cliente no entrega override/feed Fundamental de settlement: remite al benchmark EEX existente del research team; edge cases restantes son research-team work.
- IMP-07: `02_execution_costs/*` + reglas compartidas de campaña. Fees adicionales siguen unknown/excluded, nunca cero.
- IMP-09/10: campañas + validator specification.
- IMP-12: campañas + execution/costs + validator specification.
- IMP-18/23: `04_later_stages/*` cuando corresponda al scope.

Notas de interpretación obligatorias:
- Gas Quarterly actual: NATGAS/THE Quarterly, target 60 MW, 3-1-3, posición inicial 0 MW, 11:00 Europe/Berlin, 1 MW increments, 12 MW/day provisional, target exacto al último día efectivo, histórico de validación desde Q1 2021.
- Las maturities históricas son episodios de validación bajo el mandato actual; no prueban que Fundamental tuviera ese mandato históricamente.
- No se observa en este paquete un Campaign ID único/current maturity record; IMP-02 debe demostrar si puede materializar su campaña conforme a §25.1/§25.2 sin inventarlo.
- Ejecución backtest: latest TOB best ask <= 11:00 + 0.15 EUR/MWh provisional, full fill; otros fees unknown/excluded pending evidence.
