# IMP-08 / ST-08.3 acceptance matrix

Packet `WP-IMP-08-ST-3-v1.1`; synthetic calculation/fixtures only. A PASS in
this matrix is worker evidence for native review, not ST acceptance or IMP-08
acceptance.

| Criterion | Executable evidence | Result |
|---|---|---|
| 1. Generic public API and 35-fixture coverage | `/opt/node/bin/node --test test/economic-calculation/*.test.mjs`; frozen oracle verifier; public modules contain no fixture/oracle imports; all C01–C12 labels remain in tests/oracle mapping | PASS — 53/53 economic tests; oracle verifier PASS |
| 2. Reference validity, daily weighting, windows and provenance | `ST-08.3-R1` through `R4`; inherited FX-C01–C08; exact product/date/accessibility row pipeline; malformed timestamp, explicit unknown (`declaredValidity:null`) and explicit validity exclusions | PASS |
| 3. B/H/V, completeness, units and unknown costs | `ST-08.3-R5`/`R6`; inherited FX-BHV cases; explicit `costsComplete`; no NaN/TypeError/zero coercion | PASS |
| 4. Quarterly formulas and degenerates | Inherited FX-C09–C12 and scoring suite; exact `n-1`, target zero, strict `Sortino>1`, neutral separation | PASS |
| 5. Monthly separation and mission-bound evidence | `ST-08.3-R7`/`R8`; Quarterly evidence reconciles `scoring.nTotal` to completed quarters; eight finite values are required for the positive fixture; mixed products rejected; Monthly remains scope-limited | PASS |
| 6. Actual output and independent expectations | `regression-expectations.md`, `before-tests.txt`, `after-tests.txt`, TAP outputs, protected hashes and source manifest | PASS |
| 7. Receipt/review boundary | `IMP-08-ST-3.json`, `verify-delivery.mjs`, native review stage remains required; owner-authorized Board/user participant handles R2 because reviewer quota is exhausted; no IMP_RECEIPT produced | PASS — handoff is `in_review` recommendation |
| 8. Duplicate daily rows through actual pipeline | `ST-08.3-R1` and `R2` use captured rows, exact filters, date deduplication and conflict rejection | PASS |
| 9. Official validity and timestamp corrections | `ST-08.3-R3` and `R4`; valid `0.01` remains eligible; invalid/unknown/malformed candidates excluded | PASS |
| 10. Cost invalidity and explicit zero | `ST-08.3-R5` and `R6`; missing list/completeness, null, wrong type, nonfinite and known-zero cases | PASS |
| 11. Mission evidence gate | `ST-08.3-R7` and `R8`; Monthly 24 months cannot satisfy Quarterly; two scored values cannot satisfy eight declared quarters; forged counts and pooled products HOLD | PASS |
| 12. Versioned evidence and protected history | `baseline.json`, `manifest.json`, `IMP-08-ST-3.json`; ST-08.1/ST-08.2/oracle hashes unchanged; shared `validateWorkerRouteIdentity` is exercised by `ST-08.3-R9` and delivery verifier for current route identity, cloned mismatches and initial history | PASS |

## Scope and limitations

Inputs are synthetic. No real market run, ledger-cost model, purchase, trading,
production activation, research PASS, DEP-13 closure or IMP_RECEIPT is claimed.
The worker does not approve its own work. The current owner-authorized native
review participant is Board/user because the Independent Reviewer lane is
quota-exhausted; the parent Command gate remains separate.
