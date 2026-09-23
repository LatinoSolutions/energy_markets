// Independent stage-2 review probes. All economic inputs are synthetic.
// This file records expected acceptance behavior; it is not production code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveSymbol, validateStReceipt, linkStReceiptToPacket,
  validateEconomicBundle } from '../../../src/contracts/index.mjs';

const receipt = JSON.parse(readFileSync(new URL('../../receipts/IMP-01-ST-1.json', import.meta.url)));
const identity = receipt.packetSubtaskParentIdentity;
const packet = {
  packetId: identity.packetId, subtaskId: identity.subtaskId,
  parentImp: identity.parentImp, project: identity.project,
  spec: { id: identity.specId, version: identity.specVersion, sha256: identity.specSha256 },
};

test('§20.2.8: an empty packet/subtask/parent identity must fail', () => {
  assert.equal(validateStReceipt({ ...receipt, packetSubtaskParentIdentity: {} }).ok, false);
});

test('§20.2.5/.7/.8: a mismatched project or SPEC identity/version must fail linkage', () => {
  for (const key of ['project', 'specId', 'specVersion']) {
    const changed = structuredClone(receipt);
    changed.packetSubtaskParentIdentity[key] = key === 'specVersion' ? '9.9' : 'synthetic-wrong-identity';
    assert.equal(linkStReceiptToPacket(packet, changed).ok, false, key);
  }
});

test('§3.3: inherited Object keys are not declared q_t/A0/S1 scopes', () => {
  for (const symbol of ['q_t', 'A0', 'S1']) {
    for (const scope of ['toString', 'constructor', '__proto__']) {
      assert.equal(resolveSymbol({ symbol, scope }).ok, false, `${symbol}/${scope}`);
    }
  }
});

function syntheticBundle() {
  const entry = (fields) => ({ version: '1.0', availability: 'AVAILABLE_NOW', fields });
  return {
    experiment: entry({ id: 'synthetic-experiment' }),
    campaign: entry({ id: 'synthetic-campaign', product: 'Gas', mission: 'Quarterly', gasQuarterly: true }),
    openingContract: entry({ openingObligation: { value: 100, unit: 'MWh' }, windowStart: '2026-01-01', windowEnd: '2026-03-31', deadline: '2026-03-31' }),
    decisionCalendar: entry({ opportunities: ['2026-01-02'] }),
    arm: entry({ definition: 'A0 Calendar-only / price-blind baseline' }),
    a1Configuration: entry({ s1Configuration: { synthetic: true, reference: 'synthetic-frozen-reference' } }),
    data: entry({ pitManifest: { id: 'synthetic-pit', version: '1.0', availability: 'AVAILABLE_NOW' } }),
    sizing: entry({ controllerConfiguration: 'synthetic-frozen-calendar-controller' }),
    execution: entry({ contractVersion: '1.0' }),
    costs: entry({ ledgerConfiguration: 'synthetic-frozen-cost-ledger' }),
    benchmark: entry({ sourceVersion: '1.0' }),
    evaluator: { version: '1.0', availability: 'AVAILABLE_NOW' },
  };
}

test('synthetic positive control: complete bundle accepted without mutation', () => {
  const bundle = syntheticBundle();
  const original = structuredClone(bundle);
  assert.equal(validateEconomicBundle(bundle).ok, true);
  assert.deepEqual(bundle, original);
});

test('§14.2/§25.1: empty obligation/config/version objects must not count as known fields', () => {
  for (const [key, field] of [['openingContract', 'openingObligation'], ['costs', 'ledgerConfiguration'], ['execution', 'contractVersion']]) {
    const bundle = syntheticBundle();
    bundle[key].fields[field] = {};
    const result = validateEconomicBundle(bundle);
    assert.ok(!result.ok || result.blocked, `${key}.${field}: ${JSON.stringify(result)}`);
  }
});

test('§14.7/§25.1: field-level unavailable must reject or preserve its reason and block', () => {
  const bundle = syntheticBundle();
  bundle.openingContract.fields.openingObligation = { availability: 'UNAVAILABLE', reason: 'synthetic obligation missing' };
  const result = validateEconomicBundle(bundle);
  assert.ok(!result.ok || result.blocked, JSON.stringify(result));
  // Unsupported representations may be explicitly rejected. They must never
  // silently become a usable, known economic obligation.
});
