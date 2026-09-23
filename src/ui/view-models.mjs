// UI-01 — view models de las cuatro superficies visuales. Fuente:
// docs/product/UI-01_VISUAL_REFERENCE_BRIEF.md (Replay / Backtests / Research /
// Campaigns & Runs) sobre el Operator Interface Boundary aceptado de IMP-29
// (SPEC v1.1.1 §26.2–§26.5).
//
// Reglas del brief no negociables, materializadas aquí:
//   - no se manufacturan resultados: un dato sólo entra si bindRecord (§26.5)
//     lo ata a una versión canónica del manifest backend verificado;
//   - Recommendation, requested order, execution/fill y outcome económico son
//     objetos distintos (el timeline de IMP-29 ya los separa por lane/class);
//   - Decision-time y Evaluation son semánticamente distintos (lanes separadas
//     con sus relojes; §26.3);
//   - unknown/missing/not-yet-closed queda explícito y fail-closed.

import { canonicalValueSha256 } from "../pit-views/pit-record.mjs";
import { toUtcTimestamp } from "../pit-views/time.mjs";
import { bindRecord } from "./binding.mjs";
import { parseBackendRef, resolveBackendRecord } from "../operator-interface/backend-records.mjs";
import {
  EXPOSURE_CONDITION,
  EXPOSURE_FIELD_KEYS,
  EXPOSURE_FIELDS,
  availabilityClockOf,
  buildExposureField,
} from "../operator-interface/exposure.mjs";
import {
  EXECUTION_CLASS,
  EXECUTION_CLASSES,
  HUMAN_INTERVENTION_CLASS,
  reconcileOperatorTimeline,
} from "../operator-interface/timeline.mjs";

export const SURFACES = Object.freeze({
  REPLAY: "replay",
  BACKTESTS: "backtests",
  RESEARCH: "research",
  CAMPAIGNS: "campaigns",
});

export const SURFACES_LIST = Object.freeze(Object.values(SURFACES));

// Pila de estrategias esperada por el Research / Strategy Lab del brief.
// Es la dirección de producto del owner (no de la SPEC): se usa sólo para
// declarar "esperado pero aún no disponible" y nunca como dato.
export const EXPECTED_STRATEGY_STACK = Object.freeze(["S1", "S2", "S3", "S4", "S5", "Z"]);

function unavailableItem(label, reason) {
  return { status: "UNAVAILABLE", label, reason };
}

function boundItem(label, bound, extra = {}) {
  return { status: "BOUND", label, value: bound.value, provenance: { recordKey: bound.recordKey, revisionId: bound.revisionId, valueSha256: bound.valueSha256 }, ...extra };
}

function unexpectedTimeline(errors) {
  return { ok: false, errors };
}

// Backtests / Economic Comparison. `rows` son candidatos de datos del backend:
// { label, arm ("A0"|"A1"|null), measure ("B"|"H"|"V"|"ΔV"|null), recordKey,
// revisionId, value }. Cada uno se somete a binding contra el manifest
// verificado; los que fallan quedan explícitos como UNAVAILABLE con razón.
export function buildBacktestsViewModel({ backendIndex = null, rows = [] } = {}) {
  if (!Array.isArray(rows)) {
    return unexpectedTimeline([{ field: "rows", code: "INVALID_ROWS", message: "rows debe ser una lista." }]);
  }
  const items = rows.map((row) => {
    if (typeof row?.label !== "string" || row.label.trim().length === 0) {
      return unavailableItem("(fila sin etiqueta)", "fila de comparación sin etiqueta; no se rinde valor anónimo");
    }
    const bound = bindRecord(backendIndex, row);
    if (!bound.ok) {
      return unavailableItem(row.label, bound.reason);
    }
    // UI01-05c (review de cambio 2026-09-23): las etiquetas arm/measure que el
    // render exhibe como factuales (data-arm/data-measure) sólo se presentan
    // si el registro canónico para el que se ató el hash las declara a su vez;
    // el boundary no expone un catálogo de brazos/comparadores aparte, así que
    // una Etiqueta sin respaldo en el registro resuelto no es factual (§26.5).
    const resolved = resolveBackendRecord(backendIndex, row.recordKey, row.revisionId);
    const recordValue = resolved?.value;
    const recordArm = recordValue !== null && typeof recordValue === "object" ? recordValue.arm ?? null : null;
    const recordMeasure = recordValue !== null && typeof recordValue === "object" ? recordValue.measure ?? null : null;
    const declaredArm = row.arm ?? null;
    const declaredMeasure = row.measure ?? null;
    if (declaredArm !== null || declaredMeasure !== null) {
      const armBacked = typeof declaredArm === "string" && declaredArm === recordArm;
      const measureBacked = typeof declaredMeasure === "string" && declaredMeasure === recordMeasure;
      if (!armBacked || !measureBacked) {
        return unavailableItem(row.label, `el arm/measure declarado ("${declaredArm ?? "ausente"}"/"${declaredMeasure ?? "ausente"}") no coincide con el que expone el registro canónico del manifest verificado; una etiqueta sin respaldo del boundary no se rinde como factual (§26.5)`);
      }
    }
    return boundItem(row.label, bound.bound, { arm: declaredArm, measure: declaredMeasure });
  });
  return {
    ok: true,
    surface: SURFACES.BACKTESTS,
    rows: items,
    hasAnyBoundData: items.some((item) => item.status === "BOUND"),
    // Los comparadores canónicos del brief que este boundary aún no expose:
    // honestamente declarados, no simulados.
    pendingComparisons: [
      { label: "B / H / V / ΔV", status: "UNAVAILABLE", reason: "sin runs P5/P6 aceptados en el backend; IMP-05/IMP-07/IMP-12/IMP-16 pendientes" },
      { label: "Efectos emparejados por campaña", status: "UNAVAILABLE", reason: "sin pares A0/A1 registrados en el backend" },
      { label: "Distribuciones", status: "UNAVAILABLE", reason: "sin distribución de resultados canónica; no se fabrica (§26.5)" },
      { label: "Contexto de integridad/método", status: "UNAVAILABLE", reason: "receipts de run e integridad OOS aún no producidos (IMP-14/IMP-16)" },
    ],
  };
}

// Research / Strategy Lab. `strategies` son candidatos { strategyId,
// recordKey, revisionId, value } con value={ phase, ... } del registry de
// admission. Lo esperado por la pila S1–S5/Z que no entra se declara.
export function buildResearchViewModel({ backendIndex = null, records = [] } = {}) {
  if (!Array.isArray(records)) {
    return unexpectedTimeline([{ field: "records", code: "INVALID_RECORDS", message: "records debe ser una lista." }]);
  }
  const byId = new Map();
  for (const record of records) {
    if (typeof record?.strategyId !== "string" || record.strategyId.trim().length === 0) {
      continue;
    }
    if (byId.has(record.strategyId)) {
      return unexpectedTimeline([{ field: "records", code: "DUPLICATE_STRATEGY_ID", message: `"${record.strategyId}" declarado dos veces; dos verdades sobre lo mismo (§26.5).` }]);
    }
    byId.set(record.strategyId, record);
  }
  const strategies = EXPECTED_STRATEGY_STACK.map((strategyId) => {
    const candidate = byId.get(strategyId);
    if (candidate === undefined) {
      return {
        strategyId,
        status: "UNAVAILABLE",
        reason: "sin registro canónico del backend en este scope; no se presume hipótesis ni readiness",
      };
    }
    const bound = bindRecord(backendIndex, candidate);
    if (!bound.ok) {
      return { strategyId, status: "UNAVAILABLE", reason: bound.reason };
    }
    return {
      strategyId,
      status: "BOUND",
      readiness: bound.bound.value,
      provenance: { recordKey: bound.bound.recordKey, revisionId: bound.bound.revisionId, valueSha256: bound.bound.valueSha256 },
    };
  });
  const unexpectedIds = [...byId.keys()].filter((id) => !EXPECTED_STRATEGY_STACK.includes(id));
  return {
    ok: true,
    surface: SURFACES.RESEARCH,
    strategies,
    unexpectedStrategyIds: unexpectedIds,
    hasAnyBoundData: strategies.some((item) => item.status === "BOUND"),
    pendingSections: [
      { label: "Experiment / version lineage", status: "UNAVAILABLE", reason: "sin lineage canónico proveniente del backend" },
      { label: "Evidence / receipts", status: "UNAVAILABLE", reason: "sin run receipts aceptados (IMP-14 pendiente)" },
    ],
  };
}

// Campaigns & Runs. `campaigns` son candidatos { campaignId, recordKey,
// revisionId, value } (ficha de campaña canónica) y `runs` candidatos
// { runId, record: {recordKey, revisionId, value} } con drilldowns declarados
// { replay: "<recordKey>@<revisionId>", backtests: ..., research: ... }.
export function buildCampaignsViewModel({ backendIndex = null, campaigns = [], runs = [] } = {}) {
  if (!Array.isArray(campaigns) || !Array.isArray(runs)) {
    return unexpectedTimeline([{ field: "campaigns", code: "INVALID_INPUT", message: "campaigns y runs deben ser listas." }]);
  }
  const seenCampaigns = new Set();
  for (const campaign of campaigns) {
    if (campaign?.campaignId === undefined || seenCampaigns.has(campaign.campaignId)) {
      return unexpectedTimeline([{ field: "campaigns", code: "DUPLICATE_CAMPAIGN_ID", message: "cada campaña se declara una vez (§26.5)." }]);
    }
    seenCampaigns.add(campaign.campaignId);
  }
  const seenRuns = new Set();
  for (const run of runs) {
    if (run?.runId === undefined || seenRuns.has(run.runId)) {
      return unexpectedTimeline([{ field: "runs", code: "DUPLICATE_RUN_ID", message: "cada run se declara una vez (§26.5)." }]);
    }
    seenRuns.add(run.runId);
  }
  const campaignItems = campaigns
    .map((campaign) => {
      if (typeof campaign?.campaignId !== "string" || campaign.campaignId.trim().length === 0) {
        return unavailableItem("(campaña sin id)", "campaña sin identidad; no se rinde");
      }
      const bound = bindRecord(backendIndex, campaign);
      if (!bound.ok) {
        return unavailableItem(campaign.campaignId, bound.reason);
      }
      return boundItem(campaign.campaignId, bound.bound, { kind: "CAMPAIGN" });
    });
  const runItems = runs
    .map((run) => {
      if (typeof run?.runId !== "string" || run.runId.trim().length === 0) {
        return unavailableItem("(run sin id)", "run sin identidad; no se rinde");
      }
      const record = run.record ?? run;
      const bound = bindRecord(backendIndex, record);
      if (!bound.ok) {
        return unavailableItem(run.runId, bound.reason);
      }
      const drilldowns = [`#${SURFACES.REPLAY}`, `#${SURFACES.BACKTESTS}`, `#${SURFACES.RESEARCH}`].map((href) => ({ href }));
      return boundItem(run.runId, bound.bound, { kind: "RUN", drilldowns });
    });
  return {
    ok: true,
    surface: SURFACES.CAMPAIGNS,
    campaigns: campaignItems,
    runs: runItems,
    hasAnyBoundData: [...campaignItems, ...runItems].some((item) => item.status === "BOUND"),
    // Drilldowns: navegación declarativa a superficies sí expuestas por este
    // boundary; el destino aplica sus propios fail-closed, no se copian datos.
    // Exigen que el run esté BOUND: no se ofrece el handoff sobre datos que el
    // backend no respalda.
    drilldownTargets: Object.freeze(["replay", "backtests", "research"]),
    pendingRunReceipts: [
      { label: "Receipts de run", status: "UNAVAILABLE", reason: "sin receipts de run aceptados en el backend (IMP-14/IMP-16 pendientes); no se fabrican" },
    ],
  };
}

// Replay / Decision Inspector. Sólo acepta salidas ya validadas del boundary:
// `timeline` (buildOperatorTimeline ok:true) y `exposure` (buildExposure
// ok:true) — y las verifica: la forma `{ok:true}` por sí sola no acredita
// nada (OI79-UI01-01, review 2026-09-23). El llamador aporta `backendIndex`
// (backendIndexFromManifest del manifest backend verificado) y cada pieza
// factual se ata a él con los mecanismos del propio boundary:
//   - reconcileOperatorTimeline re-ejecutado tal cual contra el timeline;
//   - cada punto de decisión/evaluación se concilia por key/revisionId y
//     hash canónico del valor registrado (bindRecord, §26.5);
//   - la procedencia declarada por cada campo de exposición resuelve al
//     registro y hash del mismo manifest;
//   - el vínculo a recomendación de cada actuación/intervención resuelve a
//     una versión del decision view verificada.
// Un timeline o exposición armados a mano quedan entonces explícitos como
// error: valor no coincide con el manifest = dato no factual (§26.5).
export function buildReplayViewModel({ timeline = null, exposure = null, backendIndex = null } = {}) {
  if (timeline === null || timeline?.ok !== true || timeline?.timeline === undefined) {
    return unexpectedTimeline([{ field: "timeline", code: "TIMELINE_NOT_VALIDATED", message: "Replay exige el timeline validado de buildOperatorTimeline; sin él no se renderiza (§26.3)." }]);
  }
  if (exposure === null || exposure?.ok !== true || exposure?.exposure === undefined) {
    return unexpectedTimeline([{ field: "exposure", code: "EXPOSURE_NOT_VALIDATED", message: "Replay exige la exposición validada de buildExposure; sin ella no se renderiza (§26.2)." }]);
  }
  // UI01-04a (review 2026-09-23): una exposición sin fields no es una
  // exposición renderizable; se degrada a ERROR, nunca a una excepción.
  if (!Array.isArray(exposure.exposure.fields)) {
    return unexpectedTimeline([{ field: "exposure.fields", code: "EXPOSURE_MALFORMED", message: "La exposición declarada no tiene la lista de campos del boundary (§26.2)." }]);
  }
  if (backendIndex === null || backendIndex.byIdentity === undefined) {
    return unexpectedTimeline([{ field: "backendIndex", code: "BACKEND_NOT_VERIFIED", message: "Replay sólo muestra datos del manifest backend verificado; sin él el timeline no se puede atar a un dato factual (§26.5)." }]);
  }
  const reconciliation = reconcileOperatorTimeline(timeline.timeline);
  if (!reconciliation.ok) {
    return unexpectedTimeline([...reconciliation.errors]);
  }
  const t = timeline.timeline;
  if (!Array.isArray(t?.decision?.points) || !Array.isArray(t?.evaluation?.points)
    || !Array.isArray(t?.executions) || !Array.isArray(t?.interventions)) {
    return unexpectedTimeline([{ field: "(timeline)", code: "TIMELINE_SHAPE_UNRECOGNIZED", message: "El timeline no declara las lanes del boundary (§26.3)." }]);
  }
  const errors = [];
  // UI01-05a (review de cambio 2026-09-23): la exposición sólo puede renderizar
  // facts "conocidos al decidir" si su boundary es exactamente el decision
  // boundary del timeline; una exposición proyectada a un boundary posterior
  // convierte un outcome no cerrado en AVAILABLE y la página de Replay rinde
  // un valor futuro como factual (§26.3/§25.1 IMP-29).
  const exposureBoundaryUtc = toUtcTimestamp(exposure.exposure.boundaryUtc);
  const decisionBoundaryUtc = toUtcTimestamp(t.decision.boundary);
  if (!exposureBoundaryUtc.ok || !decisionBoundaryUtc.ok || exposureBoundaryUtc.utc !== decisionBoundaryUtc.utc) {
    errors.push({ field: "exposure.exposure.boundaryUtc", code: "EXPOSURE_BOUNDARY_NOT_ALIGNED", message: "la exposición declarada no usa el mismo boundary de decisión del timeline; la página de Replay no puede presentar como conocido al decidir lo que cerró después (§26.3/§25.1)" });
  }
  const decisionBoundaryMs = decisionBoundaryUtc.ok ? Date.parse(decisionBoundaryUtc.utc) : Number.NaN;
  const bindPoint = (point, landmark, expectedLane, expectedViewScope, expectedClockOf, expectedClockKind) => {
    // UI01-05b (review de cambio 2026-09-23): la lane exhibida por el render
    // (lane-<lane>) se deriva de la lane conciliada; una etiqueta distinta del
    // llamador no renombra la semántica temporal (§26.3).
    if (point?.lane !== expectedLane) {
      errors.push({ field: `${landmark}.${point?.key ?? "(sin key)"}`, code: "POINT_LANE_MISMATCH", message: `el punto declara lane "${point?.lane ?? "ausente"}" y concilia en la lane ${expectedLane}; la semántica temporal la fija el boundary (§26.3)` });
      return;
    }
    const bound = bindRecord(backendIndex, { recordKey: point.key, revisionId: point.revisionId, value: point.value });
    if (!bound.ok) {
      errors.push({ field: `${landmark}.${point.key}`, code: "POINT_NOT_IN_BACKEND", message: `el punto no se concilia con el manifest backend verificado: ${bound.reason} (§26.5); un valor no registrado no es factual` });
      return;
    }
    // UI01-01c (review 2026-09-23): la lane decision sólo puede contener keys
    // de la decision view del manifest (§6.1/§14.3); un key de evaluation
    // presentado como punto de decisión es información futura al decidir. La
    // lane evaluation es exploratoria y puede llevar keys de ambos scopes.
    const record = resolveBackendRecord(backendIndex, point.key, point.revisionId);
    if (expectedViewScope !== null && record?.viewScope !== expectedViewScope) {
      errors.push({ field: `${landmark}.${point.key}`, code: "POINT_SCOPE_MISMATCH", message: `el punto "${point.key}" proviene de la vista "${record?.viewScope ?? "sin scope"}" y no encuadra en la lane ${expectedViewScope} del replay (§6.1/§26.3)` });
      return;
    }
    if (record !== null) {
      // UI01-01c-r (review 2026-09-23): el reloj mostrado no es del llamador;
      // se deriva del registro verificado (decision: consumo demostrado,
      // evaluation: reloj de contenido; §6.1/§26.3).
      const canonicalClock = expectedClockOf(record);
      if (typeof canonicalClock !== "string" || point.clock !== canonicalClock) {
        errors.push({ field: `${landmark}.${point.key}`, code: "POINT_CLOCK_NOT_FROM_RECORD", message: `el reloj del punto "${point.key}" debe derivarse del registro verificado del manifest; un clock declarado no informa el boundary (§26.3/§26.5)` });
      }
      // UI01-05b: el tipo de reloj exhibido (data-clock-kind) también se deriva
      // de la lane canónica; decision consume (policy-consumable), evaluation
      // recibe contenido por su reloj efectivo (evaluation-effective). Un
      // clockKind declarado que contradiga la lane no se muestra (§26.3).
      if (point.clockKind !== expectedClockKind) {
        errors.push({ field: `${landmark}.${point.key}`, code: "POINT_CLOCK_KIND_NOT_DERIVED", message: `el tipo de reloj del punto "${point.key}" debe derivarse de la lane canónica (${expectedClockKind}); un clockKind declarado por el llamador no informa el boundary (§26.3/§26.5)` });
      }
    }
  };
  const decisionPoints = t.decision.points.map((point) => bindPoint(point, "decision.points", "decision", "decision", (record) => record.consumableFromUtc, "policy-consumable"));
  const evaluationPoints = t.evaluation.points.map((point) => bindPoint(point, "evaluation.points", "evaluation", null, (record) => record.effectiveAtUtc, "evaluation-effective"));
  const bindProvenance = (field, landmark) => {
    const provenance = field?.provenance;
    if (provenance === undefined || provenance === null) {
      // UI01-01b (review 2026-09-23): un campo con valor y sin procedencia
      // declarada no es mostrable; el valor no remite a ninguna versión.
      if (field?.value !== undefined) {
        errors.push({ field: landmark, code: "EXPOSURE_VALUE_WITHOUT_PROVENANCE", message: `el campo "${field?.specLabel ?? landmark}" ofrece un valor sin procedencia; sin registro canónico no es factual (§26.5)` });
      }
      return;
    }
    const resolved = resolveBackendRecord(backendIndex, provenance.recordKey, provenance.revisionId);
    if (resolved === null) {
      errors.push({ field: landmark, code: "EXPOSURE_PROVENANCE_NOT_IN_BACKEND", message: `la procedencia "${provenance.recordKey}"/"${provenance.revisionId}" no existe en el manifest verificado del mismo backend (§26.5)` });
      return;
    }
    // UI01-08 (review de cambio 2026-09-23): las condiciones value-less con
    // procedencia (PROXY/UNCERTAIN/STALE/MISSING) son una salida legítima del
    // boundary (validateProvenanceWithoutValue, exposure.mjs) y llegan con
    // valueSha256:null: la procedencia identifica la versión observada sin
    // atar un valor. Comparar hashes sólo aplica cuando la procedencia
    // declara uno; cuando hay valor, el bloque siguiente re-hashea el valor
    // expuesto contra el propio registro (§26.5).
    if (provenance.valueSha256 !== null && resolved.valueSha256 !== provenance.valueSha256) {
      errors.push({ field: landmark, code: "EXPOSURE_PROVENANCE_MISMATCH", message: `el hash de la procedencia no coincide con el contenido registrado por "${provenance.recordKey}"/"${provenance.revisionId}" (§26.5)` });
      return;
    }
    // UI01-01b: el valueSha256 declarado puede coincidir por accidente; el
    // valor expuesto se hashea de nuevo y debe ser el del propio registro.
    if (field.value !== undefined && field.value !== null) {
      const valueHash = canonicalValueSha256(field.value);
      if (!valueHash.ok) {
        errors.push({ field: landmark, code: "EXPOSURE_VALUE_NOT_CANONICAL", message: `el valor del campo "${field?.specLabel ?? landmark}" no es dato canónico serializable (§26.5)` });
      } else if (valueHash.sha256 !== resolved.valueSha256) {
        errors.push({ field: landmark, code: "EXPOSURE_VALUE_HASH_MISMATCH", message: `el valor expuesto por "${field?.specLabel ?? landmark}" no es el registrado por "${provenance.recordKey}"/"${provenance.revisionId}"; no se calcula otra verdad económica (§26.5)` });
      }
    }
  };
  for (const field of exposure.exposure.fields ?? []) {
    const landmark = `exposure.fields.${field?.field ?? field?.specLabel}`;
    bindProvenance(field, landmark);
    // UI01-01d (review 2026-09-23): una reputación de sección/sourceKind/
    // scope declarada por el llamador no se presenta; las comprobaciones del
    // propio boundary (buildExposureField) se re-ejecutan contra el manifest
    // verificado (§26.2/§26.3/§26.5).
    const rebuilt = buildExposureField(field, { backendIndex });
    if (!rebuilt.ok) {
      for (const rebuiltError of rebuilt.errors) {
        errors.push({ field: `${landmark}.${rebuiltError.field}`, code: rebuiltError.code, message: rebuiltError.message });
      }
      continue;
    }
    const definition = EXPOSURE_FIELDS.find((canonical) => canonical.key === field.field);
    if (definition !== undefined && (field.specLabel !== definition.specLabel || field.section !== definition.section)) {
      errors.push({ field: landmark, code: "EXPOSURE_SECTION_MISMATCH", message: `la sección "${field.field}" no es su definición canónica de §26.2; la etiqueta del llamador no se presenta como factual` });
    }
    // UI01-06a (review de cambio 2026-09-23): buildExposureField no conoce el
    // boundary, así que un AVAILABLE forjado (o proyectado a un boundary
    // posterior y re-declarado al decision boundary) pasaba. La proyección del
    // boundary se re-aplica con el mismo reloj de disponibilidad del boundary
    // (availabilityClockOf, exposure.mjs): una versión canónica posterior al
    // boundary — o sin disponibilidad demostrada — no se rinde con valor como
    // factual al decidir (§26.3/§25.1 IMP-29).
    if (field.value !== undefined && field.value !== null
      && field.provenance !== undefined && field.provenance !== null) {
      const projectedRecord = resolveBackendRecord(backendIndex, field.provenance.recordKey, field.provenance.revisionId);
      const availabilityUtc = availabilityClockOf(projectedRecord);
      if (availabilityUtc === null || Number.isNaN(decisionBoundaryMs) || Date.parse(availabilityUtc) > decisionBoundaryMs) {
        errors.push({ field: landmark, code: "EXPOSURE_NOT_PROJECTED_TO_BOUNDARY", message: `la versión canónica referida (disponibilidad ${availabilityUtc ?? "sin demostrar"}) es posterior o no demostrada al boundary de decisión; buildExposure habría degradado esta sección a NOT_YET_CLOSED y no se rinde con valor como factual (§26.3/§25.1)` });
      }
    }
  }
  // UI01-04b (review de cambio 2026-09-23): la completitud estructural del
  // boundary (§26.2: las 13 secciones presentes, la ausencia declarada)
  // no se toma del flag declarado por el llamador; se constata contra el
  // conjunto canónico EXPOSURE_FIELD_KEYS. Una parcial omite 12 secciones
  // sin declararlas y no se rinde como completa.
  const declaredKeys = [];
  for (const field of exposure.exposure.fields) {
    if (typeof field?.field === "string") {
      declaredKeys.push(field.field);
    }
  }
  const missingSections = EXPOSURE_FIELD_KEYS.filter((canonicalKey) => !declaredKeys.includes(canonicalKey));
  if (missingSections.length > 0) {
    errors.push({ field: "exposure.fields", code: "EXPOSURE_NOT_STRUCTURALLY_COMPLETE", message: `la exposición declarada omite las secciones canónicas de §26.2 (${missingSections.join(", ")}); una parcial ocurre sin declarar lo ausente y no se rinde como completa (§26.2)` });
  }
  const duplicateSections = declaredKeys.filter((key, index) => declaredKeys.indexOf(key) !== index);
  if (duplicateSections.length > 0) {
    errors.push({ field: "exposure.fields", code: "EXPOSURE_SECTION_DUPLICATE", message: `la exposición declara "${[...new Set(duplicateSections)].join(", ")}" más de una vez; dos verdades sobre lo mismo (§26.5)` });
  }
  // UI01-01a (review 2026-09-23): una actuación REAL no se rinde con una
  // autorización "declarada"; su origen (authority + receipt) se re-ata al
  // manifest verificado, igual que el resto de los datos factuales (§26.5/§16–18).
  const bindAuthorizationOrigin = (lane, event) => {
    if (event?.class !== EXECUTION_CLASS.REAL) {
      return;
    }
    const authorization = event?.authorization;
    const origin = authorization?.origin;
    if (origin === undefined || origin === null) {
      errors.push({ field: `${lane}.${event?.eventId ?? "(sin id)"}.authorization.origin`, code: "REAL_AUTHORITY_ORIGIN_MISSING", message: "el acto REAL declara autorización sin origen resuelto; la autoridad y el receipt deben re-atar al manifest backend verificado (§26.5/§16–18)" });
      return;
    }
    const originAuthority = resolveBackendRecord(backendIndex, origin.authority?.recordKey, origin.authority?.revisionId);
    if (originAuthority === null) {
      errors.push({ field: `${lane}.${event?.eventId ?? "(sin id)"}.authorization.origin.authority`, code: "REAL_AUTHORITY_NOT_IN_BACKEND", message: "la autoridad del acto REAL no resuelve a una versión del manifest backend verificado; un acto REAL exige autoridad aplicable resuelta (§26.5/§16–18)" });
    } else {
      // UI01-01a-r (review 2026-09-23): además del origen, los refs exhibidos
      // por el render (authorityRef / receiptRef / receiptSha256) se re-atan al
      // mismo registro resuelto; un ref declarado distinto del resuelto no es
      // factual (§26.5).
      const authorityParsed = parseBackendRef(authorization.authorityRef);
      const authorityResolved = authorityParsed === null
        ? null
        : resolveBackendRecord(backendIndex, authorityParsed.recordKey, authorityParsed.revisionId);
      if (authorityResolved === null || authorityResolved !== originAuthority) {
        errors.push({ field: `${lane}.${event?.eventId ?? "(sin id)"}.authorization.authorityRef`, code: "REAL_AUTHORITY_REF_NOT_BOUND", message: "el authorityRef exhibido no remite a la autoridad resuelta en el manifest backend verificado; no se dibuja como factual (§26.5)" });
      }
    }
    const receipt = authorization.receipt;
    const originReceipt = resolveBackendRecord(backendIndex, origin.receipt?.recordKey, origin.receipt?.revisionId);
    if (originReceipt === null) {
      errors.push({ field: `${lane}.${event?.eventId ?? "(sin id)"}.authorization.origin.receipt`, code: "REAL_RECEIPT_NOT_IN_BACKEND", message: "el receipt del acto REAL no resuelve a una versión del manifest backend verificado; no se declara un receipt que el backend no respalda (§26.5/§25.2)" });
    } else {
      const receiptParsed = parseBackendRef(receipt?.receiptRef);
      const receiptResolved = receiptParsed === null
        ? null
        : resolveBackendRecord(backendIndex, receiptParsed.recordKey, receiptParsed.revisionId);
      if (receiptResolved === null) {
        errors.push({ field: `${lane}.${event?.eventId ?? "(sin id)"}.authorization.origin.receipt`, code: "REAL_RECEIPT_NOT_IN_BACKEND", message: "el receipt del acto REAL no resuelve a una versión del manifest backend verificado; no se declara un receipt que el backend no respalda (§26.5/§25.2)" });
      } else if (receiptResolved !== originReceipt) {
        errors.push({ field: `${lane}.${event?.eventId ?? "(sin id)"}.authorization.receipt.receiptRef`, code: "REAL_RECEIPT_REF_NOT_BOUND", message: "el receiptRef exhibido no remite al receipt resuelto en el manifest backend verificado; no se dibuja como factual (§26.5)" });
      } else if (typeof receipt?.receiptSha256 !== "string" || receiptResolved.valueSha256 !== receipt.receiptSha256.toLowerCase()) {
        errors.push({ field: `${lane}.${event?.eventId ?? "(sin id)"}.authorization.receipt.receiptSha256`, code: "REAL_RECEIPT_MISMATCH", message: "el hash del receipt exhibido no es el contenido registrado por su versión canónica; no se declara un receipt que el backend no respalda (§26.5/§25.2)" });
      }
    }
  };
  for (const [lane, events] of [["executions", t.executions], ["interventions", t.interventions]]) {
    for (const event of events) {
      // UI01-01e (review de cambio 2026-09-23): reconcileOperatorTimeline no
      // re-valida la identidad ni la clase de las actuaciones; aquí se hace
      // equivalente a validateExecution del boundary (§26.3): un class fuera
      // de las clases canónicas o un eventId vacío no se rinde como evento.
      if (typeof event?.eventId !== "string" || event.eventId.trim().length === 0) {
        errors.push({ field: `${lane}.(sin id).eventId`, code: "MISSING_EVENT_ID", message: "la actuación no declara su identidad; un evento sin id no se muestra (§26.3/§26.5)" });
      }
      if (lane === "executions" && !EXECUTION_CLASSES.includes(event?.class)) {
        errors.push({ field: `${lane}.${event?.eventId ?? "(sin id)"}.class`, code: "UNKNOWN_EXECUTION_CLASS", message: `class debe ser ${EXECUTION_CLASSES.join(", ")}: un fill hipotético no se muestra como Real ni una clase desconocida se muestra como factual (§26.3)` });
      }
      // UI01-07 (review de cambio 2026-09-23): el reloj exhibido del evento
      // (render.mjs .event-clock) se re-valida como timestamp UTC canónico del
      // boundary (§6.1): sin zona o no canónico no se muestra como factual.
      // reconcileOperatorTimeline sólo compara cuando Date.parse no da NaN y
      // silencia el caso inválido, así que aquí se constata la forma canónica.
      const eventClock = toUtcTimestamp(event?.clock);
      if (!eventClock.ok || eventClock.utc !== event.clock) {
        errors.push({ field: `${lane}.${event?.eventId ?? "(sin id)"}.clock`, code: "EVENT_CLOCK_NOT_CANONICAL", message: "el reloj del evento debe ser un timestamp UTC canónico con zona explícita y forma normalizada; un clock no canónico no se muestra (§6.1/§26.3)" });
      }
      // UI01-01a-r2 (review de cambio 2026-09-23): el ref exhibido por el
      // render (relatedRecommendationRef) se ata al vínculo canónico
      // resuelto (relatedCanonicalRef); un ref mostrado que no es el que el
      // boundary resolvió no es factual (§26.5/§26.3).
      const canonical = event?.relatedCanonicalRef;
      const displayedRef = event?.relatedRecommendationRef;
      const displayedParsed = parseBackendRef(displayedRef);
      if (displayedParsed === null
        || displayedParsed.recordKey !== canonical?.recordKey
        || displayedParsed.revisionId !== canonical?.revisionId) {
        errors.push({ field: `${lane}.${event?.eventId ?? "(sin id)"}.relatedRecommendationRef`, code: "RECOMMENDATION_REF_NOT_BOUND", message: "el ref de recomendación exhibido no es el que resuelve el vínculo canónico verificado del boundary; no se dibuja como factual (§26.5/§26.3)" });
      }
      const ref = event?.relatedCanonicalRef;
      const refIsUsable = ref !== undefined && ref !== null;
      const resolved = refIsUsable
        ? resolveBackendRecord(backendIndex, ref.recordKey, ref.revisionId)
        : null;
      if (resolved === null) {
        errors.push({ field: `${lane}.${event?.eventId ?? "(sin id)"}.relatedCanonicalRef`, code: "RECOMMENDATION_LINK_NOT_IN_BACKEND", message: "el vínculo a la recomendación no resuelve a una versión del decision view del manifest verificado (§26.3/§26.5)" });
      } else if (refIsUsable && resolved.viewScope !== "decision") {
        errors.push({ field: `${lane}.${event?.eventId ?? "(sin id)"}.relatedCanonicalRef`, code: "RECOMMENDATION_LINK_NOT_DECISION_SCOPE", message: "la actuación se vincula a la recomendación conocida al decidir; la referee no es una versión del decision view (§26.3)" });
      }
      bindAuthorizationOrigin(lane, event);
    }
  }
  if (errors.length > 0) {
    return unexpectedTimeline(errors);
  }
  const laneClass = (event) => {
    if (event.lane === "intervention") {
      return HUMAN_INTERVENTION_CLASS;
    }
    return event.class;
  };
  const imaginary = (event) => event.class === EXECUTION_CLASS.HYPOTHETICAL;
  const realityCheck = (event) => event.class === EXECUTION_CLASS.REAL;
  return {
    ok: true,
    surface: SURFACES.REPLAY,
    workingMode: t.workingMode,
    decision: { boundary: t.decision.boundary, points: t.decision.points, suppressed: t.decision.suppressed, unavailable: t.decision.unavailable },
    evaluation: { asOf: t.evaluation.asOf, points: t.evaluation.points, pendingRevisions: t.evaluation.pendingRevisions, unavailable: t.evaluation.unavailable },
    executions: t.executions.map((event) => ({ ...event, isHypothetical: imaginary(event), isReal: realityCheck(event) })),
    interventions: t.interventions,
    exposure: exposure.exposure,
  };
}
