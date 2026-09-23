# IMP-02 / ST-02.1 — Audit factual de campaña Gas Quarterly y ownership

- Packet: `WP-IMP-02-ST-1-v1.1` · Subtask: `ST-02.1` · Parent: `IMP-02` (`LAT-107`)
- Project: Energy Markets `96bbd5b1-94da-4781-8c2b-455fdfb28d1a` · Native root: `LAT-91`
- Workspace: `/srv/hot-data/energy-markets/app` on `brunode`, empty `main` (content-hash baseline)
- SPEC: `PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1.md` v1.1, SHA256 `86c4bd4e…39cb6c`
- Accepted prerequisite: IMP-01 receipt SHA256 `78d92de8…b887c`, content version `c7cdf47c…d15a437c`

## 1. Scope and method

Read-only factual inspection of the project workspace and `/srv/hot-data/energy-markets/reference`.
Historical reference files are treated as provenance only: never extra requirements, never a
substitute for a real mandate. Facts are classified in four buckets:

| Bucket | Meaning |
|---|---|
| **Verificado (VERIFIED)** | Asserted with an inspected source, hash and exact locator. |
| **Afirmación histórica (HISTORICAL_ASSERTION)** | Value communicated in the corpus. Provenance only; not an executable contract. |
| **Faltante (MISSING)** | No real value exists. Documented with reason, inspected sources, custodian role and next retrieval action. |
| **Sintético (SYNTHETIC_EXAMPLE)** | Explicitly fabricated to exercise the verifier. Never accepted evidence. |

No product, unit, terminal rule or financial parameter was selected or inferred.

## 2. Result of the campaign ficha

`campaignIdentified = false`. **There is no real Gas Quarterly campaign mandate in the inspected
material.** The only campaign-shaped data are historical communicated quantities with incomplete
units. The source itself states it does not confirm the real procurement mandate.

| §4.1 field | Status | Evidence |
|---|---|---|
| Identidad (Campaign ID, producto/contrato, Power/Gas, Monthly/Quarterly, hub) | MISSING | No real mandate; `S-05 p.4`, `S-07 p.3` list these as unresolved. |
| Obligación (total conocido, unidad, periodo, perfil de entrega, enmiendas) | MISSING | Historical only: Gas Quarterly `60 MW`, Gas Monthly `10 MW` (`S-05 p.4`, `S-06 p.2`). MW ≠ MWh; horas/perfil ausentes. |
| Calendario (apertura/cierre, oportunidades, deadline, pausa) | MISSING | Only the benchmark reference windows are verified (below); no real calendar/deadline. |
| Factibilidad (lotes, redondeo, restricciones, regla terminal) | MISSING | `S-01 §24 DEP-04/05`, `S-07 p.3`. |
| Ejecución (fills, latencia, parciales, spread/slippage, fees, costes) | MISSING | `S-01 §13.6`, `§24 DEP-05`. |
| Estado de cobertura (executed, remaining, asignación) | MISSING | No obligations or fills exist. |

### Verified facts (source-backed)

- **Benchmark windows** (`S-01 §5.3` L384-389): Monthly `1-0-1 = [S−1 mes, S)`; Quarterly
  `3-1-3 = [Q−4 meses, Q−1 mes)`. Explicit guard: this is an economic reference and
  **does not authorize execution** inside the excluded month (L389).
- **First-experiment population** (`S-01 §13.3` L1187): *eligible Gas Quarterly procurement
  campaigns*; if evidence is insufficient → HOLD. This is a canonical target, not a real campaign.

### Historical assertions (provenance only)

Gas Quarterly `60 MW` and Gas Monthly `10 MW` (`S-05 p.4`, `S-06 p.2`), Power Monthly `10 MW`,
Power Quarterly `«10 Energy»; unidad no explicitada`, "cliente en Alemania" and the narrative
"tres meses de actividad y un mes de delivery" (`S-05 p.4`). Section §4.1: these quantities do not
authorize conversions and do not replace an executable contract. The source itself records that the
benchmark calendar precision "no confirma todavía el mandato real de compras" (`S-05 p.4`).

## 3. Coverage ownership (DEP-02)

The relation Monthly/Quarterly (additional, overlapping or alternative) is **MISSING**; the corpus
explicitly leaves it unresolved (`S-07 p.3`). There are no obligations and no fills, so there is no
ownership map. Invariant enforced for any future data: **a fill/coverage belongs to at most one
obligation**; duplicate ownership is rejected.

## 4. Reconciliation and conservation

`OpeningObligation = ExecutedVolume + RemainingVolume` is **NOT COMPUTABLE** (no numeric opening,
executed or remaining volume). `coverageStatus = NOT_COMPUTABLE_NO_REAL_CAMPAIGN`,
`terminalRuleStatus = MISSING`, `closeOutFill = null`. Guards hold: total obligation is not
per-BUY sizing; the benchmark window is not execution permission; an unknown terminal rule never
creates a close-out fill.

## 5. DEP-01–04 scope/limits report

Structured version: `operations/audit/IMP-02/dep-01-04-report.json`.

| DEP | Status | Scope limits |
|---|---|---|
| DEP-01 — mandato/producto/unidades | **DOCUMENTED_ABSENCE** (not resolved) | No product, hub, contract, executable unit or delivery profile; German residency does not identify the Gas product. |
| DEP-02 — relación Monthly/Quarterly y ownership | **DOCUMENTED_ABSENCE** (not resolved) | Relation unresolved; no obligation set or fill ledger; no double-counting check possible on real data. |
| DEP-03 — calendario, dead­line, decision boundaries | **DOCUMENTED_ABSENCE** (not resolved) | Benchmark reference windows verified, but no real calendar/deadline; 11:00 is not a default. |
| DEP-04 — regla terminal y amendments | **DOCUMENTED_ABSENCE** (not resolved) | No valid terminal rule; residual without rule ⇒ `COVERAGE_INCOMPLETE`, no invented fill. |

`RESOLVES_AUDIT` is claimed only for the actually inspected material: a factual reconciliation plus a
documented absence. **A documented absence is not a closure** and does not certify a missing contract.

### Unmet canonical parent criteria (IMP-02)

1. "Mandato/producto/calendario/delivery auditados" — not audited: no real mandate exists.
2. The campaign contract cannot be materialized from real inputs (`campaignIdentified=false`).
3. Remaining volume/deadline cannot be determined.
4. The coverage-ownership map cannot be produced (no obligations/fills).
5. DEP-01–04 remain open pending retrieval from the named custodian.

**Parent recommendation: block IMP-02** on the factual absence of the real campaign mandate
(audit-dependent blocker), preserving this ST's factual reconciliation and documented absence.
This does not reduce parent scope or acceptance.

## 6. How to reproduce

```
cd /srv/hot-data/energy-markets/app
sha256sum docs/canonical/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1.md operations/receipts/IMP-01-IMP_RECEIPT.json
/opt/node/bin/node operations/audit/IMP-02/verify.mjs
```

Expected: both hashes match the expected values and `verify.mjs` exits `0`, validating input hashes,
**inventory integrity (fail closed)**, field provenance, conservation/ownership invariants and all
negative cases, while reporting the real-data insufficiency separately. Full stdout/stderr/exit code:
`operations/audit/IMP-02/verify-run.txt`.

## 7. Correcciones de la ronda de review stage 2

Tres correcciones acotadas, sin cambio de arquitectura ni de alcance:

1. **Inventario fail-closed.** `verify.mjs` ahora valida **todas** las fuentes del inventario
   (existencia + hash pinneado) antes de la provenance, no sólo las que un hecho cita. Regresiones
   añadidas: fuente citada ausente (S-05) y drift en una fuente usada para ausencia (S-07), ambas
   detectadas sin mutar ficheros de referencia. El inventario intacto pasa.
2. **Ejecutable publicado byte-exacto.** El documento nativo anterior corrompía las secuencias
   de escape de nueva línea (barra invertida + n) dentro de strings de JavaScript. El `verify.mjs`
   reescrito no contiene ningún backslash;
   se re-publica y se verifica con `node --check` sobre el cuerpo descargado y comparación byte a
   byte con disco.
3. **Alcance explícito del content-version.** El hash de versión ya no depende del glob
   `operations/audit/IMP-02/**`; se enumeran exactamente los siete ficheros de contenido:
   `audit-report.md`, `campaign-contract.json`, `coverage-ownership.json`, `dep-01-04-report.json`,
   `source-inventory.json`, `verify.mjs`, `verify-run.txt`. `write-set-manifest.json` queda
   **excluido explícitamente** por ser metadato auto-referente (no se auto-hashea). La versión de
   contenido resultante se registra en `operations/receipts/IMP-02-ST-1.json` y en
   `write-set-manifest.json` (ninguno de los dos forma parte del conjunto hasheado).

`inputsUsed` referencia además el inventario completo de fuentes (`source-inventory.json`), que
incluye S-08 (`Master_Plan_P1-P4`) y S-09 (`Master_Plan_P5`). La insuficiencia factual del mandato
real y la recomendación de bloquear el parent no cambian.