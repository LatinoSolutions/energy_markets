// Fixtures SINTÉTICOS para los tests de IMP-29. Construyen un manifest PIT
// verificado con el mismo camino que IMP-06 (artifact leído de disco + receipt
// aceptado sintético). No son datos de procurement ni evidencia real: sólo
// ejercitan la frontera de la Operator Interface sin inventar nada en el repo.

import { buildPitManifestAt } from "../../src/pit-views/views.mjs";
import { canonicalValueSha256 } from "../../src/pit-views/pit-record.mjs";
import { toUtcTimestamp } from "../../src/pit-views/time.mjs";
import { ATTESTATION_PATH, FIXTURE_SCOPE, VALUE_ATTESTATION_PATH, fixtureRepo } from "../pit-views/fixture-repo.mjs";

export function syntheticRepo({ attestations = [], valueAttestations = [] } = {}) {
  const content = JSON.stringify({ artifactKind: "PIT_CONSUMPTION_ATTESTATIONS", auditId: "AUDIT-FIXTURE", scope: FIXTURE_SCOPE, attestations });
  const valueContent = JSON.stringify({ artifactKind: "PIT_VALUE_ATTESTATIONS", auditId: "AUDIT-FIXTURE", scope: FIXTURE_SCOPE, attestations: valueAttestations });
  const { repoRoot, refs } = fixtureRepo({
    artifacts: [
      { path: ATTESTATION_PATH, content },
      { path: VALUE_ATTESTATION_PATH, content: valueContent },
    ],
  });
  return { repoRoot, consumptionAttestationRefs: [refs[0]], valueAttestationRefs: [refs[1]] };
}

const CONSUMABLE_EVIDENCE = {
  source: "fixture://ingest-log",
  locator: "row @ fixture",
  sha256: "a".repeat(64),
};

export const DECISION_BASE = {
  key: "G0BQ.202604.reference",
  viewScope: "decision",
  occurredAtUtc: "2026-03-31T17:15:00Z",
  publishedAtUtc: "2026-03-31T18:00:00Z",
  consumableAtUtc: "2026-04-01T06:00:00Z",
  consumableEvidence: CONSUMABLE_EVIDENCE,
  revisionId: "v1",
  value: 24.35,
};

export const EVALUATION_BENCHMARK = {
  key: "B.G0BQ.202604.closed",
  viewScope: "evaluation",
  occurredAtUtc: "2026-06-30T17:15:00Z",
  publishedAtUtc: "2026-07-01T06:00:00Z",
  consumableAtUtc: "2026-07-01T06:30:00Z",
  consumableEvidence: CONSUMABLE_EVIDENCE,
  revisionId: "bench-v1",
  value: 25.7,
};

// Recomendación canónica del decision view (§26.2/§26.3): los vínculos de
// actuación e intervención se resuelven contra ella en el manifest verificado.
export const RECOMMENDATION_BASE = {
  key: "R.G0BQ.202604",
  viewScope: "decision",
  occurredAtUtc: "2026-03-31T17:20:00Z",
  publishedAtUtc: "2026-03-31T18:05:00Z",
  consumableAtUtc: "2026-04-01T06:00:00Z",
  consumableEvidence: CONSUMABLE_EVIDENCE,
  revisionId: "v1",
  value: { action: "BUY", sizing: 0.5 },
};

// Autoridad otorgada y receipt de governance, como registros del backend
// (§26.5): todo comando de la UI se contrasta contra ellos.
export const AUTHORITY_BASE = {
  key: "GOV.authority-1",
  viewScope: "decision",
  occurredAtUtc: "2026-04-02T08:00:00Z",
  publishedAtUtc: "2026-04-02T08:00:00Z",
  consumableAtUtc: "2026-04-02T08:00:00Z",
  consumableEvidence: CONSUMABLE_EVIDENCE,
  revisionId: "v1",
  value: { grantedTo: "operator-bru", scope: "GOVERNANCE" },
};

export const RECEIPT_BASE = {
  key: "GOV.receipt.exec-1",
  viewScope: "decision",
  occurredAtUtc: "2026-04-02T08:00:00Z",
  publishedAtUtc: "2026-04-02T08:00:00Z",
  consumableAtUtc: "2026-04-02T08:00:00Z",
  consumableEvidence: CONSUMABLE_EVIDENCE,
  revisionId: "v1",
  value: { kind: "GOVERNANCE_RECEIPT" },
};

// Referencia canónica "<recordKey>@<revisionId>" del registro.
export function backendRefOf(record) {
  return `${record.key}@${record.revisionId}`;
}

function valueAttestationsFor(records, revisions = []) {
  return records
    .filter((record) => record.value !== undefined && record.value !== null
      && canonicalValueSha256(record.value).ok
      && typeof record.revisionId === "string" && record.revisionId.trim().length > 0
      && toUtcTimestamp(record.publishedAtUtc ?? null).ok)
    .map((record) => {
      const receipt = revisions.find((revision) => revision?.key === record.key && revision?.revisionId === record.revisionId
        && toUtcTimestamp(revision?.effectiveAtUtc ?? null).ok);
      return {
        source: "fixture://value-log",
        locator: `${record.key}@${record.revisionId}`,
        sha256: "b".repeat(64),
        key: record.key,
        revisionId: record.revisionId,
        revisionOf: record.revisionOf ?? null,
        valueSha256: canonicalValueSha256(record.value).sha256,
        publishedAtUtc: record.publishedAtUtc,
        revisionEffectiveAtUtc: receipt?.effectiveAtUtc ?? null,
      };
    });
}

function attestationsFor(records) {
  return records
    .filter((record) => record.consumableAtUtc && record.consumableEvidence
      && canonicalValueSha256(record.value ?? null).ok
      && typeof record.revisionId === "string" && record.revisionId.trim().length > 0
      && record.consumableEvidence.source === CONSUMABLE_EVIDENCE.source
      && record.consumableEvidence.sha256 === CONSUMABLE_EVIDENCE.sha256)
    .map((record) => ({
      ...CONSUMABLE_EVIDENCE,
      key: record.key,
      revisionId: record.revisionId,
      valueSha256: canonicalValueSha256(record.value ?? null).sha256,
      consumableAtUtc: record.consumableAtUtc,
    }));
}

// Manifest PIT verificado desde fixtures sintéticos.
export function buildManifest({ records = [DECISION_BASE], revisions = [], proxyDeclarations = [] } = {}) {
  const { repoRoot, consumptionAttestationRefs, valueAttestationRefs } = syntheticRepo({
    attestations: attestationsFor(records),
    valueAttestations: valueAttestationsFor(records, revisions),
  });
  return buildPitManifestAt(repoRoot, {
    manifestId: "PIT-MANIFEST-OPERATOR-FIXTURE",
    manifestVersion: "v1",
    records,
    revisions,
    proxyDeclarations,
    consumptionAttestationRefs,
    valueAttestationRefs,
  });
}
