# Execution contract and cost ledger P5.6 (IMP-07)

Materializa el contrato de ejecución y la configuración del cost ledger que
P5.6 exige compartir a A0 y A1. Fuente de verdad:
`docs/canonical/v1_1_1/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1_1.md`,
§13.6 (cinco reglas frozen de *execution and cost parity*), §14.2 (required
input `Execution: P5.6 execution-contract version`), §14.4 (campos del
execution ledger) y §5.5 (coste desconocido nunca cero).

Los valores reales provienen del paquete verificado del cliente
`ENERGY_MARKETS_CLIENT_INPUTS_2026-09-23` (`02_execution_costs/*` y
`01_campaigns/01_shared_campaign_rules.md`). Lo que el paquete no entrega
queda `UNKNOWN` con su razón; nunca se sustituye por cero. El contrato es un
objeto **versionado** pero **PROVISIONAL**: no se reclama P5.6 válido mientras
slippage/daily cap sigan provisionales y latency/fees sigan desconocidos.

## Acceptance test (SPEC v1.1.1 §25.1 IMP-07)

> Cada coste entra una vez; ningún fill requiere precio anterior no disponible
> o futuro seleccionado a conveniencia.

## Public API (`src/execution-contract/index.mjs`)

### Contrato — `execution-contract.mjs`

- `P56_FROZEN_RULES` — las cinco reglas de §13.6 (`CAUSAL_EXECUTION`,
  `SINGLE_COST_ACCOUNTING`, `OPERATIONAL_PARITY`, `NO_INVENTED_DEFAULTS`,
  `VALIDITY_GATE`) con su cita.
- `EXECUTION_PARAMETER_DEFINITIONS` — los diez parámetros que §13.6 exige con
  valor real: `decisionTime`, `referenceRule`, `slippage`, `fillRule`,
  `partialFillModel`, `latency`, `lotSize`, `rounding`, `dailyQuantityCap`,
  `fees`. Ninguno tiene default.
- `createGasQuarterlyExecutionContract()` — contrato poblado y versionado
  (`contractVersion: "v1.0"`, `versionStatus: "PROVISIONAL"`, `contentHash`).
- `validateExecutionContract(contract)` — exige las cinco reglas, todos los
  parámetros con forma y provenance, y rechaza defaults inventados, duplicados
  y `UNKNOWN` con valor (incluido `0` → `INVENTED_ZERO_COST`).
- `evaluateP56Validity(contract)` → `{ valid, status, blockers, reason }`.
  §13.6 regla 5: sólo `READY` cuando todos los parámetros son `AUDITED`; en el
  caso actual es `HOLD` con blockers `slippage`, `dailyQuantityCap`, `latency`
  y `fees`.
- `assertArmParity({ a0, a1 })` — §13.6 regla 3: ambos brazos deben declarar la
  misma `executionContractVersion` y `costLedgerVersion`.
- `versionKeyOf`, `contentHashOf`, `executionParameterOf`.

### Cost ledger — `cost-ledger.mjs`

- `COST_KINDS` — `VIRTUAL_SLIPPAGE`, `BROKERAGE_FEE`, `EXCHANGE_FEE`,
  `CLEARING_FEE`, `OTHER_FEE`.
- `createGasQuarterlyCostLedger()` — slippage virtual `KNOWN` 0.15 EUR/MWh y
  `OTHER_FEE` `UNKNOWN`/excluded sin importe.
- `validateCostLedger(ledger)` — §13.6 regla 2: la identidad contable es
  `kind + appliedTo`; repetirla es `DUPLICATE_COST_ACCOUNTING`. Un coste
  `UNKNOWN` con importe `0` se rechaza.
- `sumKnownLedgerCosts(ledger)` — suma sólo costes `KNOWN` de unidad
  compatible; un `UNKNOWN` deja el total `complete: false`, nunca lo omite.

### Ejecución causal — `causal-fill.mjs`

- `selectEligibleReference({ observations, decisionTime })` — §13.6 regla 1:
  elige la última observación con timestamp *at-or-before* la frontera; una
  observación futura nunca es elegible y un empate con precios distintos es
  ambiguo.
- `deriveSimulatedFillPrice({ referenceBestAsk, slippage, ... })` — best ask +
  slippage en la misma unidad; sin conversión inventada.
- `validateCausalFill({ fill, contract })` — rechaza precio futuro
  (`FUTURE_PRICE_SELECTED`), selección retrospectiva
  (`RETROSPECTIVE_SELECTION`), precio que no sale de la regla
  (`PRICE_NOT_DERIVED_FROM_RULE`) y ausencia de observación disponible.

## Límites

- El contrato no cierra DEP-05 como dato real ni declara DATA_READY: `fees` y
  `latency` siguen `UNKNOWN`. Sin parámetros reales suficientes no se reclama
  P5.6 válido (§25.2 fila IMP-07).
- No es un run económico ni evidencia de research; los fixtures sintéticos de
  los tests sólo prueban la ingeniería.
- `contentHash` usa una serialización JSON canónica propia: PLACEHOLDER, la
  SPEC no fija la serialización (mismo criterio que IMP-06).
