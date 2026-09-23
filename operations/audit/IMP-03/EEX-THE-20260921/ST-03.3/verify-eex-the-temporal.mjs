#!/usr/bin/env node
// IMP-03 / ST-03.3 verifier.
// Checks: preserved input hashes, scoped lake enumeration, the temporal manifest
// contract (four §6.1 semantics per requirement), the provenance/permissions
// contract (no fabricated rights), the eight-field §6.3 matrix contribution, the
// full §20.2.8 ST_RECEIPT via the existing src/contracts validator, SHA256SUMS
// integrity and write-set containment. Negative assertions are scoped to the
// inspected paths.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';
import { validateStReceipt, linkStReceiptToPacket } from '../../../../../src/contracts/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..', '..', '..');
const LAKE = '/srv/hot-data/EEX';

const EXPECTED = {
  spec: '86c4bd4eeb5f9d0ebad94763128b221eb64525a2b7fff1007dab0af88b39cb6c',
  imp01Receipt: '78d92de81d8c480b7d96c7203fa2a0661e00e5fb98525aee8c385860a89b887c',
  priorImp03Receipt: 'e203580b4a1dc88107bebd37502450c58286ecd81d9c840f8f94c1bef63bcde3',
  st03_1Matrix: '5e94b60b00245cfe7225c3101bd143d55d5015a7678a0d0c13484334f7a6b42f',
  priorTemporalManifest: '6b630e9edf994b58ddc7016950403ef1897d780f6baa2e6ec72e787754b58578',
  referenceDoc: 'dfa9cfc8e84f27ea5440ff6c5968654999b71e0c6c7370ec6653178c8e71e260',
};

const EIGHT_FIELDS = [
  'requirement', 'missionAndCandidate', 'criticalVersusOptional', 'sourceType',
  'historicalCoverage', 'pointInTimeValidity', 'availabilityStatus', 'shortValidationNote',
];
const AVAILABILITY = new Set(['AVAILABLE NOW', 'FORWARD CAPTURE', 'PROXY', 'UNAVAILABLE']);
const READINESS = new Set(['DATA_READY', 'DATA_PROVISIONAL', 'FORWARD_ONLY', 'DATA_BLOCKED']);
const TEMPORAL_SEMANTICS = ['occurredReferenceTime', 'publicationSourceAvailabilityTime', 'policyConsumableTime', 'revisionVersion'];
const TEMPORAL_STATUS = new Set(['OBSERVED', 'PARTIAL', 'HISTORICAL_ASSERTION', 'MISSING', 'NOT_DEMONSTRATED']);
const REQUIREMENT_IDS = new Set(Array.from({ length: 17 }, (_, i) => `R-${String(i + 1).padStart(2, '0')}`));
const PERMISSION_DOC_ROOTS = ['/srv/hot-data/energy-markets/reference', '/srv/hot-data/energy-markets/app/docs'];
const ALLOWED_PREFIX = relative(root, here);

const failures = [];
const rows = [];
function check(name, ok, detail) {
  rows.push({ name, ok, detail });
  if (!ok) failures.push(`${name}: ${detail}`);
}
function sha256File(p) {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}
function load(name) {
  return JSON.parse(readFileSync(join(here, name), 'utf8'));
}

// 1. Preserved inputs unchanged.
for (const [name, rel, base, expected] of [
  ['SPEC', 'docs/canonical/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1.md', root, EXPECTED.spec],
  ['IMP-01-IMP_RECEIPT', 'operations/receipts/IMP-01-IMP_RECEIPT.json', root, EXPECTED.imp01Receipt],
  ['IMP-03-IMP_RECEIPT (prior accepted)', 'operations/receipts/IMP-03-IMP_RECEIPT.json', root, EXPECTED.priorImp03Receipt],
  ['ST-03.1 matrix (accepted)', 'operations/audit/IMP-03/data-sufficiency-matrix.json', root, EXPECTED.st03_1Matrix],
  ['prior temporal manifest (accepted)', 'operations/audit/IMP-03/temporal-manifest.json', root, EXPECTED.priorTemporalManifest],
  ['reference doc', 'documentation/eex-reference-price.md', '/srv/hot-data/energy-markets/reference', EXPECTED.referenceDoc],
]) {
  const p = resolve(base, rel);
  if (!existsSync(p)) { check(`input:${name}`, false, `missing ${rel}`); continue; }
  const actual = sha256File(p);
  check(`input:${name}`, actual === expected, `${actual} vs ${expected}`);
}

// 2. Scoped lake enumeration: only the NATGAS/THE table paths are audited.
for (const table of ['eex_derivative_trade', 'eex_derivative_top_of_book']) {
  const dir = join(LAKE, `table=${table}`, 'cmdty=NATGAS', 'area=THE');
  const names = existsSync(dir) ? readdirSync(dir) : [];
  const unexpected = names.filter((n) => !n.startsWith('trd_date='));
  check(`lakeScope:${table}`, existsSync(dir) && unexpected.length === 0,
    `dir exists=${existsSync(dir)}; unexpected entries=${JSON.stringify(unexpected)}`);
}

// 3. Temporal manifest contract.
const manifest = load('temporal-manifest.json');
check('temporal:artifactKind', manifest.artifactKind === 'IMP-03_TEMPORAL_MANIFEST', manifest.artifactKind);
check('temporal:identity', manifest.subtaskId === 'ST-03.3' && manifest.packetId === 'WP-IMP-03-ST-3-v1.1' &&
  manifest.parentImp === 'IMP-03' && manifest.projectId === '96bbd5b1-94da-4781-8c2b-455fdfb28d1a',
  `${manifest.packetId}/${manifest.subtaskId}/${manifest.parentImp}/${manifest.projectId}`);
check('temporal:entryCount', Array.isArray(manifest.entries) && manifest.entries.length === 17, `got ${manifest.entries?.length}`);
for (const e of manifest.entries) {
  check(`temporal:${e.requirementId}.id`, REQUIREMENT_IDS.has(e.requirementId), `unknown ${e.requirementId}`);
  const missing = TEMPORAL_SEMANTICS.filter((s) => !(s in e));
  check(`temporal:${e.requirementId}.semantics`, missing.length === 0, `missing ${missing.join(',')}`);
  for (const s of TEMPORAL_SEMANTICS) {
    const status = e[s]?.status;
    check(`temporal:${e.requirementId}.${s}.status`, TEMPORAL_STATUS.has(status), `bad status ${status}`);
  }
}
for (const t of ['eex_derivative_trade', 'eex_derivative_top_of_book']) {
  const scope = manifest.observedScope?.tables?.[t];
  check(`temporal:scope.${t}`, scope && Number.isInteger(scope.partitionCount) && scope.partitionCount > 0 &&
    scope.dateMin && scope.dateMax && Array.isArray(scope.sample?.files) && scope.sample.files.length > 0,
    JSON.stringify(scope && { p: scope.partitionCount, min: scope.dateMin, max: scope.dateMax }));
}
check('temporal:noReadinessLeak', manifest.entries.every((e) => !READINESS.has(e.availabilityStatus)),
  'availability namespace must not contain readiness values');

// 3b. Captured positive evidence: bounded per-file summaries of price/unit/
// instrument fields must be present, tied to locators/hashes, and non-trivial.
const prov = load('provenance-permissions.json');
const digest = manifest.observedScope?.sampleEvidenceDigest;
check('evidence:digestPresent', digest && Array.isArray(digest.files) && digest.files.length > 0,
  `digest files=${digest?.files?.length}`);
const digestFiles = digest?.files || [];
check('evidence:fieldsOnEveryFile', digestFiles.every((f) =>
  f.priceFieldSummary && f.unitFieldSummary && f.instrumentFieldSummary && f.contractBucketSummary &&
  typeof f.sha256 === 'string' && f.path),
  'every digest file must carry price/unit/instrument/bucket summaries and a locator+sha256');
check('evidence:unitsObserved', (digest?.unitValuesObserved?.UOM || []).includes('MWh') &&
  (digest?.unitValuesObserved?.Currency || []).includes('EUR'),
  JSON.stringify(digest?.unitValuesObserved));
const tradeFiles = digestFiles.filter((f) => f.table === 'eex_derivative_trade');
const tobFiles = digestFiles.filter((f) => f.table === 'eex_derivative_top_of_book');
check('evidence:tradePriceNonEmpty', tradeFiles.some((f) => (f.priceFieldSummary?.Px?.nonEmpty || 0) > 0),
  'no sampled trade file recorded a non-empty Px');
check('evidence:tobQuoteNonEmpty', tobFiles.some((f) => (f.priceFieldSummary?.BidPx?.nonEmpty || 0) > 0 ||
  (f.priceFieldSummary?.AskPx?.nonEmpty || 0) > 0), 'no sampled top-of-book file recorded a non-empty BidPx/AskPx');
check('evidence:instrumentNonEmpty', digestFiles.some((f) => (f.instrumentFieldSummary?.InstrumentISIN?.nonEmpty || 0) > 0),
  'no sampled file recorded a non-empty InstrumentISIN');
check('evidence:mixedBucketsRecorded', tradeFiles.some((f) => (f.contractBucketSummary?.distinctCount || 0) > 1),
  'trade sample bucket summary should record more than one product bucket');
check('evidence:digestInProvenance', JSON.stringify(prov.provenance?.sampleEvidenceDigest) === JSON.stringify(digest),
  'provenance digest must match the manifest digest');
check('negative:missingUnitRejected', (digest?.unitValuesObserved?.UOM || []).includes('kWh') === false,
  'guard accepted an unexpected unit');

// 4. Provenance / permissions contract.
check('provenance:artifactKind', prov.artifactKind === 'IMP-03_PROVENANCE_PERMISSIONS', prov.artifactKind);
check('provenance:permissionsUnknown', prov.permissions?.conclusion?.status === 'UNKNOWN' &&
  prov.permissions?.conclusion?.absenceIsScoped === true,
  JSON.stringify(prov.permissions?.conclusion));
check('provenance:noLakePermissionFields', Array.isArray(prov.permissions?.lakePermissionFields) &&
  prov.permissions.lakePermissionFields.length === 0, JSON.stringify(prov.permissions?.lakePermissionFields));
check('provenance:availabilityNotDemonstrated', prov.historicalPolicyAvailability?.status === 'NOT_DEMONSTRATED',
  prov.historicalPolicyAvailability?.status);
check('provenance:matchesInScope', (prov.permissions?.keywordMatches || []).every((m) =>
  PERMISSION_DOC_ROOTS.some((r) => m.path.startsWith(r))), 'permission matches must come from allowed doc roots');
const metaPaths = (prov.provenance?.extractionMetadata || []).filter((m) => m.present === true);
check('provenance:extractionMetadata', metaPaths.length === 4, `present extraction metadata files=${metaPaths.length}`);
const reader = prov.provenance?.readerAppAuxiliary;
check('provenance:readerNonAuthoritative', reader && /NOT vendor-semantic authority/.test(reader.authority || ''),
  'reader auxiliary evidence must be labelled non-authoritative');

// 5. Matrix contribution contract.
const matrix = load('matrix-contribution.json');
check('matrix:guards.noCoveragePercent', matrix.guards && matrix.guards.coveragePercent === null, 'coveragePercent must be null');
check('matrix:isContribution', matrix.guards && matrix.guards.isContributionNotFinalReadiness === true, 'must declare contribution, not readiness');
for (const r of matrix.rows) {
  const missing = EIGHT_FIELDS.filter((f) => !(f in r));
  check(`matrix:${r.requirementId}.fields`, missing.length === 0, `missing ${missing.join(',')}`);
  check(`matrix:${r.requirementId}.id`, REQUIREMENT_IDS.has(r.requirementId), `unknown requirement id ${r.requirementId}`);
  check(`matrix:${r.requirementId}.availability`, AVAILABILITY.has(r.availabilityStatus), `bad availability ${r.availabilityStatus}`);
}
for (const nc of matrix.notContributed) {
  check(`matrix:notContributed:${nc.requirementId}`, REQUIREMENT_IDS.has(nc.requirementId), `unknown ${nc.requirementId}`);
}
for (const c of matrix.readinessContribution.candidates) {
  const ok = READINESS.has(c.readiness) && (c.readiness !== 'DATA_READY' || c.criticalMissing.length === 0);
  check(`matrix:readiness:${c.candidate}`, ok, `bad readiness ${c.readiness}`);
}
check('matrix:noFabricatedReady', matrix.rows.every((r) => r.availabilityStatus !== 'DATA_READY'),
  'readiness namespace must not appear in availabilityStatus');
const r04 = matrix.rows.find((r) => r.requirementId === 'R-04');
check('matrix:R-04.notOverclaimed', r04 && r04.availabilityStatus === 'UNAVAILABLE',
  `R-04 availability must be UNAVAILABLE (got ${r04?.availabilityStatus})`);
check('matrix:R-04.partialEvidenceRecorded', r04 && r04.historicalCoverage?.evidence?.sampleEvidenceDigest &&
  r04.historicalCoverage.status === 'PARTIAL', 'R-04 must record partial observed evidence with a captured digest');
check('matrix:noNowObservedOverclaim', matrix.readinessContribution.candidates.every((c) =>
  Array.isArray(c.nowObserved) && c.nowObserved.length === 0 && c.criticalMissing.includes('R-04')),
  'candidates must not claim R-04 as nowObserved and must list it critical-missing');

// Explicit labelled negative self-tests: the guards must fail closed. In-memory only.
check('negative:unknownRequirementRejected', REQUIREMENT_IDS.has('R-99') === false, 'unknown id was accepted');
check('negative:badTemporalStatusRejected', TEMPORAL_STATUS.has('READY') === false, 'bad temporal status was accepted');
const badCandidate = { candidate: 'synthetic', readiness: 'DATA_READY', criticalMissing: ['R-01'] };
check('negative:criticalMissingDataReadyRejected',
  READINESS.has(badCandidate.readiness) && badCandidate.criticalMissing.length > 0, 'guard failed to flag critical missing');

// 6. ST_RECEIPT via the existing contract validator + packet linkage.
const packet = {
  packetId: matrix.packetId,
  subtaskId: matrix.subtaskId,
  parentImp: matrix.parentImp,
  project: matrix.projectId,
  spec: { id: matrix.specId, version: matrix.specVersion, sha256: matrix.specSha256 },
};
const receipt = load('ST_RECEIPT.json');
const vr = validateStReceipt(receipt);
check('receipt:validateStReceipt', vr.ok, JSON.stringify(vr.errors));
const lr = linkStReceiptToPacket(packet, receipt);
check('receipt:linkStReceiptToPacket', lr.ok, JSON.stringify(lr.errors));
check('receipt:recommendedStatus', receipt.recommendedStatus === 'in_review', `got ${receipt.recommendedStatus}`);
const brokenReceipt = JSON.parse(JSON.stringify(receipt));
delete brokenReceipt.testResults;
check('negative:receiptMissingFieldRejected', validateStReceipt(brokenReceipt).ok === false,
  'validator accepted a receipt without testResults');

// 7. SHA256SUMS integrity + completeness + write-set containment.
const EXPECTED_OUTPUTS = [
  'audit_eex_the_temporal.py', 'temporal-manifest.json', 'provenance-permissions.json',
  'matrix-contribution.json', 'audit-report.md', 'verify-eex-the-temporal.mjs',
  'verification-output.txt', 'continuity-checkpoint.md', 'ST_RECEIPT.json',
];
const sumsPath = join(here, 'SHA256SUMS');
if (existsSync(sumsPath)) {
  const lines = readFileSync(sumsPath, 'utf8').trim().split('\n').filter(Boolean);
  const bad = [];
  const listed = new Set();
  for (const line of lines) {
    const m = line.match(/^([0-9a-f]{64})  (.+)$/);
    if (!m) { bad.push(`malformed: ${line}`); continue; }
    const [, hash, rel] = m;
    listed.add(rel);
    const p = join(here, rel);
    if (!existsSync(p)) { bad.push(`missing: ${rel}`); continue; }
    if (sha256File(p) !== hash) { bad.push(`hash: ${rel}`); }
    if (relative(here, p).startsWith('..')) { bad.push(`escape: ${rel}`); }
  }
  check('sums:integrityAndContainment', bad.length === 0, bad.join('; '));
  const unlisted = EXPECTED_OUTPUTS.filter((n) => !listed.has(n));
  check('sums:expectedOutputsListed', unlisted.length === 0, `unlisted expected outputs: ${unlisted.join(',')}`);
  const unexpected = [...listed].filter((n) => n !== 'SHA256SUMS' && !EXPECTED_OUTPUTS.includes(n));
  check('sums:noUnexpectedEntries', unexpected.length === 0, `unexpected sums entries: ${unexpected.join(',')}`);
} else {
  check('sums:present', false, 'SHA256SUMS missing');
}

// 8. Write set: every file under this run is inside the allowed path.
const written = readdirSync(here).map((n) => join(here, n));
const outside = written.filter((p) => statSync(p).isFile() && relative(here, p).startsWith('..'));
check('writeset:containment', outside.length === 0 &&
  ALLOWED_PREFIX === 'operations/audit/IMP-03/EEX-THE-20260921/ST-03.3',
  `outside=${JSON.stringify(outside)} allowedPrefix=${ALLOWED_PREFIX}`);

for (const r of rows) {
  console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.name}${!r.ok && r.detail ? '  — ' + r.detail : ''}`);
}
console.log(failures.length === 0 ? `\nPASS (${rows.length} checks)` : `\nFAIL (${failures.length}/${rows.length})`);
process.exit(failures.length === 0 ? 0 : 1);
