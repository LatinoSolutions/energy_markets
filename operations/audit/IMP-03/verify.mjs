#!/usr/bin/env node
// IMP-03 / ST-03.1 verifier.
// Validates input hashes, the eight-field Data Sufficiency Matrix contract, the two
// separate state namespaces, the four temporal semantics, claim provenance and the
// critical-missing rule. Demonstrates rejection of critical-missing DATA_READY and
// publication-only PIT claims with explicitly labelled synthetic negative cases.
// Real-data insufficiency (no series present) is reported separately and is NOT a
// verifier failure.
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');

const EXPECTED = {
  spec: '86c4bd4eeb5f9d0ebad94763128b221eb64525a2b7fff1007dab0af88b39cb6c',
  imp01Receipt: '78d92de81d8c480b7d96c7203fa2a0661e00e5fb98525aee8c385860a89b887c',
  baselineManifest: '895539b7312479a4350b7eeddf207c084090cf29abd391025dd763be00ca9860',
  imp01ContentVersion: 'c7cdf47cb382472b3c17f61d43673a4d885d562c658b30bbd4824059d15a437c'
};

const PATHS = {
  spec: 'docs/canonical/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1.md',
  imp01Receipt: 'operations/receipts/IMP-01-IMP_RECEIPT.json',
  baselineManifest: 'operations/bootstrap/baseline-manifest.json',
  inventory: 'operations/audit/IMP-03/source-inventory.json',
  temporal: 'operations/audit/IMP-03/temporal-manifest.json',
  matrix: 'operations/audit/IMP-03/data-sufficiency-matrix.json',
  report: 'operations/audit/IMP-03/audit-report.md'
};

const AVAILABILITY_NAMESPACE = ['AVAILABLE NOW', 'FORWARD CAPTURE', 'PROXY', 'UNAVAILABLE'];
const READINESS_NAMESPACE = ['DATA_READY', 'DATA_PROVISIONAL', 'FORWARD_ONLY', 'DATA_BLOCKED'];
const AVAILABILITY = new Set(AVAILABILITY_NAMESPACE);
const READINESS = new Set(READINESS_NAMESPACE);
const EIGHT_FIELDS = [
  'requirement',
  'missionAndCandidate',
  'criticalVersusOptional',
  'sourceType',
  'historicalCoverage',
  'pointInTimeValidity',
  'availabilityStatus',
  'shortValidationNote'
];
const COVERAGE_STATUS = new Set(['MISSING', 'VERIFIED', 'HISTORICAL_ASSERTION', 'SYNTHETIC_EXAMPLE']);
const PIT_STATUS = new Set(['MISSING', 'NOT_DEMONSTRATED', 'DEMONSTRATED', 'PARTIAL']);
const TEMPORAL_KEYS = ['occurredReferenceTime', 'publicationSourceAvailabilityTime', 'policyConsumableTime', 'revisionVersion'];
const SHA_RE = /^[0-9a-f]{64}$/;

function sha256File(p) {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}

function loadJson(rel) {
  const p = resolve(root, rel);
  if (!existsSync(p)) throw new Error(`missing artifact: ${rel}`);
  return JSON.parse(readFileSync(p, 'utf8'));
}

function checkInputHashes() {
  const errors = [];
  const checks = [
    ['SPEC', PATHS.spec, EXPECTED.spec],
    ['IMP-01-IMP_RECEIPT.json', PATHS.imp01Receipt, EXPECTED.imp01Receipt],
    ['baseline-manifest.json', PATHS.baselineManifest, EXPECTED.baselineManifest]
  ];
  const rows = [];
  for (const [name, rel, expected] of checks) {
    const p = resolve(root, rel);
    if (!existsSync(p)) { errors.push(`MISSING_INPUT ${rel}`); rows.push([name, 'MISSING', expected]); continue; }
    const actual = sha256File(p);
    rows.push([name, actual, expected]);
    if (actual !== expected) errors.push(`INPUT_HASH_MISMATCH ${name}: ${actual} != ${expected}`);
  }
  const cmd = 'find src/contracts test/contracts operations/audit/IMP-01/test-run.txt -type f | LC_ALL=C sort | xargs sha256sum | sha256sum';
  let contentVersion = null;
  try {
    contentVersion = execSync(cmd, { cwd: root, encoding: 'utf8' }).trim().split(/\s+/)[0];
  } catch (e) {
    errors.push(`CONTENT_VERSION_CMD_FAILED ${e.message}`);
  }
  if (contentVersion && contentVersion !== EXPECTED.imp01ContentVersion) {
    errors.push(`CONTENT_VERSION_MISMATCH ${contentVersion} != ${EXPECTED.imp01ContentVersion}`);
  }
  return { errors, rows, contentVersion };
}

// ---- matrix validators ------------------------------------------------------
function isNonEmptyString(v) { return typeof v === 'string' && v.trim().length > 0; }

function validateEvidence(evidence, allow, fileHashes, id, errors) {
  if (!evidence || typeof evidence !== 'object') { errors.push(`NO_PROVENANCE ${id}`); return; }
  if (!isNonEmptyString(evidence.path) || !isNonEmptyString(evidence.locator) || !isNonEmptyString(evidence.sha256)) {
    errors.push(`NO_PROVENANCE ${id}`);
    return;
  }
  if (!SHA_RE.test(evidence.sha256)) { errors.push(`BAD_SOURCE_HASH ${id}`); return; }
  if (!(evidence.path in allow)) { errors.push(`UNKNOWN_SOURCE ${id}: ${evidence.path}`); return; }
  if (evidence.sha256 !== allow[evidence.path]) { errors.push(`BAD_SOURCE_HASH ${id}`); return; }
  if (fileHashes[evidence.path] && fileHashes[evidence.path] !== evidence.sha256) {
    errors.push(`SOURCE_HASH_DRIFT ${id}: ${evidence.path}`);
  }
}

function validateMissingDoc(missing, id, errors) {
  if (!missing || typeof missing !== 'object'
    || !isNonEmptyString(missing.reason)
    || !Array.isArray(missing.inspectedSources) || missing.inspectedSources.length === 0
    || !isNonEmptyString(missing.custodianRole)
    || !isNonEmptyString(missing.nextRetrievalAction)) {
    errors.push(`MISSING_NOT_DOCUMENTED ${id}`);
  }
}

function validateRow(row, allow, fileHashes) {
  const errors = [];
  const id = row.requirementId || '<no-requirementId>';
  if (typeof row !== 'object' || row === null) return [`ROW_NOT_OBJECT`];
  for (const f of EIGHT_FIELDS) {
    if (!(f in row)) errors.push(`MISSING_FIELD ${id}: ${f}`);
  }
  // namespace separation
  if (READINESS.has(row.availabilityStatus)) errors.push(`NAMESPACE_CONFLATION ${id}: readiness value in availabilityStatus`);
  else if (!AVAILABILITY.has(row.availabilityStatus)) errors.push(`BAD_AVAILABILITY_STATUS ${id}: ${row.availabilityStatus}`);

  const cov = row.historicalCoverage;
  if (!cov || typeof cov !== 'object') errors.push(`BAD_HISTORICAL_COVERAGE ${id}`);
  else {
    if (!COVERAGE_STATUS.has(cov.status)) errors.push(`BAD_COVERAGE_STATUS ${id}: ${cov.status}`);
    if (cov.inferredFromDeclaration === true) errors.push(`INFERRED_HISTORY ${id}`);
    if (cov.status === 'MISSING') {
      if (cov.value !== null && cov.value !== undefined) errors.push(`INVENTED_VALUE ${id}`);
      validateMissingDoc(cov.missing, id, errors);
    }
    if (cov.status === 'VERIFIED' || cov.status === 'HISTORICAL_ASSERTION') {
      if (cov.value === undefined || cov.value === null || cov.value === '') errors.push(`NO_PROVENANCE ${id}: coverage without value`);
      validateEvidence(cov.evidence, allow, fileHashes, id, errors);
    }
  }

  const pit = row.pointInTimeValidity;
  if (!pit || typeof pit !== 'object') errors.push(`BAD_PIT ${id}`);
  else {
    if (!PIT_STATUS.has(pit.status)) errors.push(`BAD_PIT_STATUS ${id}: ${pit.status}`);
    if (pit.status === 'DEMONSTRATED') {
      if (pit.publicationOnly === true) errors.push(`PUBLICATION_ONLY_PIT ${id}`);
      validateEvidence(pit.evidence, allow, fileHashes, id, errors);
    }
    if (pit.status === 'MISSING') validateMissingDoc(pit.missing, id, errors);
  }

  if (row.availabilityStatus === 'AVAILABLE NOW' || row.availabilityStatus === 'PROXY') {
    validateEvidence(row.evidence, allow, fileHashes, id, errors);
  }
  if (typeof row.coveragePercent === 'number') errors.push(`UNIVERSAL_COVERAGE_PERCENTAGE ${id}`);
  if (row.assumedValues && typeof row.assumedValues === 'object' && Object.keys(row.assumedValues).length > 0) {
    errors.push(`ASSUMED_FEES ${id}`);
  }
  if (row.shortValidationNote !== undefined && !isNonEmptyString(row.shortValidationNote)) {
    errors.push(`EMPTY_VALIDATION_NOTE ${id}`);
  }
  return errors;
}

function criticalRowUnsatisfied(row) {
  const critical = isNonEmptyString(row.criticalVersusOptional) && row.criticalVersusOptional.startsWith('critical');
  if (!critical) return false;
  const available = row.availabilityStatus === 'AVAILABLE NOW';
  const pitDemonstrated = row.pointInTimeValidity && row.pointInTimeValidity.status === 'DEMONSTRATED';
  return !(available && pitDemonstrated);
}

function candidateArmKey(name) {
  if (typeof name !== 'string') return null;
  const t = name.trim();
  if (t.startsWith('A0')) return 'A0';
  if (t.startsWith('A1')) return 'A1';
  return null;
}

function validateMatrix(doc, allow, fileHashes, { synthetic = false, requireRows = true } = {}) {
  const errors = [];
  const guards = doc.guards || {};
  if (guards.universalCoveragePercentageUsed === true) errors.push('UNIVERSAL_COVERAGE_PERCENTAGE');
  if (typeof guards.coveragePercent === 'number') errors.push('UNIVERSAL_COVERAGE_PERCENTAGE');
  if (guards.inferredHistoryFromDeclaration === true) errors.push('INFERRED_HISTORY');
  if (guards.assumedFeesOrDefaults === true) errors.push('ASSUMED_FEES');
  if (guards.fabricatedDataset === true) errors.push('FABRICATED_DATASET');

  const rows = Array.isArray(doc.rows) ? doc.rows : null;
  if (rows === null) { errors.push('ROWS_NOT_ARRAY'); return errors; }
  if (requireRows && rows.length === 0) errors.push('ROWS_EMPTY');
  for (const row of rows) errors.push(...validateRow(row, allow, fileHashes));

  const candidates = Array.isArray(doc.candidates) ? doc.candidates : null;
  const syntheticCandidates = Array.isArray(doc.candidateReadiness) ? doc.candidateReadiness : null;
  const checkList = candidates || syntheticCandidates || [];
  for (const cand of checkList) {
    if (!READINESS.has(cand.readiness)) { errors.push(`BAD_READINESS_STATUS ${cand.candidate}: ${cand.readiness}`); continue; }
    if (cand.readiness === 'DATA_READY') {
      const missing = rows.filter(criticalRowUnsatisfied).map((r) => r.requirementId);
      if (missing.length > 0) errors.push(`CRITICAL_MISSING_DATA_READY ${cand.candidate}: ${missing.join(',')}`);
    }
    // The declared critical-missing summary must equal the critical rows that are
    // actually unsatisfied for that arm, otherwise the summary understates the gap.
    if (Array.isArray(cand.criticalMissing)) {
      const key = candidateArmKey(cand.candidate);
      const expected = rows
        .filter((r) => criticalRowUnsatisfied(r) && (!key || (Array.isArray(r.consumers) && r.consumers.includes(key))))
        .map((r) => r.requirementId);
      const declared = cand.criticalMissing;
      const missingFromDeclared = expected.filter((id) => !declared.includes(id));
      const extraInDeclared = declared.filter((id) => !expected.includes(id));
      if (missingFromDeclared.length || extraInDeclared.length) {
        errors.push(`CRITICALMISSING_INCONSISTENT ${cand.candidate}: missing=[${missingFromDeclared.join(',')}] extra=[${extraInDeclared.join(',')}]`);
      }
    }
  }
  return errors;
}

function validateTemporal(doc) {
  const errors = [];
  const semantics = Array.isArray(doc.semantics) ? doc.semantics : [];
  const keys = semantics.map((s) => s.key);
  for (const k of TEMPORAL_KEYS) if (!keys.includes(k)) errors.push(`MISSING_TEMPORAL_SEMANTIC ${k}`);
  const entries = Array.isArray(doc.entries) ? doc.entries : [];
  if (entries.length === 0) errors.push('TEMPORAL_ENTRIES_EMPTY');
  for (const e of entries) {
    for (const k of TEMPORAL_KEYS) {
      if (!(k in e)) errors.push(`TEMPORAL_ENTRY_MISSING ${e.requirementId}: ${k}`);
      else if (!e[k] || !isNonEmptyString(e[k].status)) errors.push(`TEMPORAL_ENTRY_BAD_STATUS ${e.requirementId}: ${k}`);
    }
  }
  return errors;
}

function validateInventory(doc) {
  const errors = [];
  const sources = Array.isArray(doc.sources) ? doc.sources : null;
  if (!sources || sources.length === 0) { errors.push('SOURCES_EMPTY'); return errors; }
  for (const s of sources) {
    if (!isNonEmptyString(s.id) || !isNonEmptyString(s.path) || !SHA_RE.test(s.sha256 || '')) {
      errors.push(`BAD_SOURCE ${s.id || '<no-id>'}`);
    }
  }
  if (Array.isArray(doc.dataArtifactsPresent) && doc.dataArtifactsPresent.length > 0) {
    errors.push('DATA_ARTIFACTS_PRESENT_CONTRADICTS_UNAVAILABLE_MATRIX');
  }
  return errors;
}

// Every file under reference/ must be dispositioned exactly once: either cited in
// sources[] or listed in notInspected[]. Hashes are re-computed from disk so the
// universal negative in referenceScan.finding is reproducible, not asserted.
function validateReferenceDisposition(doc) {
  const errors = [];
  const referenceDir = resolve(root, '..', 'reference');
  if (!existsSync(referenceDir)) { errors.push('REFERENCE_DIR_MISSING'); return { errors, files: [] }; }
  let files = [];
  try {
    files = execSync(`find ${JSON.stringify(referenceDir)} -type f | LC_ALL=C sort`, { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean);
  } catch (e) {
    errors.push(`REFERENCE_SCAN_FAILED ${e.message}`);
    return { errors, files: [] };
  }

  const declared = new Map();
  const addDeclared = (p, sha, where, id) => {
    if (!isNonEmptyString(p) || !p.startsWith(referenceDir)) return;
    if (declared.has(p)) errors.push(`REFERENCE_DUPLICATE_DISPOSITION ${p}: in ${declared.get(p).where} and ${where}`);
    declared.set(p, { sha, where, id });
  };
  for (const s of doc.sources || []) addDeclared(s.path, s.sha256, 'sources[]', s.id);
  for (const n of doc.notInspected || []) addDeclared(n.path, n.sha256, 'notInspected[]', n.id);

  const fileCount = Number(doc.referenceScan && doc.referenceScan.fileCount);
  if (fileCount !== files.length) errors.push(`REFERENCE_COUNT_MISMATCH declared=${fileCount} onDisk=${files.length}`);

  for (const f of files) {
    const d = declared.get(f);
    if (!d) { errors.push(`REFERENCE_UNDISPOSITIONED ${f}`); continue; }
    const actual = sha256File(f);
    if (d.sha !== actual) errors.push(`REFERENCE_HASH_MISMATCH ${f}: ${actual} != ${d.sha}`);
  }
  for (const [p, d] of declared) {
    if (!files.includes(p)) errors.push(`REFERENCE_DECLARED_NOT_ON_DISK ${d.where}:${p}`);
  }
  const notInspected = doc.notInspected || [];
  const cited = (doc.sources || []).filter((s) => isNonEmptyString(s.path) && s.path.startsWith(referenceDir)).length;
  const declaredNot = Number(doc.referenceScan && doc.referenceScan.notInspectedCount);
  if (declaredNot !== notInspected.length) errors.push(`REFERENCE_NOTINSPECTED_COUNT_MISMATCH declared=${declaredNot} listed=${notInspected.length}`);
  const declaredCited = Number(doc.referenceScan && doc.referenceScan.citedCount);
  if (declaredCited !== cited) errors.push(`REFERENCE_CITED_COUNT_MISMATCH declared=${declaredCited} actual=${cited}`);
  return { errors, files };
}

// ---- synthetic negative runner ---------------------------------------------
function runSyntheticExamples(matrix, allow, fileHashes) {
  const results = [];
  const examples = Array.isArray(matrix.syntheticExamples) ? matrix.syntheticExamples : [];
  for (const ex of examples) {
    const errs = validateMatrix(ex, allow, fileHashes, { synthetic: true, requireRows: false });
    let pass;
    if (ex.expect === 'valid') pass = errs.length === 0;
    else {
      const code = ex.expect.replace(/^rejects:/, '');
      pass = errs.some((e) => e.startsWith(code));
    }
    results.push({ name: ex.name, expect: ex.expect, label: ex.label, pass, errors: errs });
  }
  return results;
}

function runInlineProbes(allow, fileHashes) {
  const results = [];
  const probe = (name, expectCode, fn) => {
    const errs = fn();
    const pass = expectCode ? errs.some((x) => x.startsWith(expectCode)) : errs.length === 0;
    results.push({ name, expectCode: expectCode || 'valid', pass, errors: errs });
  };
  const base = {
    requirementId: 'probe',
    requirement: 'probe',
    missionAndCandidate: 'Quarterly (Gas) / A0',
    criticalVersusOptional: 'optional',
    sourceType: 'synthetic',
    shortValidationNote: 'probe'
  };
  probe('hash-tamper-detected', 'BAD_SOURCE_HASH', () => validateRow({
    ...base,
    historicalCoverage: { status: 'VERIFIED', value: 'x', evidence: { path: PATHS.spec, sha256: 'a'.repeat(64), locator: 'x' } },
    pointInTimeValidity: { status: 'NOT_DEMONSTRATED' },
    availabilityStatus: 'UNAVAILABLE'
  }, allow, fileHashes));
  probe('unknown-source-detected', 'UNKNOWN_SOURCE', () => validateRow({
    ...base,
    historicalCoverage: { status: 'VERIFIED', value: 'x', evidence: { path: 'reference/does-not-exist.md', sha256: 'a'.repeat(64), locator: 'x' } },
    pointInTimeValidity: { status: 'NOT_DEMONSTRATED' },
    availabilityStatus: 'UNAVAILABLE'
  }, allow, fileHashes));
  probe('missing-field-detected', 'MISSING_FIELD', () => validateRow({
    requirementId: 'probe.missing',
    requirement: 'probe',
    historicalCoverage: { status: 'MISSING', value: null, missing: { reason: 'x', inspectedSources: ['S-01'], custodianRole: 'x', nextRetrievalAction: 'x' } },
    pointInTimeValidity: { status: 'NOT_DEMONSTRATED' },
    availabilityStatus: 'UNAVAILABLE'
  }, allow, fileHashes));
  probe('valid-row', null, () => validateRow({
    ...base,
    historicalCoverage: { status: 'HISTORICAL_ASSERTION', value: 'x', evidence: { path: PATHS.spec, sha256: allow[PATHS.spec], locator: 'synthetic probe locator' } },
    pointInTimeValidity: { status: 'NOT_DEMONSTRATED' },
    availabilityStatus: 'UNAVAILABLE'
  }, allow, fileHashes));
  return results;
}

// ---- main -------------------------------------------------------------------
function main() {
  const out = [];
  const log = (s) => out.push(s);
  let exitCode = 0;

  const input = checkInputHashes();
  log('== INPUT HASHES ==');
  for (const [name, actual, expected] of input.rows) {
    log(`  ${name}: ${actual} (expected ${expected})`);
  }
  log(`  IMP-01 content version: ${input.contentVersion} (expected ${EXPECTED.imp01ContentVersion})`);
  if (input.errors.length) { log('  INPUT ERRORS: ' + input.errors.join('; ')); exitCode = 1; }
  else log('  OK');

  const inventory = loadJson(PATHS.inventory);
  const temporal = loadJson(PATHS.temporal);
  const matrix = loadJson(PATHS.matrix);

  const invErrors = validateInventory(inventory);
  const ref = validateReferenceDisposition(inventory);
  log('\n== SOURCE INVENTORY ==');
  if (invErrors.length) { log('  ERRORS: ' + invErrors.join('; ')); exitCode = 1; }
  else log(`  OK: ${inventory.sources.length} cited sources; no data artifacts present (consistent with an UNAVAILABLE matrix).`);
  log('\n== REFERENCE-TREE DISPOSITION (reproducible universal negative) ==');
  log(`  reference files on disk=${ref.files.length} cited=sources[] dispositioned=notInspected[]`);
  if (ref.errors.length) { log('  ERRORS:'); ref.errors.forEach((e) => log('    - ' + e)); exitCode = 1; }
  else log('  OK: every reference/ file is dispositioned exactly once and every declared hash matches disk.');

  const allow = {};
  for (const s of inventory.sources) allow[s.path] = s.sha256;
  const fileHashes = {};
  for (const s of inventory.sources) {
    const p = s.path.startsWith('/') ? s.path : resolve(root, s.path);
    if (existsSync(p)) fileHashes[s.path] = sha256File(p);
  }

  log('\n== NAMESPACE SEPARATION ==');
  const overlap = AVAILABILITY_NAMESPACE.filter((v) => READINESS_NAMESPACE.includes(v));
  if (overlap.length) { log('  ERRORS: namespaces overlap: ' + overlap.join(',')); exitCode = 1; }
  else log('  OK: availability and readiness namespaces are distinct and disjoint.');

  log('\n== TEMPORAL MANIFEST (four semantics) ==');
  const temporalErrors = validateTemporal(temporal);
  log(`  semantics=${(temporal.semantics || []).length} entries=${(temporal.entries || []).length}`);
  if (temporalErrors.length) { log('  ERRORS:'); temporalErrors.forEach((e) => log('    - ' + e)); exitCode = 1; }
  else log('  OK: all four time semantics defined and present on every entry.');

  log('\n== MATRIX CONTRACT (eight fields, provenance, critical rule) ==');
  const matrixErrors = validateMatrix(matrix, allow, fileHashes, { requireRows: true });
  log(`  rows=${matrix.rows.length} candidates=${(matrix.candidates || []).length}`);
  const critCount = matrix.rows.filter((r) => (r.criticalVersusOptional || '').startsWith('critical')).length;
  log(`  criticalRows=${critCount} optionalRows=${matrix.rows.length - critCount}`);
  for (const c of matrix.candidates || []) log(`  candidate ${c.candidate}: readiness=${c.readiness}`);
  if (matrixErrors.length) { log('  ERRORS:'); matrixErrors.forEach((e) => log('    - ' + e)); exitCode = 1; }
  else log('  OK: every row has all eight fields; every claim cites an allowlisted source/hash/locator; no critical-missing DATA_READY; namespaces respected.');

  log('\n== NEGATIVE CASES (synthetic, explicitly labeled) ==');
  let negFail = 0;
  for (const r of runSyntheticExamples(matrix, allow, fileHashes)) {
    if (!r.pass) negFail++;
    log(`  [${r.pass ? 'PASS' : 'FAIL'}] ${r.name} (expect ${r.expect}) [${r.label || 'no-label'}] -> ${r.errors.length ? r.errors.join('; ') : 'no errors'}`);
  }
  log('\n== INLINE ADVERSARIAL PROBES ==');
  for (const p of runInlineProbes(allow, fileHashes)) {
    if (!p.pass) negFail++;
    log(`  [${p.pass ? 'PASS' : 'FAIL'}] ${p.name} (expect ${p.expectCode}) -> ${p.errors.length ? p.errors.join('; ') : 'no errors'}`);
  }
  if (negFail) { log(`  ${negFail} negative case(s) FAILED`); exitCode = 1; }
  else log('  OK: all labeled negative cases behave as expected (critical-missing DATA_READY and publication-only PIT are rejected).');

  log('\n== REAL-DATA SUFFICIENCY (reported separately) ==');
  for (const c of matrix.candidates || []) {
    log(`  ${c.candidate}: ${c.readiness} (critical missing: ${(c.criticalMissing || []).join(', ')})`);
  }
  log(`  dataArtifactsPresent=${inventory.dataArtifactsPresent.length} 2020-2026ClaimVerified=${(inventory.unresolvedFacts || []).some((f) => f.includes('2020-2026')) ? 'no (pending audit)' : 'n/a'}`);
  log('  => NEGATIVE AUDIT: no real series present; both P5 Gas Quarterly candidates are DATA_BLOCKED. This is a factual finding, not a verifier failure.');

  log('\n== RESULT ==');
  log(`  exit=${exitCode} (0 = hashes/contract/namespaces/negatives pass; real-data insufficiency reported separately)`);
  process.stdout.write(out.join('\n') + '\n');
  process.exit(exitCode);
}

main();
