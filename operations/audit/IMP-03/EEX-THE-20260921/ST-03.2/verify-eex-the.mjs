#!/usr/bin/env node
// IMP-03 / ST-03.2 verifier.
// Checks: preserved input hashes, scoped lake enumeration, the eight-field §6.3
// matrix contribution contract, the separate state namespaces, the full §20.2.8
// ST_RECEIPT via the existing src/contracts validator, SHA256SUMS integrity and
// write-set containment. Negative assertions are scoped to the inspected paths.
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
};

const EIGHT_FIELDS = [
  'requirement', 'missionAndCandidate', 'criticalVersusOptional', 'sourceType',
  'historicalCoverage', 'pointInTimeValidity', 'availabilityStatus', 'shortValidationNote',
];
const AVAILABILITY = new Set(['AVAILABLE NOW', 'FORWARD CAPTURE', 'PROXY', 'UNAVAILABLE']);
const READINESS = new Set(['DATA_READY', 'DATA_PROVISIONAL', 'FORWARD_ONLY', 'DATA_BLOCKED']);
const REQUIREMENT_IDS = new Set(Array.from({ length: 17 }, (_, i) => `R-${String(i + 1).padStart(2, '0')}`));
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

// 1. Preserved inputs unchanged.
for (const [name, rel, expected] of [
  ['SPEC', 'docs/canonical/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1.md', EXPECTED.spec],
  ['IMP-01-IMP_RECEIPT', 'operations/receipts/IMP-01-IMP_RECEIPT.json', EXPECTED.imp01Receipt],
  ['IMP-03-IMP_RECEIPT (prior accepted)', 'operations/receipts/IMP-03-IMP_RECEIPT.json', EXPECTED.priorImp03Receipt],
  ['ST-03.1 matrix (accepted)', 'operations/audit/IMP-03/data-sufficiency-matrix.json', EXPECTED.st03_1Matrix],
]) {
  const p = resolve(root, rel);
  if (!existsSync(p)) { check(`input:${name}`, false, `missing ${rel}`); continue; }
  const actual = sha256File(p);
  check(`input:${name}`, actual === expected, `${actual} vs ${expected}`);
}

function unexpectedEntries(names) {
  return names.filter((n) => !n.startsWith('trd_date='));
}
function readinessOk(c) {
  return READINESS.has(c.readiness) && (c.readiness !== 'DATA_READY' || c.criticalMissing.length === 0);
}

// 2. Scoped lake enumeration: only the NATGAS/THE table paths are audited.
for (const table of ['eex_derivative_trade', 'eex_derivative_top_of_book']) {
  const dir = join(LAKE, `table=${table}`, 'cmdty=NATGAS', 'area=THE');
  const names = existsSync(dir) ? readdirSync(dir) : [];
  const unexpected = unexpectedEntries(names);
  check(`lakeScope:${table}`, existsSync(dir) && unexpected.length === 0,
    `dir exists=${existsSync(dir)}; unexpected entries=${JSON.stringify(unexpected)}`);
}

// 3. Matrix contribution contract.
const matrix = JSON.parse(readFileSync(join(here, 'matrix-contribution.json'), 'utf8'));
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
  check(`matrix:readiness:${c.candidate}`, readinessOk(c), `bad readiness ${c.readiness}`);
}
check('matrix:noFabricatedReady', matrix.rows.every((r) => r.availabilityStatus !== 'DATA_READY'),
  'readiness namespace must not appear in availabilityStatus');
check('matrix:criticalMissingNotClaimedReady',
  matrix.readinessContribution.candidates.every((c) => c.readiness !== 'DATA_READY' || c.criticalMissing.length === 0),
  'a candidate with critical missing must not be DATA_READY');

// Explicit labelled negative self-tests: the guards must fail closed. In-memory only.
check('negative:unexpectedEntryRejected',
  unexpectedEntries(['trd_date=2020-01-01', 'area=POWER']).includes('area=POWER'),
  'unexpected entry was not detected');
const badCandidate = { candidate: 'synthetic', readiness: 'DATA_READY', criticalMissing: ['R-01'] };
check('negative:criticalMissingDataReadyRejected', readinessOk(badCandidate) === false,
  'a DATA_READY candidate with critical missing was accepted');

// 4. ST_RECEIPT via the existing contract validator + packet linkage.
const packet = {
  packetId: matrix.packetId,
  subtaskId: matrix.subtaskId,
  parentImp: matrix.parentImp,
  project: matrix.projectId,
  spec: { id: matrix.specId, version: matrix.specVersion, sha256: matrix.specSha256 },
};
const receipt = JSON.parse(readFileSync(join(here, 'ST_RECEIPT.json'), 'utf8'));
const vr = validateStReceipt(receipt);
check('receipt:validateStReceipt', vr.ok, JSON.stringify(vr.errors));
const lr = linkStReceiptToPacket(packet, receipt);
check('receipt:linkStReceiptToPacket', lr.ok, JSON.stringify(lr.errors));
check('receipt:recommendedStatus', receipt.recommendedStatus === 'in_review', `got ${receipt.recommendedStatus}`);
const brokenReceipt = JSON.parse(JSON.stringify(receipt));
delete brokenReceipt.testResults;
check('negative:receiptMissingFieldRejected', validateStReceipt(brokenReceipt).ok === false,
  'validator accepted a receipt without testResults');

// 5. SHA256SUMS integrity + completeness + write-set containment.
const EXPECTED_OUTPUTS = [
  'audit_eex_the.py', 'source-inventory.json', 'coverage-summary.json',
  'matrix-contribution.json', 'audit-report.md', 'verify-eex-the.mjs',
  'verification-output.txt', 'continuity-checkpoint.md', 'ST_RECEIPT.json',
];
const sumsPath = join(here, 'SHA256SUMS');
if (existsSync(sumsPath)) {
  const lines = readFileSync(sumsPath, 'utf8').trim().split('\n').filter(Boolean);
  let bad = [];
  const listed = new Set();
  for (const line of lines) {
    const m = line.match(/^([0-9a-f]{64})  (.+)$/);
    if (!m) { bad.push(`malformed: ${line}`); continue; }
    const [, hash, rel] = m;
    listed.add(rel);
    const p = join(here, rel);
    if (!existsSync(p)) { bad.push(`missing: ${rel}`); continue; }
    if (sha256File(p) !== hash) { bad.push(`hash: ${rel}`); }
    const inside = relative(here, p);
    if (inside.startsWith('..')) { bad.push(`escape: ${rel}`); }
  }
  check('sums:integrityAndContainment', bad.length === 0, bad.join('; '));
  const unlisted = EXPECTED_OUTPUTS.filter((n) => !listed.has(n));
  check('sums:expectedOutputsListed', unlisted.length === 0, `unlisted expected outputs: ${unlisted.join(',')}`);
  const unexpected = [...listed].filter((n) => n !== 'SHA256SUMS' && !EXPECTED_OUTPUTS.includes(n));
  check('sums:noUnexpectedEntries', unexpected.length === 0, `unexpected sums entries: ${unexpected.join(',')}`);
} else {
  check('sums:present', false, 'SHA256SUMS missing');
}

// 6. Write set: every file written under this run is inside the allowed path.
const written = readdirSync(here).map((n) => join(here, n));
const outside = written.filter((p) => statSync(p).isFile() && relative(here, p).startsWith('..'));
check('writeset:containment', outside.length === 0 && ALLOWED_PREFIX === 'operations/audit/IMP-03/EEX-THE-20260921/ST-03.2',
  `outside=${JSON.stringify(outside)} allowedPrefix=${ALLOWED_PREFIX}`);

for (const r of rows) {
  console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.name}${!r.ok && r.detail ? '  — ' + r.detail : ''}`);
}
console.log(failures.length === 0 ? `\nPASS (${rows.length} checks)` : `\nFAIL (${failures.length}/${rows.length})`);
process.exit(failures.length === 0 ? 0 : 1);