#!/usr/bin/env node
// IMP-08 / ST-08.1 fixture-oracle verifier.
// Validates: (1) input hashes (SPEC, accepted IMP-01 receipt, baseline manifest and
// IMP-01 content version); (2) fixture identity/schema, unique IDs and full coverage
// of the twelve §19.3.1 canonical rows; (3) synthetic provenance and explicit
// undefined reasons; (4) the literal expected results against the documented
// independent arithmetic of independent-calculations.md.
//
// This is a fixture-oracle checker, NOT a production B/H/V or scoring engine. It
// contains only the small arithmetic needed to re-check the hand-worked fixtures.
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..', '..');

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
  fixtures: 'operations/audit/IMP-08/fixture-oracle/fixtures.json',
  calculations: 'operations/audit/IMP-08/fixture-oracle/independent-calculations.md'
};

const CANONICAL_CASES = ['C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C07', 'C08', 'C09', 'C10', 'C11', 'C12'];
const REQUIRED_FIELDS = ['fixtureId', 'canonicalCase', 'specSource', 'synthetic', 'classification', 'units', 'inputs', 'expected', 'derivation'];
const TOL = 1e-9;

function sha256File(p) { return createHash('sha256').update(readFileSync(p)).digest('hex'); }
function loadJson(rel) {
  const p = resolve(root, rel);
  if (!existsSync(p)) throw new Error(`missing artifact: ${rel}`);
  return JSON.parse(readFileSync(p, 'utf8'));
}
function isNonEmptyString(v) { return typeof v === 'string' && v.trim().length > 0; }
function near(a, b) { return Math.abs(a - b) <= TOL; }
function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

function checkInputHashes() {
  const errors = [];
  const rows = [];
  const checks = [
    ['SPEC', PATHS.spec, EXPECTED.spec],
    ['IMP-01-IMP_RECEIPT.json', PATHS.imp01Receipt, EXPECTED.imp01Receipt],
    ['baseline-manifest.json', PATHS.baselineManifest, EXPECTED.baselineManifest]
  ];
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

// ---- scoring arithmetic (fixture oracle only) -------------------------------
function computeScoring(values) {
  const nPlus = values.filter((v) => v > 0).length;
  const nMinus = values.filter((v) => v < 0).length;
  const nNeutral = values.filter((v) => v === 0).length;
  const n = nPlus + nMinus;
  const nTotal = values.length;
  const sum = values.reduce((a, b) => a + b, 0);
  const out = { nPlus, nMinus, nNeutral, n, nTotal, p: null, l: null, G: null, A: null, mu: null, R: null, C: null, sigmaDown: null, sortino: null, screenPass: false };
  if (n === 0) return out;
  out.p = nPlus / n;
  out.l = nMinus / n;
  out.mu = sum / n;
  const winners = values.filter((v) => v > 0);
  const losers = values.filter((v) => v < 0);
  if (winners.length > 0) out.G = winners.reduce((a, b) => a + b, 0) / winners.length;
  if (losers.length > 0) out.A = losers.reduce((a, b) => a + Math.abs(b), 0) / losers.length;
  if (out.G !== null && out.A !== null && out.A !== 0) out.R = out.G / out.A;
  if (out.p !== null && out.l !== null && out.l !== 0 && out.R !== null) out.C = (out.p / out.l) * out.R;
  if (n >= 2) {
    const sumSq = values.reduce((a, b) => a + Math.min(b, 0) ** 2, 0);
    out.sigmaDown = Math.sqrt(sumSq / (n - 1));
  }
  if (out.mu !== null && out.sigmaDown !== null && out.sigmaDown !== 0) out.sortino = out.mu / out.sigmaDown;
  out.screenPass = out.sortino !== null && out.sortino > 1;
  return out;
}

function compareScoring(actual, expected) {
  const errors = [];
  const fields = ['nPlus', 'nMinus', 'n', 'nNeutral', 'nTotal', 'p', 'l', 'G', 'A', 'mu', 'R', 'C', 'sigmaDown', 'sortino', 'screenPass'];
  for (const f of fields) {
    const exp = expected[f];
    const act = actual[f];
    if (exp === null || exp === undefined) {
      if (act !== null) errors.push(`SCORING_UNDEFINED_MISMATCH ${f}: computed ${act}, expected undefined`);
    } else if (typeof exp === 'boolean') {
      if (act !== exp) errors.push(`SCORING_VALUE_MISMATCH ${f}: computed ${act}, expected ${exp}`);
    } else if (typeof exp === 'number') {
      if (typeof act !== 'number' || !near(act, exp)) errors.push(`SCORING_VALUE_MISMATCH ${f}: computed ${act}, expected ${exp}`);
    }
  }
  return errors;
}

// ---- per-fixture checks ------------------------------------------------------
function validateShape(fx) {
  const errors = [];
  const id = fx && fx.fixtureId ? fx.fixtureId : '<no-id>';
  if (!fx || typeof fx !== 'object') return ['FIXTURE_NOT_OBJECT'];
  for (const f of REQUIRED_FIELDS) {
    if (!(f in fx)) errors.push(`MISSING_FIELD ${id}: ${f}`);
  }
  if (!isNonEmptyString(fx.fixtureId)) errors.push(`BAD_FIXTURE_ID ${id}`);
  if (fx.synthetic !== true) errors.push(`NOT_SYNTHETIC ${id}`);
  if (!isNonEmptyString(fx.derivation)) errors.push(`NO_DERIVATION ${id}`);
  if (!fx.specSource || !isNonEmptyString(fx.specSource.section) || !isNonEmptyString(fx.specSource.locator)) {
    errors.push(`NO_SPEC_SOURCE ${id}`);
  }
  if (!fx.units || typeof fx.units !== 'object' || Object.keys(fx.units).length === 0) errors.push(`NO_UNITS ${id}`);
  if (!fx.inputs || typeof fx.inputs !== 'object') errors.push(`NO_INPUTS ${id}`);
  if (!fx.expected || typeof fx.expected !== 'object') errors.push(`NO_EXPECTED ${id}`);
  else if (fx.expected.defined === false && !isNonEmptyString(fx.expected.undefinedReason)) {
    errors.push(`UNDEFINED_WITHOUT_REASON ${id}`);
  }
  if (fx.check && fx.check.kind === 'scoring' && fx.expected && fx.expected.defined === false) {
    const src = (fx.check.expected && typeof fx.check.expected === 'object') ? fx.check.expected : fx.expected;
    const anyNull = ['G', 'A', 'R', 'C', 'sigmaDown', 'sortino', 'p', 'mu'].some((k) => src[k] === null);
    if (!anyNull) errors.push(`UNDEFINED_WITHOUT_NULL_FIELD ${id}`);
  }
  return errors;
}

function checkArithmetic(fx) {
  const errors = [];
  const id = fx.fixtureId;
  const kind = fx.check && fx.check.kind;
  if (!kind) { errors.push(`NO_CHECK_KIND ${id}`); return errors; }
  if (kind === 'proxy') {
    const { trades, midpoints, tradesMean, midpointsMean, expectedProxy } = fx.check;
    const computed = trades && midpoints ? 0.75 * tradesMean + 0.25 * midpointsMean
      : trades ? tradesMean
        : midpoints ? midpointsMean
          : null;
    if (expectedProxy === null) {
      if (computed !== null) errors.push(`PROXY_UNDEFINED_MISMATCH ${id}: computed ${computed}`);
      if (fx.expected.proxyR !== null) errors.push(`PROXY_EXPECTED_MISMATCH ${id}`);
    } else if (computed === null || !near(computed, expectedProxy) || !near(fx.expected.proxyR, expectedProxy)) {
      errors.push(`PROXY_VALUE_MISMATCH ${id}: computed ${computed}, check ${expectedProxy}, expected ${fx.expected.proxyR}`);
    }
  } else if (kind === 'benchmark') {
    const refs = fx.check.references || [];
    const selected = refs.map((r) => r.selected).filter((v) => v !== null && v !== undefined);
    const count = selected.length;
    const sum = selected.reduce((a, b) => a + b, 0);
    const B = count === 0 ? null : sum / count;
    if (!near(B, fx.check.expectedB) || count !== fx.check.expectedCount || !near(sum, fx.check.expectedSum)) {
      errors.push(`BENCHMARK_MISMATCH ${id}: computed B=${B} count=${count} sum=${sum}, expected B=${fx.check.expectedB} count=${fx.check.expectedCount} sum=${fx.check.expectedSum}`);
    }
    if (!near(fx.expected.B, fx.check.expectedB) || fx.expected.count !== count) {
      errors.push(`BENCHMARK_EXPECTED_MISMATCH ${id}`);
    }
  } else if (kind === 'window') {
    const start = Date.parse(fx.check.windowStart);
    const end = Date.parse(fx.check.windowEnd);
    if (Number.isNaN(start) || Number.isNaN(end)) { errors.push(`BAD_WINDOW ${id}`); return errors; }
    for (const c of fx.check.cases || []) {
      const t = Date.parse(c.timestamp);
      if (Number.isNaN(t)) { errors.push(`BAD_WINDOW_TIMESTAMP ${id}: ${c.timestamp}`); continue; }
      const included = t >= start && t < end;
      if (included !== c.included) errors.push(`WINDOW_BOUNDARY_MISMATCH ${id}: ${c.timestamp} computed ${included}, expected ${c.included}`);
    }
  } else if (kind === 'fallback') {
    const [ch, cm] = fx.check.centerLocalTime.split(':').map(Number);
    const center = ch * 60 + cm;
    const radius = fx.check.radiusMinutes;
    for (const c of fx.check.cases || []) {
      const [h, m, s] = c.localTime.split(':').map(Number);
      const minutes = h * 60 + m + s / 60;
      const included = Math.abs(minutes - center) <= radius + TOL;
      if (included !== c.included) errors.push(`FALLBACK_BOUNDARY_MISMATCH ${id}: ${c.localTime} computed ${included}, expected ${c.included}`);
    }
  } else if (kind === 'bhv') {
    const computed = fx.check.unitsCompatible ? fx.check.B - fx.check.H : null;
    if (fx.check.expectedDefined) {
      if (computed === null || !near(computed, fx.check.expectedV) || !near(fx.expected.V, fx.check.expectedV)) {
        errors.push(`BHV_VALUE_MISMATCH ${id}: computed ${computed}, expected ${fx.check.expectedV}`);
      }
    } else if (computed !== null) {
      errors.push(`BHV_UNDEFINED_MISMATCH ${id}: computed ${computed}`);
    }
  } else if (kind === 'scoring') {
    const actual = computeScoring(fx.check.values);
    errors.push(...compareScoring(actual, fx.check.expected));
    if (fx.expected.defined === true && actual.sortino === null) errors.push(`SCORING_DEFINED_BUT_NULL ${id}`);
    if (fx.expected.defined === false && !isNonEmptyString(fx.expected.undefinedReason)) errors.push(`SCORING_UNDEFINED_WITHOUT_REASON ${id}`);
  } else if (kind === 'undefined') {
    if (fx.expected.defined !== false || !isNonEmptyString(fx.expected.undefinedReason)) {
      errors.push(`UNDEFINED_CASE_NOT_DECLARED ${id}`);
    }
  } else if (kind === 'declarative') {
    if (!fx.expected || typeof fx.expected.defined !== 'boolean') errors.push(`DECLARATIVE_NO_DEFINED_FLAG ${id}`);
  } else {
    errors.push(`UNKNOWN_CHECK_KIND ${id}: ${kind}`);
  }
  return errors;
}

function validateCollection(doc, calculationsText) {
  const errors = [];
  if (doc.syntheticThroughout !== true) errors.push('NOT_LABELLED_SYNTHETIC');
  if (doc.epsilonUsed !== false) errors.push('EPSILON_USED');
  if (doc.annualizationUsed !== false) errors.push('ANNUALIZATION_USED');
  if (!doc.specIdentity || doc.specIdentity.sha256 !== EXPECTED.spec) {
    const alt = doc.packetSubtaskParentIdentity && doc.packetSubtaskParentIdentity.specSha256;
    if (alt !== EXPECTED.spec) errors.push('SPEC_IDENTITY_MISMATCH');
  }
  const fixtures = Array.isArray(doc.fixtures) ? doc.fixtures : null;
  if (!fixtures || fixtures.length === 0) { errors.push('FIXTURES_EMPTY'); return errors; }

  const seen = new Set();
  for (const fx of fixtures) {
    if (seen.has(fx.fixtureId)) errors.push(`DUPLICATE_FIXTURE_ID ${fx.fixtureId}`);
    seen.add(fx.fixtureId);
    errors.push(...validateShape(fx));
    errors.push(...checkArithmetic(fx));
    if (isNonEmptyString(fx.fixtureId) && !calculationsText.includes(fx.fixtureId)) {
      errors.push(`NOT_DOCUMENTED_IN_CALCULATIONS ${fx.fixtureId}`);
    }
  }

  const present = new Set(fixtures.map((f) => f.canonicalCase));
  for (const c of CANONICAL_CASES) {
    if (!present.has(c)) errors.push(`CANONICAL_CASE_UNCOVERED ${c}`);
  }
  return errors;
}

// ---- negative probes ---------------------------------------------------------
function runNegativeProbes(doc, calculationsText) {
  const results = [];
  const probe = (name, expectCode, mutate) => {
    const copy = deepClone(doc);
    mutate(copy);
    const errs = validateCollection(copy, calculationsText);
    const pass = errs.some((e) => e.startsWith(expectCode));
    results.push({ name, expectCode, pass, errors: errs });
  };
  probe('duplicate-fixture-id-detected', 'DUPLICATE_FIXTURE_ID', (d) => {
    d.fixtures.push(deepClone(d.fixtures[0]));
  });
  probe('tampered-proxy-detected', 'PROXY_VALUE_MISMATCH', (d) => {
    const f = d.fixtures.find((x) => x.fixtureId === 'FX-C01-PROXY-MIXED');
    f.check.expectedProxy = 102;
    f.expected.proxyR = 102;
  });
  probe('unsynthetic-fixture-detected', 'NOT_SYNTHETIC', (d) => {
    d.fixtures[0].synthetic = false;
  });
  probe('missing-canonical-case-detected', 'CANONICAL_CASE_UNCOVERED', (d) => {
    d.fixtures = d.fixtures.filter((x) => x.canonicalCase !== 'C11');
  });
  probe('undefined-without-reason-detected', 'UNDEFINED_WITHOUT_REASON', (d) => {
    const f = d.fixtures.find((x) => x.fixtureId === 'FX-C12-N-LT-2');
    f.expected.undefinedReason = '';
  });
  probe('scoring-tamper-detected', 'SCORING_VALUE_MISMATCH', (d) => {
    const f = d.fixtures.find((x) => x.fixtureId === 'FX-C09-SCORING-POS-NEG');
    f.check.expected.sortino = 2.0;
    f.expected.sortino = 2.0;
  });
  probe('undocumented-fixture-detected', 'NOT_DOCUMENTED_IN_CALCULATIONS', (d) => {
    d.fixtures[0].fixtureId = 'FX-UNDOCUMENTED-PROBE';
  });
  return results;
}

// ---- main --------------------------------------------------------------------
function main() {
  const out = [];
  const log = (s) => out.push(s);
  let exitCode = 0;

  const input = checkInputHashes();
  log('== INPUT HASHES ==');
  for (const [name, actual, expected] of input.rows) log(`  ${name}: ${actual} (expected ${expected})`);
  log(`  IMP-01 content version: ${input.contentVersion} (expected ${EXPECTED.imp01ContentVersion})`);
  if (input.errors.length) { log('  INPUT ERRORS: ' + input.errors.join('; ')); exitCode = 1; }
  else log('  OK');

  const doc = loadJson(PATHS.fixtures);
  const calculationsText = readFileSync(resolve(root, PATHS.calculations), 'utf8');

  log('\n== FIXTURE COLLECTION ==');
  const errors = validateCollection(doc, calculationsText);
  const casesPresent = [...new Set(doc.fixtures.map((f) => f.canonicalCase))].sort();
  const kinds = {};
  for (const f of doc.fixtures) {
    const k = f.check && f.check.kind ? f.check.kind : '<none>';
    kinds[k] = (kinds[k] || 0) + 1;
  }
  log(`  fixtures=${doc.fixtures.length}`);
  log(`  canonical cases covered: ${casesPresent.join(',')} (required ${CANONICAL_CASES.join(',')})`);
  log(`  check kinds: ${Object.entries(kinds).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  log(`  undefined/partial fixtures: ${doc.fixtures.filter((f) => f.expected.defined === false).map((f) => f.fixtureId).join(', ')}`);
  if (errors.length) { log('  ERRORS:'); errors.forEach((e) => log('    - ' + e)); exitCode = 1; }
  else log('  OK: unique IDs, full canonical coverage, synthetic labels, explicit undefined reasons, arithmetic agrees with the documented calculations.');

  log('\n== NEGATIVE PROBES (tampered copies, never written to disk) ==');
  let negFail = 0;
  for (const r of runNegativeProbes(doc, calculationsText)) {
    if (!r.pass) negFail++;
    log(`  [${r.pass ? 'PASS' : 'FAIL'}] ${r.name} (expect ${r.expectCode}) -> ${r.errors.length ? r.errors.join('; ') : 'no errors'}`);
  }
  if (negFail) { log(`  ${negFail} negative probe(s) FAILED`); exitCode = 1; }
  else log('  OK: the verifier rejects duplicate IDs, arithmetic tampering, unsynthetic labels, uncovered canonical cases, undefined-without-reason and undocumented fixtures.');

  log('\n== RESULT ==');
  log(`  exit=${exitCode} (0 = hashes/identity/coverage/arithmetic/negatives pass)`);
  process.stdout.write(out.join('\n') + '\n');
  process.exit(exitCode);
}

main();
