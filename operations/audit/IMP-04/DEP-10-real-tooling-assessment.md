# IMP-04 · DEP-10 — Capability assessment de herramientas reales

Fecha: 2026-09-23. Fuente normativa: SPEC v1.1.1 §6.4 (auditar permisos de uso y
capacidades/contrato del backtesting existente), §6.5 (tooling reportado) y
§25.1 IMP-04 ("Interfaces reales, fixtures sintéticos, constraints de uso";
entregable: capability assessment y decisión de reutilizar/extender/construir).

Este artefacto registra la materialización de DEP-10 que antes sólo existía como
framework sobre componentes sintéticos. El assessment vive en
`src/tooling-selection/real-tooling.mjs` y se consume en
`test/tooling-selection/real-tooling.test.mjs`.

## Herramientas auditadas

| Componente | Interfaces reales | Derechos / IP | Uso permitido |
|---|---|---|---|
| `economic-calculation.benchmark` (`src/economic-calculation/benchmark.mjs`, aceptado IMP-08) | `benchmarkB`, `selectBenchmarkReferences`; salidas `B`, `count`, `coverage` | Código propio del repo; IP sin exposición | sí |
| `power-markets-explorer.generate_eex_snapshot` (`/home/op/apps/power-markets-explorer/scripts/generate_eex_snapshot.py`) | lectura de Parquet EEX → snapshot JSON | entitlements/rights del lago EEX pendientes (SPEC §6.5:626) | no (unknown) |

## Decisión factual

Para las capacidades requeridas por el consumidor de benchmark (IMP-05)
`benchmark.calculate`, `benchmark.coverage`, `reference.select`, existe
exactamente un componente usable suficiente: `economic-calculation.benchmark`.
La decisión es **REUSE** de ese componente, sostenida por una reconciliación
independiente recalculada desde las salidas reales de `benchmarkB` contra
fixtures permitidos (media manual 102, conteo 3, cobertura 3/3).

El script de lectura EEX se audita y queda **excluido** de la adopción mientras
sus derechos no estén acreditados; "datos legibles no prueban derechos".

Esta decisión no concede autoridad de producción y no acredita benchmark de
campaña (DEP-08/09) ni data-readiness del lago (DEP-06/07).

## Hashes de procedencia (bytes en este worktree)

- `src/economic-calculation/benchmark.mjs` — `0db32ff428fe41482904803664c448b9c3d984d234aff0a1bdfa91db34bc17c1`
- `src/economic-calculation/index.mjs` — `04217b163082ac848a5088a2120fb201d32b64ab9e6737b2179e7b20da2e8d66`
- `operations/receipts/IMP-08-IMP_RECEIPT.json` — `43b56173f021331a889393d3697f1ca8bdf40491e450798238044ac8decc9625`
- `/home/op/apps/power-markets-explorer/scripts/generate_eex_snapshot.py` — `01353f730d1bcba4a6cf83098b43914ee743212006aedf7ce8e548a95e491740`
- SPEC v1.1.1 — `666a9735d9daf62764582f017056171acae52070d18499b26c5c6e426cff3ef3`

## Reproducción

```
node --test test/tooling-selection/real-tooling.test.mjs
```

## Límites residuales (OPEN_ITEM)

- El validador verifica estructura y consistencia interna (salidas reales +
  fixtures `permitted` con cómputo independiente + cobertura de salidas clave),
  no procedencia criptográfica: la evidencia sigue siendo declarada por el
  llamador. Verificación por ejecución/hash de artefacto queda fuera de una
  librería pura y no es parte de este corte.
- `fixture.tolerance` lo declara la misma evidencia; una tolerancia arbitraria
  podría relajar una comparación. No hay valor canónico de tolerancia en la SPEC
  (sólo el caso de audit 0.01), así que no se inventa una cota aquí; se reporta
  para decisión de Bru.
