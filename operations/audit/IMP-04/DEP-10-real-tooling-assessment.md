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
si la auditoría demuestra necesidad"). La decisión de abajo queda
delimitada a los soportes de benchmark que consume IMP-05 y
NO se presenta como resolución de la parte backtesting de §6.4 más allá del
alcance auditado: esa parte se registra como pendiente de consumidor (ver
Límites).

## Capacidades que IMP-05 necesita (con fuente)

La lista anterior (`benchmark.calculate`, `benchmark.coverage`,
`reference.select`) no tenía fuente y omitía §5.4. La lista vigente está en
`IMP05_CAPABILITY_SOURCES` (`src/tooling-selection/real-tooling.mjs`), cada
capacidad con su cita a la SPEC v1.1.1. Un test comprueba que cada sección
citada existe. Se separa en los dos soportes que IMP-05 consume (§25.2.2 IMP-04:
"decisión técnica aplicable al soporte que consuma esa herramienta"):

- **Cálculo/reconciliación:**
  - `benchmark.calculate` y `benchmark.coverage` (§25.1, §5.3);
  - `benchmark.calendar.missing_dates` (§25.2.2 IMP-05 "calendario de benchmark", §5.3 calendario de fechas esperadas separado y missing trazados);
  - `benchmark.status.provisional` (§5.4 `BENCHMARK_PROVISIONAL`);
  - `benchmark.window.boundaries` y `benchmark.window.derive` (§25.1 "fronteras correctas" y "1-0-1/3-1-3", §5.3);
  - `reference.select` (§5.3) y `reference.proxy` (§5.2);
  - `reconciliation.official_proxy` (§25.1 "sustitución oficial sin borrar proxy", §5.4);
  - `benchmark.version` (§25.1 "B versionado", §5.4);
  - `official.value_0_01.treatment` (§25.1 "caso 0.01 investigado", §5.4).
- **Lectura de referencias reales:**
  - `reference.read.trades`, `reference.read.top_of_book` (§5.2, §6.5);
  - `reference.read.official` (§5.3, §25.2.2 IMP-05 REQUIRES_AUDIT DEP-06/07).

## Herramientas auditadas

| Componente | Cubre | No cubre (verificado en código) | Derechos / IP | Usable |
|---|---|---|---|---|
| `economic-calculation.benchmark` (`benchmark.mjs`, `reference.mjs`; IMP-08) | calculate, coverage, window.boundaries, reference.select, reference.proxy, 0.01 (tratamiento por validez declarada, no por valor) | calendar.missing_dates (`benchmarkB` recibe `expectedDates` como número; no lista las fechas missing); status.provisional (no emite status); window.derive (ninguna función deriva [S-1 mes,S) ni [Q-4,Q-1)); official_proxy (`selectDailyReference` devuelve sólo el valor elegido, sin δ_d ni ambos valores); version (`benchmarkB` no emite versión) | Código propio; IP none | sí |
| `power-markets-explorer.generate_eex_snapshot` | reference.read.trades (parcial: lee/deduplica `eex_derivative_trade`, emite velas 4H) | top_of_book, official | rights unknown, IP unknown (SPEC §6.5:626) | no (pendiente) |

## Decisión factual

1. **Soporte de cálculo de IMP-05: EXTEND `economic-calculation.benchmark`**
   - Se añaden sólo `benchmark.calendar.missing_dates`, `benchmark.status.provisional`, `benchmark.window.derive`, `reconciliation.official_proxy` y `benchmark.version`.
   - Lo cubierto se reconcilia de forma exacta: 14 salidas reales contra los fixtures documentales de §19.3.1, sin tolerancia (§14.8, §19.3.1):
     - B=105, count 2, coverage 2/3;
     - corrección 102→103 da B=106.5;
     - proxy 101;
     - oficial con timestamp más reciente = 103;
     - ventana [inicio,fin);
     - 0.01 con validez declarada se selecciona; con validez `unknown` se excluye y cae al derivado (100, `trades-only`).
   - `classifyOfficialValidity()` devuelve `canonicalRejectionRule: "none"` para toda entrada. No se usa como evidencia porque no discrimina.
   - Contrastar el guard 0.01 reportado con la fuente aplicable (§19.3.1, §25.2.2 IMP-05) queda para IMP-05 y exige `reference.read.official`.
   - **Juicio de auditoría, no cita de la SPEC:** el componente es "casi suficiente". Lo que falta son fórmulas cerradas de §5.3/§5.4 sobre salidas que ya produce (`extensionRationale`).
   - Implementar las 5 capacidades es trabajo de IMP-05, no de IMP-04.
2. **Soporte de lectura de referencias reales: BLOQUEADO (`BLOCKED_PENDING_RIGHTS_AUDIT`)**
   - El único lector existente tiene derechos/IP `unknown`.
   - No se extiende ni se construye otro lector mientras ese estado siga sin resolver: `unknown` no se degrada ni a permiso ni a "no existe".
   - Top-of-book y settlement oficial no los cubre ningún componente auditado. Además, §5.4 deja "pendiente la alineación empírica del proxy con un feed oficial o externo autorizado".
   - **Esto bloquea IMP-05** para datos reales: su REQUIRES_AUDIT (§25.2.2) incluye DEP-06/07 y DEP-10 "herramienta/uso autorizado". Lo resuelve una acreditación de derechos del lago EEX y de una fuente oficial, que sólo puede aportar el owner.

Esta decisión no concede autoridad de producción y no acredita benchmark de
campaña (DEP-08/09) ni data-readiness del lago (DEP-06/07).

## Reglas de decisión endurecidas (review 2026-09-23)

- Reconciliación exacta. Se rechaza cualquier tolerancia distinta de 0 y cualquier valor vacío o no finito (`undefined`, `null`, `NaN`, `Infinity`, `""`, `[]`).
- BUILD exige componentes auditados. Si un componente con derechos `unknown` cubre lo que se construiría, el resultado es bloqueo, no BUILD.
- BUILD y EXTEND no reimplementan lo que ya cubre otro componente usable (`EXISTING_COVERAGE_NOT_RESOLVED`).
- `validateToolingSelection` re-deriva la decisión desde los mismos assessments. Rechaza:
  - la elección a mano entre varios componentes suficientes;
  - assessments sin versión, evidencia o derechos;
  - cualquier selección distinta de la derivada;
  - un record cuyos `requiredCapabilities`, `targetAssessment`, `auditTrace`, `rationale` o `authority` contradigan la auditoría.
- El conjunto auditado es fijo: las dos herramientas que reporta §6.5. Un test lo comprueba, porque quitar un componente cambia la decisión.

## Hashes de procedencia (bytes en este worktree)

- `src/economic-calculation/benchmark.mjs` — `0db32ff428fe41482904803664c448b9c3d984d234aff0a1bdfa91db34bc17c1`
- `src/economic-calculation/index.mjs` — `04217b163082ac848a5088a2120fb201d32b64ab9e6737b2179e7b20da2e8d66`
- `operations/receipts/IMP-08-IMP_RECEIPT.json` — `43b56173f021331a889393d3697f1ca8bdf40491e450798238044ac8decc9625`
- `/home/op/apps/power-markets-explorer/scripts/generate_eex_snapshot.py` — `01353f730d1bcba4a6cf83098b43914ee743212006aedf7ce8e548a95e491740`
- `src/economic-calculation/reference.mjs` — `c8597ac83ba540b0de8b64dc2907e0e7e7c32417a02e06ee442f29d5514e511b`
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
- Tolerancia: la SPEC la fija en exactitud. §14.8 dice "reconcilian exactamente"; §19.3.1, "reconciliación exacta"; §19.3, "No se añaden epsilons". Un margen distinto requeriría §20.2.12.
- §6.4 backtesting: la auditoría de capacidades/permisos del backtesting
  existente se cierra en el alcance auditado con el hallazgo AUSENTE (no hay
  componente). Su "resolución" para un futuro consumidor de backtesting
  corresponde a otro IMP con necesidad demostrada; aquí no se construye ni se
  presupone.
