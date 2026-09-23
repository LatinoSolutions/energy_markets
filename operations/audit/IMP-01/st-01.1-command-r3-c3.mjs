// Command review: remaining C3 requirement from the preceding review.
// All fixture inputs are synthetic. No production implementation edits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEconomicBundle } from '../../../src/contracts/index.mjs';
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


test('positive control: supported synthetic bundle', () => {
  const result = validateEconomicBundle(syntheticBundle());
  assert.equal(result.ok, true);
  assert.equal(result.blocked, false);
});

test('C3: malformed required execution/source version references are rejected', () => {
  for (const [key, field] of [['execution','contractVersion'], ['benchmark','sourceVersion']]) {
    for (const value of [{contentHash:'not-a-sha256'}, {contentHash:null}, '']) {
      const bundle = syntheticBundle();
      bundle[key].fields[field] = value;
      const result = validateEconomicBundle(bundle);
      assert.ok(!result.ok || result.blocked, `${key}.${field}=${JSON.stringify(value)} => ${JSON.stringify(result)}`);
    }
  }
});

test('C3: missing obligation value inside a nonempty object is not known content', () => {
  const bundle = syntheticBundle();
  bundle.openingContract.fields.openingObligation = {value:null, unit:'MWh'};
  const result = validateEconomicBundle(bundle);
  assert.ok(!result.ok || result.blocked, JSON.stringify(result));
});
