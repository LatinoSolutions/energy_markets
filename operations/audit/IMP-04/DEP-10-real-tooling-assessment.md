# IMP-04 · DEP-10 — Capability assessment de herramientas reales

Fecha: 2026-09-23. Fuente normativa: SPEC v1.1.1 §6.4 (auditar permisos de uso y
capacidades/contrato del backtesting existente), §6.5 (tooling reportado) y
§25.1 IMP-04 ("Interfaces reales, fixtures sintéticos, constraints de uso";
entregable: capability assessment y decisión de reutilizar/extender/construir).

Este artefacto registra la materialización de DEP-10 que antes sólo existía como
framework sobre componentes sintéticos. El assessment vive en
`src/tooling-selection/real-tooling.mjs` y se consume en
`test/tooling-selection/real-tooling.test.mjs`.

## Backtesting existente (§6.4) — audit component-by-component

§6.4 exige auditar "permisos de uso y capacidades/contrato del backtesting
existente". El audit factual sobre este worktree es:

1. **En el repo Energy Markets** (`src/`) no existe ningún componente de
   backtesting: el símbolo no aparece en código, tests ni contratos; sólo en
   comentarios que citan la SPEC. Los módulos existentes aceptados cubren
   cálculo/admisión/rol-evaluación, no un backtester.
2. En la referencia histórica, `reference/plan/accion_plan.md:46` declara la
   secuencia «modelos → backtester → implementación → resultados» como paso
   futuro; la SPEC §6.5 corte 2026-09-22 reporta como tooling existente sólo el
   script de lectura EEX y el benchmark de `src/economic-calculation/benchmark.mjs`,
   con "no un benchmark validado de campaña" (hub pendiente DEP-08/09).

Hallazgo: **el backtesting existente está AUSENTE** en el alcance auditado. No
hay componente que reutilizar ni extender para backtesting, y no corresponde a
IMP-04 construir uno: la necesidad de construir exige demostración auditada
para el consumidor que lo requiera (§6.4: "construir un engine completo sólo
si la auditoría demuestra necesidad"). La decisión REUSE de abajo queda
delimitada al conjunto de capacidades del consumidor de benchmark (IMP-05) y
NO se presenta como resolución de la parte backtesting de §6.4 más allá del
alcance auditado: esa parte se registra como pendiente de consumidor (ver
Límites).

## Herramientas auditadas

| Componente | Interfaces reales | Derechos / IP | Uso permitido |
|---|---|---|---|
| `economic-calculation.benchmark` (`src/economic-calculation/benchmark.mjs`, aceptado IMP-08) | `benchmarkB`, `selectBenchmarkReferences`; salidas `B`, `count`, `coverage`, `referenceSelection`, `excludedSelectionCount`; `capabilityOutputs` liga `benchmark.calculate`→`B`,`count`, `benchmark.coverage`→`coverage`, `reference.select`→`referenceSelection`,`excludedSelectionCount` | Código propio del repo; IP sin exposición | sí |
| `power-markets-explorer.generate_eex_snapshot` (`/home/op/apps/power-markets-explorer/scripts/generate_eex_snapshot.py`) | lectura de Parquet EEX → snapshot JSON | entitlements/rights del lago EEX pendientes (SPEC §6.5:626) | no (unknown) |

## Decisión factual

Para las capacidades requeridas por el consumidor de benchmark (IMP-05)
`benchmark.calculate`, `benchmark.coverage`, `reference.select`, existe
exactamente un componente usable suficiente: `economic-calculation.benchmark`.
La decisión es **REUSE** de ese componente, sostenida por una reconciliación
independiente recalculada desde las salidas reales de `benchmarkB()` y de
`selectBenchmarkReferences()` (capacidad `reference.select`) contra fixtures
permitidos con cómputo manual: media 102, conteo 3, cobertura 3/3, selección
ordenada excluyendo la fila no accesible (1 fila excluida).

Límite residual: el código exige que cada capacidad requerida esté ligada a
salidas reconciliadas, pero no puede verificar que la salida ligada pruebe
semánticamente esa capacidad; esa correspondencia es parte del audit y la
sostiene el test de `real-tooling` sobre `capabilityOutputs`.

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
- Tolerancia: la SPEC no fija un valor canónico (sólo el caso de audit 0.01),
  así que el valor lo declara la evidencia. El validador no acepta sin embargo
  una cota que iguala o supera la magnitud del valor esperado: aprobaría una
  discrepancia de hasta el 100%, que no es una tolerancia (revisión del
  audit 2026-09-23: observado 102, esperado 1000000, tolerancia 1000000
  producían REUSE y se reproducen en test). Queda para decisión de Bru si se
  quiere una cota numérica canónica además de la estructura.
- §6.4 backtesting: la auditoría de capacidades/permisos del backtesting
  existente se cierra en el alcance auditado con el hallazgo AUSENTE (no hay
  componente). Su "resolución" para un futuro consumidor de backtesting
  corresponde a otro IMP con necesidad demostrada; aquí no se construye ni se
  presupone.
