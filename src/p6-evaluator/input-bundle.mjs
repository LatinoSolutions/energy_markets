// Required input bundle P6.2 (IMP-12). Fuente: SPEC v1.1.1 §14.2 (required
// input bundle: experiment, campaign, opening contract, decision calendar,
// arm, sizing, execution, costs, benchmark, evaluator, stochasticity), regla
// "Un required input ausente no se reemplaza por un guessed default" y §14.4
// ("Los valores ... provienen de P5.6 auditado"). Fail-closed: sin bundle
// completo no hay replay; los componentes los aporta materialización previa
// (IMP-01/02/06/07/10) y aquí sólo se valida su identidad/versión.

import { isVersionLike } from "../contracts/identities.mjs";
import { contentHashOf, versionKeyOf, validateExecutionContract } from "../execution-contract/execution-contract.mjs";
import { validateCostLedger } from "../execution-contract/cost-ledger.mjs";
import { validateDecisionCalendar } from "../sizing-controller/decision-calendar.mjs";
import { isVerifiedPitManifest } from "../pit-views/index.mjs";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isCanonicalId(value) {
  return isNonEmptyString(value) && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

function buildError(field, code, message) {
  return { field, code, message };
}

// Valida el bundle §14.2. Las versiones se congelan antes del run; la
// anualidad del caso Gas Quarterly no se asume: la unidad la declara la
// obligación de apertura (§4.1: MW y MWh son magnitudes distintas).
export function buildReplayBundle(input = {}) {
  const errors = [];

  const experiment = input.experiment ?? null;
  if (!experiment || typeof experiment !== "object" || Array.isArray(experiment)
    || !isCanonicalId(experiment.experimentId) || !isVersionLike(experiment.experimentVersion)) {
    errors.push(buildError("experiment", "MISSING_EXPERIMENT_IDENTITY", "El experimento debe declarar experimentId y experimentVersion (§14.2)."));
  }

  const campaign = input.campaign ?? null;
  if (!campaign || typeof campaign !== "object" || Array.isArray(campaign)
    || !isCanonicalId(campaign.campaignId)
    || !isNonEmptyString(campaign.product)
    || !isNonEmptyString(campaign.mission)) {
    errors.push(buildError("campaign", "MISSING_CAMPAIGN_IDENTITY", "La campaña debe declarar campaignId, product y Mission (§14.2)."));
  }

  const openingContract = input.openingContract ?? null;
  if (!openingContract || typeof openingContract !== "object" || Array.isArray(openingContract)
    || !isCanonicalId(openingContract.obligationId)
    || !isFiniteNonNegativeNumber(openingContract.openingObligation)
    || typeof openingContract.deadline !== "string" || openingContract.deadline.trim().length === 0
    || !isNonEmptyString(openingContract.unit)) {
    errors.push(buildError("openingContract", "MISSING_OPENING_CONTRACT", "El opening contract debe declarar obligationId, openingObligation finita, deadline y unit (§14.2)."));
  }

  const decisionCalendar = input.decisionCalendar ?? null;
  const calendarCheck = validateDecisionCalendar(decisionCalendar);
  if (!calendarCheck.ok) {
    errors.push(buildError("decisionCalendar", "INVALID_DECISION_CALENDAR", "Calendario de decisión inválido: opportunities predeclaradas obligatorias (§14.2)."));
  }

  // Oportunidad con frontera de decisión explícita: la ejecución causal P5.6
  // necesita el decisionTime exacto; no se inventa reloj (§13.6 regla 1).
  if (calendarCheck.ok && decisionCalendar.opportunities.length > 0) {
    decisionCalendar.opportunities.forEach((opportunity, index) => {
      if (!isNonEmptyString(opportunity.decisionTimeUtc)) {
        errors.push(buildError(`decisionCalendar.opportunities[${index}]`, "MISSING_DECISION_TIME", "Cada opportunity debe declarar decisionTimeUtc; no se inventa la frontera (§14.3)."));
      }
    });
  }

  const arm = input.arm ?? null;
  if (!arm || typeof arm !== "object" || Array.isArray(arm) || typeof arm.decideAtOpportunity !== "function") {
    errors.push(buildError("arm", "MISSING_FROZEN_ARM", "El arm frozen (A0/A1) debe exponer decideAtOpportunity (§14.2)."));
  } else if (typeof arm.armVersion !== "string" || arm.armVersion.trim().length === 0) {
    errors.push(buildError("arm.armVersion", "MISSING_ARM_VERSION", "El arm debe declarar su version (§14.2)."));
  }

  const sizingConfiguration = input.sizingConfiguration ?? null;
  if (!sizingConfiguration || typeof sizingConfiguration !== "object" || Array.isArray(sizingConfiguration)
    || versionKeyOf(sizingConfiguration) === null) {
    errors.push(buildError("sizingConfiguration", "MISSING_SIZING_CONFIG", "El sizing controller frozen debe declararse con su versión/content hash (§14.2)."));
  }

  const execution = input.execution ?? null;
  if (!execution || typeof execution !== "object" || Array.isArray(execution)
    || !isVersionLike(execution.executionContractVersion)
    || !isVersionLike(execution.costLedgerVersion)) {
    errors.push(buildError("execution", "MISSING_EXECUTION_VERSIONS", "La ejecución debe declarar executionContractVersion y costLedgerVersion de P5.6 (§14.2)."));
  }
  // El contract materializado debe declarar la versión que el bundle apunta;
  // un apuntador sin contrato es doble verdad, no una indirección válida.
  const executionContract = input.executionContract ?? null;
  if (!executionContract || typeof executionContract !== "object" || Array.isArray(executionContract)) {
    errors.push(buildError("executionContract", "MISSING_EXECUTION_CONTRACT", "Falta el execution contract P5.6 apuntado por execution.executionContractVersion (§14.2)."));
  } else {
    // El schema del contrato P5.6 lo valida IMP-07, no el evaluador: un
    // contrato que no satisface su propio schema no es un required input
    // válido (§14.2), y su ausencia no se reemplaza por default.
    const contractValidation = validateExecutionContract(executionContract);
    if (!contractValidation.ok) {
      errors.push(buildError("executionContract", "INVALID_EXECUTION_CONTRACT", `El execution contract materializado no satisface el schema P5.6 de IMP-07 (${contractValidation.errors.length} errores).`));
    }
    const contractKey = versionKeyOf(executionContract);
    const contractVersionKey = versionKeyOf(executionContract.contractVersion);
    const declaredKey = execution ? versionKeyOf(execution.executionContractVersion) : null;
    if (contractKey === null && contractVersionKey === null) {
      errors.push(buildError("executionContract", "MISSING_EXECUTION_CONTRACT_IDENTITY", "El execution contract materializado no declara versión ni content hash; no es verificable contra execution.executionContractVersion (§14.2)."));
    } else if (declaredKey !== null && contractKey !== declaredKey && contractVersionKey !== declaredKey) {
      errors.push(buildError("execution.executionContractVersion", "EXECUTION_VERSION_MISMATCH", `El bundle declara versión ${declaredKey} y el contract materializado declara ${contractKey ?? contractVersionKey}; versión no es un apuntador decorativo (§14.2).`));
    }
  }

  const costLedger = input.costLedger ?? null;
  if (!costLedger || typeof costLedger !== "object" || Array.isArray(costLedger)) {
    errors.push(buildError("costLedger", "MISSING_COST_LEDGER", "Falta el cost-ledger configuration (§14.2)."));
  } else {
    // §14.4: cada coste entra exactamente una vez — el schema del ledger lo
    // valida IMP-07; una configuración vacía seguiría produciendo VALID_RUN
    // con cero costes, que es una doble verdad, no un caso cubierto.
    const ledgerValidation = validateCostLedger(costLedger);
    if (!ledgerValidation.ok) {
      errors.push(buildError("costLedger", "INVALID_COST_LEDGER", `El cost-ledger configuration no satisface el schema de IMP-07 (${ledgerValidation.errors.length} errores).`));
    }
    const declaredLedgerVersion = execution ? execution.costLedgerVersion : null;
    if (declaredLedgerVersion !== null && declaredLedgerVersion !== undefined
      && isVersionLike(costLedger.ledgerVersion) && costLedger.ledgerVersion !== declaredLedgerVersion) {
      errors.push(buildError("execution.costLedgerVersion", "COST_LEDGER_VERSION_MISMATCH", `El bundle declara costLedgerVersion ${declaredLedgerVersion} y el ledger declara ${costLedger.ledgerVersion}; la versión congelada debe ser la misma (§14.2/§14.9).`));
    }
  }

  // §14.2: Data es un required input — manifest PIT de P4 con
  // availability/version metadata. Sin él no hay replay: un manifest ausente
  // o no materializado por IMP-06 no se reemplaza por un guessed default
  // (§14.2) y `priceObservations` crudo no sustituye la metadata PIT.
  const data = input.data ?? null;
  if (!data || typeof data !== "object" || Array.isArray(data) || !isVerifiedPitManifest(data.manifest)) {
    errors.push(buildError("data", "MISSING_PIT_DATA_MANIFEST", "El input Data requiere un manifest PIT de P4 (availability/version metadata, §14.2) materializado por IMP-06; fail-closed sin él."));
  }

  const priceObservations = input.priceObservations ?? [];
  if (!Array.isArray(input.priceObservations)) {
    errors.push(buildError("priceObservations", "INVALID_PRICE_OBSERVATIONS", "priceObservations debe ser una lista (puede estar vacía: entonces los fills son no-fill)."));
  }

  const benchmark = input.benchmark ?? null;
  if (!benchmark || typeof benchmark !== "object" || Array.isArray(benchmark)
    || !isNonEmptyString(benchmark.sourceVersion)) {
    errors.push(buildError("benchmark", "MISSING_BENCHMARK_CONFIG", "El benchmark debe declarar configuration/source version; se consume únicamente para evaluación (§14.2)."));
  }

  const evaluator = input.evaluator ?? null;
  if (!evaluator || typeof evaluator !== "object" || Array.isArray(evaluator) || !isVersionLike(evaluator.evaluatorVersion)) {
    errors.push(buildError("evaluator", "MISSING_EVALUATOR_VERSION", "El evaluator debe declarar evaluatorVersion (§14.2)."));
  }

  const stochasticity = input.stochasticity ?? null;
  if (stochasticity !== null && (!stochasticity || typeof stochasticity !== "object" || Array.isArray(stochasticity) || stochasticity.approved !== true)) {
    errors.push(buildError("stochasticity", "UNAPPROVED_STOCHASTICITY", "Sólo se admite un componente estocástico explícitamente aprobado (§14.2)."));
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const bundle = {
    experiment: { experimentId: experiment.experimentId, experimentVersion: experiment.experimentVersion },
    campaign: { campaignId: campaign.campaignId, product: campaign.product, mission: campaign.mission },
    openingContract: { ...openingContract },
    decisionCalendar: {
      ...decisionCalendar,
      opportunities: decisionCalendar.opportunities.map((opportunity) => ({ ...opportunity })),
    },
    arm: { ...arm, decideAtOpportunity: arm.decideAtOpportunity },
    sizingConfiguration,
    execution: { executionContractVersion: execution.executionContractVersion, costLedgerVersion: execution.costLedgerVersion },
    executionContract,
    costLedger,
    data: { manifest: data.manifest },
    priceObservations: [...input.priceObservations],
    benchmark: { sourceVersion: benchmark.sourceVersion, status: benchmark.status ?? "UNRECONCILED" },
    evaluator,
    stochasticity: stochasticity === null ? null : { approved: true, seed: stochasticity.seed ?? null },
    status: "FROZEN_PRE_RUN",
  };
  bundle.contentHash = contentHashOf(bundle);
  return { ok: true, bundle };
}
