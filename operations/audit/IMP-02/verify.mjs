#!/usr/bin/env node
// IMP-02 / ST-02.1 verifier.
// Checks input hashes, inventory integrity, field provenance and the
// ownership/conservation invariants required by the WORK-PACKET, including
// explicit negative cases. Fails closed when an inspected inventory source is
// unavailable or altered. Real-data insufficiency is reported separately and
// does not by itself fail the run.
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const NL = String.fromCharCode(10);
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
  inventory: 'operations/audit/IMP-02/source-inventory.json',
  campaign: 'operations/audit/IMP-02/campaign-contract.json',
  ownership: 'operations/audit/IMP-02/coverage-ownership.json',
  depReport: 'operations/audit/IMP-02/dep-01-04-report.json'
};

const VALID_STATUS = new Set(['VERIFIED', 'HISTORICAL_ASSERTION', 'MISSING', 'SYNTHETIC_EXAMPLE']);
const SHA_RE = /^[0-9a-f]{64}$/;
const TERMINAL_VALID = 'VERIFIED';

// Real filesystem adapter, and the injection seam used by the regression probes.
const realFs = { exists: existsSync, read: readFileSync };

function sha256File(p) {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}

function resolveSourcePath(p) {
  return p.startsWith('/') ? p : resolve(root, p);
}

function loadJson(rel) {
  const p = resolve(root, rel);
  if (!existsSync(p)) throw new Error('missing artifact: ' + rel);
  return JSON.parse(readFileSync(p, 'utf8'));
}

// ---- inventory integrity (fail closed) ------------------------------------
// Every inspected inventory source must exist and match its pinned hash,
// regardless of whether any fact cites it. Absence findings (S-07, S-06) are
// only trustworthy if the source that supports them is intact.
function verifyInventoryIntegrity(sources, fsx) {
  const adapter = fsx || realFs;
  const errors = [];
  for (const s of sources) {
    const p = resolveSourcePath(s.path);
    if (!adapter.exists(p)) {
      errors.push('MISSING_INVENTORY_SOURCE ' + s.id + ' ' + s.path);
      continue;
    }
    let actual = null;
    try {
      actual = createHash('sha256').update(adapter.read(p)).digest('hex');
    } catch (e) {
      errors.push('UNREADABLE_INVENTORY_SOURCE ' + s.id + ' ' + s.path);
      continue;
    }
    if (actual !== s.sha256) {
      errors.push('INVENTORY_SOURCE_DRIFT ' + s.id + ' ' + s.path + ' ' + actual + ' != ' + s.sha256);
    }
  }
  return errors;
}

// ---- input hash checks -----------------------------------------------------
function checkInputHashes() {
  const errors = [];
  const checks = [
    ['SPEC', PATHS.spec, EXPECTED.spec],
    ['IMP-01-IMP_RECEIPT.json', PATHS.imp01Receipt, EXPECTED.imp01Receipt],
    ['baseline-manifest.json', PATHS.baselineManifest, EXPECTED.baselineManifest]
  ];
  for (const [name, rel, expected] of checks) {
    const p = resolve(root, rel);
    if (!existsSync(p)) { errors.push('MISSING_INPUT ' + rel); continue; }
    const actual = sha256File(p);
    if (actual !== expected) errors.push('INPUT_HASH_MISMATCH ' + name + ': ' + actual + ' != ' + expected);
  }
  // Accepted IMP-01 content version, algorithm declared in its receipt:
  // sha256 of the path-sorted sha256sum listing.
  const cmd = 'find src/contracts test/contracts operations/audit/IMP-01/test-run.txt -type f | LC_ALL=C sort | xargs sha256sum | sha256sum';
  let contentVersion = null;
  try {
    contentVersion = execSync(cmd, { cwd: root, encoding: 'utf8' }).trim().split(' ').filter(Boolean)[0];
  } catch (e) {
    errors.push('CONTENT_VERSION_CMD_FAILED ' + e.message);
  }
  if (contentVersion && contentVersion !== EXPECTED.imp01ContentVersion) {
    errors.push('CONTENT_VERSION_MISMATCH ' + contentVersion + ' != ' + EXPECTED.imp01ContentVersion);
  }
  return { errors, contentVersion };
}

// ---- provenance of a single fact ------------------------------------------
function validateFact(fact, allow, fileHashes, opts) {
  const options = opts || {};
  const errors = [];
  const id = fact.factId || '<no-factId>';
  if (!VALID_STATUS.has(fact.status)) {
    errors.push('BAD_STATUS ' + id + ': ' + fact.status);
    return errors;
  }
  if (options.synthetic && fact.status !== 'SYNTHETIC_EXAMPLE') {
    errors.push('SYNTHETIC_NOT_LABELED ' + id + ': status ' + fact.status + ' in synthetic context');
  }
  if (fact.status === 'VERIFIED' || fact.status === 'HISTORICAL_ASSERTION') {
    if (!fact.source || typeof fact.source !== 'object') {
      errors.push('NO_PROVENANCE ' + id + ': ' + fact.status + ' without source');
    } else {
      const src = fact.source;
      if (!src.path || !src.sha256 || !src.locator) {
        errors.push('NO_PROVENANCE ' + id + ': source missing path/sha256/locator');
      } else if (!SHA_RE.test(src.sha256)) {
        errors.push('BAD_SOURCE_HASH ' + id + ': malformed sha256');
      } else if (!(src.path in allow)) {
        errors.push('UNKNOWN_SOURCE ' + id + ': ' + src.path);
      } else if (src.sha256 !== allow[src.path]) {
        errors.push('BAD_SOURCE_HASH ' + id + ': ' + src.sha256 + ' != inventory ' + allow[src.path]);
      } else if (fileHashes[src.path] && fileHashes[src.path] !== src.sha256) {
        errors.push('SOURCE_HASH_DRIFT ' + id + ': ' + src.path);
      }
      if (fact.value === undefined || fact.value === null || fact.value === '') {
        errors.push('NO_PROVENANCE ' + id + ': ' + fact.status + ' without value');
      }
    }
  }
  if (fact.status === 'MISSING') {
    if (fact.value !== null && fact.value !== undefined) {
      errors.push('INVENTED_VALUE ' + id + ': MISSING fact carries value ' + JSON.stringify(fact.value));
    }
    const m = fact.missing;
    if (!m || !m.reason || !Array.isArray(m.inspectedSources) || m.inspectedSources.length === 0 || !m.custodianRole || !m.nextRetrievalAction) {
      errors.push('MISSING_NOT_DOCUMENTED ' + id);
    }
  }
  return errors;
}

function validateFacts(facts, allow, fileHashes, opts) {
  const errors = [];
  if (!Array.isArray(facts)) return ['FACTS_NOT_ARRAY'];
  for (const f of facts) errors.push.apply(errors, validateFact(f, allow, fileHashes, opts));
  return errors;
}

// ---- conservation / guard invariants --------------------------------------
function validateReconciliation(r) {
  const errors = [];
  if (!r || typeof r !== 'object') return ['RECONCILIATION_MISSING'];
  const o = r.openingObligation;
  const e = r.executedVolume;
  const rem = r.remainingVolume;
  const g = r.guards || {};
  if (g.totalObligationIsPerBuySizing === true) errors.push('TOTAL_SIZING_CONFLATION');
  if (g.benchmarkWindowIsExecutionPermission === true) errors.push('BENCHMARK_WINDOW_AS_PERMISSION');
  if (g.unknownTerminalRuleFabricatesCloseOutFill === true) errors.push('UNKNOWN_TERMINAL_RULE_FABRICATION_FLAG');

  if (r.evaluated === true) {
    for (const pair of [['openingObligation', o], ['executedVolume', e], ['remainingVolume', rem]]) {
      if (typeof pair[1] !== 'number' || Number.isNaN(pair[1])) errors.push('EVALUATED_WITH_MISSING_NUMBERS ' + pair[0]);
    }
    if (!r.unit) errors.push('EVALUATED_WITH_MISSING_UNIT');
    if (typeof o === 'number' && typeof e === 'number' && typeof rem === 'number' && o !== e + rem) {
      errors.push('CONSERVATION_VIOLATION ' + o + ' != ' + e + ' + ' + rem);
    }
  } else {
    for (const pair of [['openingObligation', o], ['executedVolume', e], ['remainingVolume', rem]]) {
      if (pair[1] !== null && pair[1] !== undefined) errors.push('UNEVALUATED_WITH_NUMBERS ' + pair[0]);
    }
  }
  if (r.closeOutFill !== null && r.closeOutFill !== undefined && r.terminalRuleStatus !== TERMINAL_VALID) {
    errors.push('CLOSEOUT_WITH_UNKNOWN_TERMINAL_RULE');
  }
  if (r.evaluated === true && typeof rem === 'number' && rem > 0 && r.terminalRuleStatus !== TERMINAL_VALID && r.coverageStatus === 'COVERED') {
    errors.push('COVERAGE_INCOMPLETE_EXPECTED');
  }
  return errors;
}

// ---- ownership / no double counting ---------------------------------------
function validateOwnership(doc) {
  const errors = [];
  const obligations = Array.isArray(doc.obligations) ? doc.obligations : null;
  const fills = Array.isArray(doc.fills) ? doc.fills : null;
  if (obligations === null) errors.push('OBLIGATIONS_NOT_ARRAY');
  if (fills === null) errors.push('FILLS_NOT_ARRAY');
  const fillIds = new Set((fills || []).map((f) => f.fillId));
  const refCount = new Map();
  for (const ob of obligations || []) {
    for (const fillId of ob.fills || []) {
      if (!fillIds.has(fillId)) errors.push('UNKNOWN_FILL ' + ob.obligationId + ' -> ' + fillId);
      refCount.set(fillId, (refCount.get(fillId) || 0) + 1);
    }
  }
  for (const entry of refCount) {
    if (entry[1] > 1) errors.push('DUPLICATE_OWNERSHIP ' + entry[0] + ' referenced ' + entry[1] + ' times');
  }
  const rel = doc.relationMonthlyQuarterly;
  if (rel && rel.status === 'MISSING') {
    const m = rel.missing;
    if (!m || !m.reason || !Array.isArray(m.inspectedSources) || m.inspectedSources.length === 0 || !m.custodianRole || !m.nextRetrievalAction) {
      errors.push('MISSING_NOT_DOCUMENTED relationMonthlyQuarterly');
    }
  }
  return errors;
}

// ---- inline adversarial probes --------------------------------------------
function runInlineProbes(inventory, allow, fileHashes) {
  const results = [];
  const probe = (name, expectCode, fn) => {
    const errs = fn();
    const hit = expectCode ? errs.some((x) => x.startsWith(expectCode)) : errs.length === 0;
    results.push({ name, expectCode: expectCode || 'valid', pass: hit, errors: errs });
  };
  probe('hash-tamper-detected', 'BAD_SOURCE_HASH', () =>
    validateFact({ factId: 'probe.badHash', status: 'VERIFIED', value: 'x', unit: null, source: { path: PATHS.spec, sha256: 'a'.repeat(64), locator: 'x' } }, allow, fileHashes));
  probe('unknown-source-detected', 'UNKNOWN_SOURCE', () =>
    validateFact({ factId: 'probe.unknown', status: 'VERIFIED', value: 'x', unit: null, source: { path: 'reference/does-not-exist.md', sha256: 'a'.repeat(64), locator: 'x' } }, allow, fileHashes));
  probe('bad-status-detected', 'BAD_STATUS', () =>
    validateFact({ factId: 'probe.status', status: 'PROBABLY_TRUE', value: 'x', source: null }, allow, fileHashes));
  probe('valid-provenance', null, () =>
    validateFact({ factId: 'probe.ok', status: 'HISTORICAL_ASSERTION', value: '60 MW', unit: 'MW', source: { path: PATHS.spec, sha256: allow[PATHS.spec], locator: 'synthetic probe locator' } }, allow, fileHashes));

  const s05 = inventory.sources.find((s) => s.id === 'S-05');
  const s07 = inventory.sources.find((s) => s.id === 'S-07');
  probe('missing-cited-source-detected', 'MISSING_INVENTORY_SOURCE', () =>
    verifyInventoryIntegrity([s05], { exists: () => false, read: () => Buffer.from('') }));
  probe('altered-absence-source-detected', 'INVENTORY_SOURCE_DRIFT', () =>
    verifyInventoryIntegrity([s07], {
      exists: () => true,
      read: (p) => (p === resolveSourcePath(s07.path) ? Buffer.from('synthetic changed bytes') : readFileSync(p))
    }));
  probe('missing-other-inspected-source-detected', 'MISSING_INVENTORY_SOURCE', () =>
    verifyInventoryIntegrity(inventory.sources, {
      exists: (p) => (p === resolveSourcePath(s05.path) ? false : existsSync(p)),
      read: (p) => readFileSync(p)
    }));
  probe('intact-inventory-passes', null, () => verifyInventoryIntegrity(inventory.sources));
  return results;
}

// ---- main ------------------------------------------------------------------
function main() {
  const out = [];
  const log = (s) => out.push(s);
  let exitCode = 0;

  const input = checkInputHashes();
  log('== INPUT HASHES ==');
  for (const [name, rel, expected] of [['SPEC', PATHS.spec, EXPECTED.spec], ['IMP-01-IMP_RECEIPT.json', PATHS.imp01Receipt, EXPECTED.imp01Receipt], ['baseline-manifest.json', PATHS.baselineManifest, EXPECTED.baselineManifest]]) {
    const p = resolve(root, rel);
    log('  ' + name + ': ' + (existsSync(p) ? sha256File(p) : 'MISSING') + ' (expected ' + expected + ')');
  }
  log('  IMP-01 content version: ' + input.contentVersion + ' (expected ' + EXPECTED.imp01ContentVersion + ')');
  if (input.errors.length) { log('  INPUT ERRORS: ' + input.errors.join('; ')); exitCode = 1; }
  else log('  OK');

  const inventory = loadJson(PATHS.inventory);
  const campaign = loadJson(PATHS.campaign);
  const ownership = loadJson(PATHS.ownership);
  const depReport = loadJson(PATHS.depReport);

  const allow = {};
  for (const s of inventory.sources) allow[s.path] = s.sha256;
  const fileHashes = {};
  for (const s of inventory.sources) {
    const p = resolveSourcePath(s.path);
    if (existsSync(p)) fileHashes[s.path] = sha256File(p);
  }

  log(NL + '== INVENTORY INTEGRITY (fail closed) ==');
  const integrityErrors = verifyInventoryIntegrity(inventory.sources);
  log('  sources=' + inventory.sources.length);
  if (integrityErrors.length) { log('  ERRORS:'); integrityErrors.forEach((e) => log('    - ' + e)); exitCode = 1; }
  else log('  OK: every inspected inventory source exists and matches its pinned hash.');

  log(NL + '== PROVENANCE (campaign-contract.json facts) ==');
  const factErrors = validateFacts(campaign.facts, allow, fileHashes);
  const missingCount = campaign.facts.filter((f) => f.status === 'MISSING').length;
  const historicalCount = campaign.facts.filter((f) => f.status === 'HISTORICAL_ASSERTION').length;
  const verifiedCount = campaign.facts.filter((f) => f.status === 'VERIFIED').length;
  log('  facts=' + campaign.facts.length + ' verified=' + verifiedCount + ' historical=' + historicalCount + ' missing=' + missingCount);
  if (factErrors.length) { log('  ERRORS:'); factErrors.forEach((e) => log('    - ' + e)); exitCode = 1; }
  else log('  OK: every asserted fact cites an allowlisted source/hash/locator; every missing fact is documented.');

  log(NL + '== CONSERVATION / GUARD INVARIANTS (campaign-contract.reconciliation) ==');
  const reconErrors = validateReconciliation(campaign.reconciliation);
  if (reconErrors.length) { log('  ERRORS:'); reconErrors.forEach((e) => log('    - ' + e)); exitCode = 1; }
  else log('  OK: no fabricated numbers, no sizing/total conflation, no benchmark-window-as-permission, no close-out fill for an unknown terminal rule.');

  log(NL + '== OWNERSHIP / NO DOUBLE COUNTING (coverage-ownership.json) ==');
  const ownErrors = validateOwnership(ownership);
  if (ownErrors.length) { log('  ERRORS:'); ownErrors.forEach((e) => log('    - ' + e)); exitCode = 1; }
  else log('  OK: no fill belongs to more than one obligation; missing relation is documented.');

  log(NL + '== NEGATIVE CASES (synthetic, explicitly labeled) ==');
  let negFail = 0;
  const runNegatives = (examples, validator) => {
    for (const ex of examples) {
      const errs = validator(ex);
      let pass;
      if (ex.expect === 'valid') pass = errs.length === 0;
      else {
        const code = ex.expect.replace('rejects:', '');
        pass = errs.some((e) => e.startsWith(code));
      }
      if (!pass) negFail++;
      log('  [' + (pass ? 'PASS' : 'FAIL') + '] ' + ex.name + ' (expect ' + ex.expect + ') -> ' + (errs.length ? errs.join('; ') : 'no errors'));
    }
  };
  runNegatives(campaign.syntheticExamples || [], (ex) => {
    const errs = [];
    if (ex.facts) errs.push.apply(errs, validateFacts(ex.facts, allow, fileHashes, { synthetic: true }));
    if (ex.reconciliation) errs.push.apply(errs, validateReconciliation(ex.reconciliation));
    return errs;
  });
  runNegatives(ownership.syntheticExamples || [], (ex) => validateOwnership(ex));

  log(NL + '== INLINE ADVERSARIAL PROBES ==');
  for (const p of runInlineProbes(inventory, allow, fileHashes)) {
    if (!p.pass) negFail++;
    log('  [' + (p.pass ? 'PASS' : 'FAIL') + '] ' + p.name + ' (expect ' + p.expectCode + ') -> ' + (p.errors.length ? p.errors.join('; ') : 'no errors'));
  }
  if (negFail) { log('  ' + negFail + ' negative case(s) FAILED'); exitCode = 1; }
  else log('  OK: all negative cases behave as expected.');

  log(NL + '== REAL-DATA INSUFFICIENCY (reported separately) ==');
  const insufficient = campaign.campaignIdentified === false && campaign.reconciliation.evaluated === false;
  log('  campaignIdentified=' + campaign.campaignIdentified + ' reconciliation.evaluated=' + campaign.reconciliation.evaluated + ' status=' + campaign.reconciliation.status);
  log('  coverageStatus=' + campaign.reconciliation.coverageStatus + ' terminalRuleStatus=' + campaign.reconciliation.terminalRuleStatus);
  log('  unresolvedCanonicalParentCriteria=' + (depReport.unmetCanonicalParentCriteria || []).length);
  log('  => ' + (insufficient ? 'INSUFFICIENT REAL DATA: campaign contract cannot be reconciled; documented absence preserved.' : 'real data sufficient for reconciliation.'));
  log('  (Insufficiency is a factual finding, not a verifier failure.)');

  log(NL + '== RESULT ==');
  log('  exit=' + exitCode + ' (0 = hashes/inventory/provenance/invariants/negatives pass; real-data insufficiency reported separately)');
  process.stdout.write(out.join(NL) + NL);
  process.exit(exitCode);
}

main();