# IMP-15 — Oracle de la campaña manual end-to-end (cierre del instrumento P6)

Parent: `IMP-15` — *Cerrar instrumento P6 y campaña manual end-to-end* (SPEC v1.1.1 §25.1/§25.2.2).
Source of truth: `docs/canonical/v1_1_1/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1_1.md` (v1.1.1, 22-sep-2026), §§14 y 19.

**Nada de esto son datos reales del cliente.** Las decisiones, precios observados y closes de
benchmark son sintéticos explícitos, capturados a mano ANTES de codificar el test
(**antes** de ejecutar el evaluator, siguiendo el mismo orden interno de §25.2.3 que IMP-13).
El cierre prueba el instrumento P6 (§14.10 "evidencia de validez del instrumento, no research
PASS"); no acredita edge de S1, no cierra DEP-01–09 para una campaña manual real y no es
aceptación del IMP ni research PASS (§25.1 "Closure gate P6 superado no equivale a research
PASS").

Perfil de la campaña: Gas Quarterly vigente confirmado por Bru (IMP-02 aceptado, SPEC §4.1,
OFICINA.md): objetivo 60 MW, posición inicial 0 MW, incrementos de 1 MW, cap provisional
12 MW/day, 11:00 Europe/Berlin (en frontera UTC 10:00Z del fixture sintético).

## Cálculo del controller (SIZING-RECON-V1, §13.2)

q_t = floor(min(RemainingVolume_t / RemainingScheduledOpportunities_t, 12)) a lotes de 1 MW;
última oportunidad: min(remaining, cap). Con 10 oportunidades y obligación 60 MW:

d1: 60/10=6 · d2: 54/9=6 · d3: 48/8=6 · d4: 42/7=6 · d5: 36/6=6
d6: 30/5=6 · d7: 24/4=6 · d8: 18/3=6 · d9: 12/2=6 · d10(última): min(6,12)=6

Todos los requests tienen precio último at-or-before la frontera → BUY lleno en cada día:
**10 fills de 6 MW = 60 MW; remaining 0 MW; cobertura COVERED (§14.5: 60 = 60 + 0).**

## Fills y H (coste all-in unitario, §14.6 + §5.5 + §13.6)

Regla frozen de fill: latest best ask at-or-before la frontera + slippage virtual 0.15 EUR/MWh
(KNOWN en el cost ledger P5.6); fees restantes UNKNOWN/excluded, nunca cero.

| Fecha | Ask | Precio fill (ask+0.15) | MW | Total EUR |
|---|---|---|---|---|
| 2026-06-01 | 41.20 | 41.35 | 6 | 248.10 |
| 2026-06-02 | 40.90 | 41.05 | 6 | 246.30 |
| 2026-06-03 | 40.85 | 41.00 | 6 | 246.00 |
| 2026-06-04 | 41.60 | 41.75 | 6 | 250.50 |
| 2026-06-05 | 41.30 | 41.45 | 6 | 248.70 |
| 2026-06-08 | 40.75 | 40.90 | 6 | 245.40 |
| 2026-06-09 | 41.10 | 41.25 | 6 | 247.50 |
| 2026-06-10 | 40.95 | 41.10 | 6 | 246.60 |
| 2026-06-11 | 41.45 | 41.60 | 6 | 249.60 |
| 2026-06-12 | 41.05 | 41.20 | 6 | 247.20 |

Notional all-in = **2475.90 EUR** (cada slippage entra una sola vez: 10 × 0.15 × 6 = 9.00 EUR ya
incluido en el precio fill). H = 2475.90 / 60 MW = **41.265 EUR/MWh**.

## B (benchmark cerrado, media diaria ponderada, §5.3)

Closes sintéticos seleccionados en la ventana de campaña (vista de evaluación; keys
`B.G0BQ.FX15.closed` disjuntas de la decision view `G0BQ.FX15.reference`, §14.3):

B = (45.20 + 44.70 + 45.31) / 3 = 135.21 / 3 = **45.07 EUR/MWh**.

## V y coverage

V = B − H = 45.07 − 41.265 = **3.805 EUR/MWh** (mismo unit compatible, §14.6).
Coverage al cierre: executed 60 MW, remaining 0 MW, la conservación
`OpeningObligation = ExecutedVolume + RemainingVolume` cuadra; resultado manual **COVERED**.

## Qué verifico cada comparativa (§25.2 IMP-15)

Coincidencia manual/evaluator en:
- `coverage.executedVolume` = 60 MW · `coverage.remainingVolume` = 0 MW · `coverage.status` COVERED
- H = 41.265 EUR/MWh · B = 45.07 EUR/MWh · V = 3.805 EUR/MWh

El reviewer debe recalcular a mano; un solo script no es independiente (mismo criterio que
IMP-13). Nota de alcance: el brazo A1 no existe aún (IMP-11 pendiente): el ítem de paridad
de treatment A0/A1 del gate §14.10 queda **NOT_EVALUATED** (pendiente, `pendingIds`);
el gate no queda completo (`gateComplete=false`) y el receipt NO declara
"implementation-ready por gate superado". Cuando exista un brazo A1 distinto, la paridad
(§14.10 ítem 4) se verificará fill a fill; no se fabrica paridad con un solo brazo
(§25.2 IMP-15 no exige S1 OOS).

## Evidencia del suite IMP-13 (GATE-01, §14.10 ítem 1)

La aprobación de los diez fixtures §14.8 NO se auto-atestúa en el test IMP-15:
`operations/audit/IMP-15/run-imp13-fixture-suite.mjs` ejecuta de verdad
`node --test test/imp13/manual-fixtures.test.mjs` (reporter TAP) y materializa
`operations/audit/IMP-15/imp13-fixture-suite-run.json` con el resultado por fixture
canónico (Prefijo de nombre de test → fixture ID) y un `suiteDigest` de contenido.
Si el artefacto se edita a mano o un test cambia de nombre sin actualizar el manifiest,
el digest/coverage deja de cuadrar y GATE-01 rechaza la evidencia (fail-closed).

## Cost-ledger del fixture IMP15-H1 (reconciliación embedded-vs-ledger)

En la campaña de cierre, el único coste KNOWN (`cost.slippage.virtual`, 0.15 EUR/MWh) ya va
**embebido** en `executionPrice` (§13.6 regla 1); el replay lo marca `embedded=true` y el
evaluator lo contabiliza vía precio, exactamente una vez (no re-suma). El test IMP15-H1
añade un exchange fee KNOWN **no embebido** (0.25 EUR/MWh, fixture sintético): H se mueve
a 41.265 + 0.25 = **41.515 EUR/MWh** en ambas vías (manual y run) y quedan de acuerdo;
si la captura omite ese coste, la comparativa falla (la paridad B/H/V no se fabrica por
coincidencia). Un VIRTUAL_SLIPPAGE cuyo amount no coincide con el slippage del execution
contract deja el run INVALID_RUN (sin representación unívoca, fail-closed).
