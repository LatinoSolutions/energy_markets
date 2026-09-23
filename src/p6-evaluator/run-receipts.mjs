// Run receipts y reproducibilidad (IMP-14). Fuente: SPEC v1.1.1 §14.9
// (P6.9: cada receipt contiene Experiment ID/version, Campaign, arm version,
// input dataset manifest y content hashes, metadata PIT de fronteras,
// sizing-controller version, execution-contract/cost-ledger versions,
// benchmark/evaluation version, evaluator version, seed cuando aplique,
// timestamp/status, warnings, missing-data events e invalidity reasons; mismo
// frozen bundle + misma config determinista → mismos ledgers y outputs; cambiar
// datos/evaluator/config crea receipt nuevo y los anteriores se preservan),
// §14.10 (P6.10: output bundle completo con ledgers, coverage, statuses
// separados y receipt de provenance) y §25.2 fila IMP-14 ("No borrar runs
// previos; no seed hunting").
//
// Esta capa materializa y preserva lo que el replay P6 produjo realmente
// (runP6Replay, IMP-12); no recalcula ledgers ni repara el frozen design
// (§14.1). El run timestamp es metadata del run, no del contenido: la
// reproducibilidad se juzga por el contenido del bundle replicado, no por
// relojes (§14.9).

import { contentHashOf } from "../execution-contract/execution-contract.mjs";

// Identidad content-addressed del receipt (§14.9 IDs/versiones): hash del
// contenido del receipt sin el run timestamp (metadata del run) ni el propio
// receiptId (evita la auto-referencia). Mismo bundle/config → mismo receiptId;
// corrección (datos/documento/config) → receiptId distinto.
export function receiptIdentityOf(enrichedReceipt) {
  if (!enrichedReceipt || typeof enrichedReceipt !== "object" || Array.isArray(enrichedReceipt)) {
    return null;
  }
  const receiptForIdentity = { ...enrichedReceipt };
  delete receiptForIdentity.runTimestampUtc;
  delete receiptForIdentity.receiptId;
  return contentHashOf(receiptForIdentity);
}

// Digests por componente del output bundle (§14.10): la comparación de
// reproducibilidad se hace sobre contenido, no sobre etiquetas.
export function outputBundleDigestsOf(outputBundle) {
  return {
    decisionLedger: contentHashOf(outputBundle.ledgers.decision),
    executionLedger: contentHashOf(outputBundle.ledgers.execution),
    coverageLedger: contentHashOf(outputBundle.ledgers.coverage),
    terminalCoverage: contentHashOf(outputBundle.terminalCoverage),
    status: contentHashOf(outputBundle.status),
  };
}

// P6.9: materializa el receipt completo del run. Toma el outcome real de
// runP6Replay más el frozen bundle congelado por buildReplayBundle (única
// fuente de los hashes de inputs; sin bundle no hay hashes que declarar) y
// añade lo que el receipt del replay no firma: content hash del manifest de
// datos, metadata de fronteras PIT recorridas, digests económicos de los
// ledgers y la identidad del receipt.
export function materializeRunReceipt({ bundle, replayOutcome }) {
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle) || bundle.status !== "FROZEN_PRE_RUN") {
    return { ok: false, code: "MISSING_FROZEN_BUNDLE", message: "Los content hashes §14.9 provienen del frozen bundle de buildReplayBundle; sin él no se fabrica un receipt." };
  }
  if (!replayOutcome || typeof replayOutcome !== "object" || Array.isArray(replayOutcome) || replayOutcome.ok !== true) {
    return { ok: false, code: "MISSING_REPLAY_OUTCOME", message: "El receipt se materializa a partir del outcome real de runP6Replay; no se fabrica un receipt sin replay (§14.1)." };
  }
  const replay = replayOutcome.replay;
  // §14.9/§14.10: la forma mínima del outcome se valida antes de tocarla; sin
  // ledgers/coverage/status/receipt no hay nada que materializar (y evita
  // fabricar un receipt desde un objeto a medias).
  if (!replay || typeof replay !== "object" || Array.isArray(replay)
    || !replay.receipt || typeof replay.receipt !== "object" || Array.isArray(replay.receipt)
    || !replay.ledgers || typeof replay.ledgers !== "object" || Array.isArray(replay.ledgers)
    || !Array.isArray(replay.ledgers.decision)
    || !Array.isArray(replay.ledgers.execution)
    || !Array.isArray(replay.ledgers.coverage)
    || !replay.terminalCoverage || typeof replay.terminalCoverage !== "object" || Array.isArray(replay.terminalCoverage)
    || !replay.status || typeof replay.status !== "object" || Array.isArray(replay.status)) {
    return { ok: false, code: "MALFORMED_REPLAY_OUTCOME", message: "El outcome de runP6Replay debe exponer replay.receipt, ledgers (decision/execution/coverage), terminalCoverage y status; sin esa forma no se materializa un receipt (§14.9/§14.10)." };
  }
  const baseReceipt = replay.receipt;

  // §14.9: el receipt declara los inputs/versiones que produjeron los ledgers.
  // Aceptar un outcome de otro bundle dejaría un receipt que declara inputs
  // que no produjeron sus ledgers (incoherencia interna); fail-closed antes de
  // fabricarlo.
  if (typeof bundle.contentHash !== "string" || bundle.contentHash.length === 0
    || baseReceipt.frozenBundleContentHash !== bundle.contentHash) {
    return { ok: false, code: "BUNDLE_OUTCOME_MISMATCH", message: "El replay no corresponde al frozen bundle: receipt.frozenBundleContentHash debe igualar bundle.contentHash; un receipt que declara inputs distintos de los que produjeron los ledgers rompe la trazabilidad (§14.9)." };
  }

  // §14.9: no basta con que la etiqueta contentHash del bundle coincida con la
  // del replay; hay que recalcular el hash del contenido real del bundle. Un
  // bundle mutado después de congelarse conserva la etiqueta vieja, así que
  // declararía un hash de inputs que no produjo sus ledgers ("same frozen input
  // bundle → same ledger and economic outputs"). Fail-closed antes de fabricar.
  const { contentHash, ...frozenContent } = bundle;
  if (contentHashOf(frozenContent) !== contentHash) {
    return { ok: false, code: "FROZEN_BUNDLE_HASH_MISMATCH", message: "El contenido del frozen bundle no coincide con su contentHash: fue mutado después de congelarse; un receipt que declara inputs distintos de los que produjeron los ledgers rompe la reproducibilidad (§14.9)." };
  }

  // §14.9: content hash del input dataset manifest congelado. El manifest PIT
  // es la fuente declarada en el receipt (datasetManifestId/Version); aquí se
  // añade el hash canónico de su contenido.
  const datasetManifestContentHash = contentHashOf(bundle.data.manifest);

  // §14.9: metadata PIT de fronteras — las fronteras de decisión exactas que
  // el replay recorrió, ya asentadas fila a fila en el decision ledger real
  // (no una lista reconstruida a mano).
  const pitFrontiers = replay.ledgers.decision.map((row) => ({
    frontierDate: row.frontier,
    boundaryUtc: row.decisionTimestamp,
  }));

  const enriched = {
    ...baseReceipt,
    datasetManifestContentHash,
    pitFrontierMetadata: {
      frontiers: pitFrontiers,
      dataManifestContentHash: datasetManifestContentHash,
    },
    // Los valores económicos del run (ledgers/cobertura/status) quedan
    // digeridos para comparar reproducibilidad sin re-run manual (§14.10).
    outputDigests: outputBundleDigestsOf({
      ledgers: replay.ledgers,
      terminalCoverage: replay.terminalCoverage,
      status: replay.status,
    }),
  };
  const receiptId = receiptIdentityOf(enriched);
  return {
    ok: true,
    receipt: Object.freeze({ ...enriched, receiptId }),
    receiptId,
  };
}

// P6.10: ensambla el output bundle completo del run. Partes §14.10: ledgers
// decision/execution/coverage; coverage/remaining; B/H/V por campaña y paired
// Delta V cuando existan; source/proxy/revision status; warnings/aggregates de
// availability; coverage status; validity; receipt completo con versiones.
// Las partes que este run no produce (evaluación B/H/V downstream, segundo
// brazo) quedan null explícitas (§14.7: no se inventa), nunca omitidas en
// silencio.
export function buildOutputBundle({ bundle, replayOutcome }) {
  const base = materializeRunReceipt({ bundle, replayOutcome });
  if (!base.ok) {
    return base;
  }
  const replay = replayOutcome.replay;
  const outputBundle = {
    bundleKind: "P6_OUTPUT_BUNDLE",
    receipt: base.receipt,
    ledgers: replay.ledgers,
    terminalCoverage: replay.terminalCoverage,
    status: replay.status,
    // §14.10: partes de evaluación que este run no produce; null explícito.
    bhvByCampaign: replay.bhvByCampaign ?? null,
    pairedDeltaV: replay.pairedDeltaV ?? null,
    sourceProxyRevisionStatus: replay.sourceProxyRevisionStatus ?? null,
  };
  const materialized = Object.freeze({ ...outputBundle, digests: outputBundleDigestsOf(outputBundle) });
  return {
    ok: true,
    outputBundle: materialized,
    receiptId: base.receiptId,
  };
}

// §25.2 fila IMP-14: registro append-only de receipts. Preserva cada run
// registrado (incluso re-runs idénticos) y no expone borrado/reescritura.
export function createRunReceiptRegistry() {
  const entries = [];
  const byReceiptId = new Map();

  const registry = {
    // Append-only: cada register añade una entrada nueva y el receiptId se
    // re-deriva del contenido recibido, así que una corrección
    // (datos/evaluator/config) entra como receiptId distinto y ningún run
    // previo se sobrescribe (§25.2). El freeze del bundle es superficial, así
    // que antes de aceptar la entrada se re-derivan los digests reales y se
    // exige que coincidan con los declarados en el receipt: un ledger mutado
    // por dentro no entra al registro.
    register({ outputBundle }) {
      if (!outputBundle || typeof outputBundle !== "object" || Array.isArray(outputBundle) || outputBundle.bundleKind !== "P6_OUTPUT_BUNDLE") {
        return { ok: false, code: "INVALID_OUTPUT_BUNDLE", message: "Sólo se registran output bundles P6 materializados por buildOutputBundle (§14.10)." };
      }
      if (!outputBundle.ledgers || typeof outputBundle.ledgers !== "object" || Array.isArray(outputBundle.ledgers)
        || !outputBundle.receipt || typeof outputBundle.receipt !== "object" || Array.isArray(outputBundle.receipt)) {
        return { ok: false, code: "INVALID_OUTPUT_BUNDLE", message: "El output bundle debe exponer ledgers y receipt para verificar sus digests (§14.10)." };
      }
      // §14.9/§25.2: los ledgers reales deben coincidir con receipt.outputDigests;
      // si no, el bundle fue mutado después del build y se rechaza fail-closed.
      const declaredDigests = outputBundle.receipt.outputDigests;
      const recomputedDigests = outputBundleDigestsOf(outputBundle);
      if (!declaredDigests || typeof declaredDigests !== "object" || Array.isArray(declaredDigests)
        || contentHashOf(recomputedDigests) !== contentHashOf(declaredDigests)) {
        return { ok: false, code: "OUTPUT_DIGEST_MISMATCH", message: "Los ledgers del bundle no coinciden con receipt.outputDigests: el bundle fue mutado después del build y no se registra (§14.9/§25.2)." };
      }
      // El receiptId se re-deriva del contenido recibido: un receipt editado
      // después del build ya no es el receipt del run, y batirlo contra el ID
      // registrado no lo restaura — como máximo entra como receipt distinto.
      const receiptId = receiptIdentityOf(outputBundle.receipt);
      const entry = Object.freeze({
        receiptId,
        registeredAtOrder: entries.length + 1,
        outputBundle,
      });
      entries.push(entry);
      if (!byReceiptId.has(receiptId)) {
        byReceiptId.set(receiptId, entry);
      }
      return { ok: true, receiptId, entryCount: entries.length };
    },
    has(receiptId) {
      return byReceiptId.has(receiptId);
    },
    receiptOf(receiptId) {
      return (byReceiptId.get(receiptId) ?? null)?.outputBundle ?? null;
    },
    // Preservación: snapshot congelado del historial completo.
    snapshot() {
      return entries.map((entry) => Object.freeze({ ...entry }));
    },
  };
  return registry;
}

// §14.9: compara dos output bundles para decidir reproducibilidad. Reproducible
// = mismos ledgers y valores económicos (status incluido como valor producido
// del run); el run timestamp es metadata, no comparable. Devuelve la lista de
// diferencias en lugar de un booleano opaco.
export function compareReproducibility({ outputBundle: bundleA = null } = {}, { outputBundle: bundleB = null } = {}) {
  if (!bundleA || !bundleB) {
    return { ok: false, code: "MISSING_OUTPUT_BUNDLE", differences: [], receiptIds: null };
  }
  const differences = [];
  const digestA = outputBundleDigestsOf(bundleA);
  const digestB = outputBundleDigestsOf(bundleB);
  for (const component of Object.keys(digestA)) {
    if (digestA[component] !== digestB[component]) {
      differences.push({ component, kind: "DIGEST_MISMATCH" });
    }
  }
  const identityA = receiptIdentityOf(bundleA.receipt);
  const identityB = receiptIdentityOf(bundleB.receipt);
  if (identityA !== identityB) {
    differences.push({ component: "receipt", kind: "RECEIPT_IDENTITY_MISMATCH" });
  }
  return { ok: differences.length === 0, differences, receiptIds: [identityA, identityB] };
}
