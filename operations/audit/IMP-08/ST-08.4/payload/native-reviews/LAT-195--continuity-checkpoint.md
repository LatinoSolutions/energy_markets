# SOURCE RECORD (verbatim body copy)
- issue: LAT-195 (ST-08.5)
- key: `continuity-checkpoint`
- title: ST-08.5 continuity checkpoint
- revisionId: 4a359f9e-0667-4ea4-bdd3-79b9724e8f4d
- createdByAgentId: 6c548bcb-e6aa-43ea-9c6c-319497cbe6a9
- createdByUserId: None
- updatedAt: 2026-09-21T10:47:14.633Z

---

# continuity-checkpoint

## Packet id

`WP-IMP-08-ST-5-v1.1` / `ST-08.5` / parent `IMP-08` / issue [LAT-195](/LAT/issues/LAT-195).

## Criterios de aceptación originales

1. Complete cost elements that are null, undefined, sparse, primitive, or malformed never throw and return the established explicit unknown result.
2. Invalidity is detected by validity, not truthiness, with `costsComplete:true`.
3. Valid finite arithmetic, units, output shape, and empty-complete behavior remain unchanged.
4. Unknown/non-finite/incompatible inputs fail closed without coercion or zero substitution.
5. Direct malformed-element matrix plus valid controls is present.
6. Economic, contract, ST-08.3 regression, oracle, historical verifier and new ST-08.5 verifier results are recorded honestly.
7. Before/after hashes and protected history are recorded; manifest covers the new delivery.
8. Complete §20.2.8 ST_RECEIPT is linked to the packet.
9. Native independent Astra review remains separate from author work and parent IMP acceptance.

## Estado actual

Implementation and author verification complete. Recommended status: `in_review`; native independent Astra review is the next gate. This child does not accept `IMP-08`.

## Acciones completadas

- Read LAT-194 final-acceptance evidence and canonical §§5, 19.3–19.3.1, 20.2.7–20.2.10, 25.1–25.2.3.
- Validated host/cwd/branch and captured the pre-edit dirty baseline.
- Corrected the falsy-invalid cost predicate and added direct regressions.
- Ran the exact packet tests, exact LAT-194 reproducer, and malformed-element matrix.
- Preserved historical ST-08.3 evidence; recorded its expected hash-pinned mismatch.
- Prepared isolated ST-08.5 evidence, receipt, manifest and verifier.

## Ficheros cambiados

- `src/economic-calculation/bhv.mjs`
- `test/economic-calculation/bhv.test.mjs`
- `operations/audit/IMP-08/ST-08.5/**`
- `operations/receipts/IMP-08-ST-5.json`

No other product, SPEC, bootstrap, office, controller, policy, route, timer, quota, budget, branch, worktree or parent-receipt path was changed by this packet.

## Comandos y tests ejecutados con resultado

- `hostname`, `pwd`, `git branch --show-current`: `brunode`, `/srv/hot-data/energy-markets/app`, `main`; exit 0.
- `/opt/node/bin/node --check src/economic-calculation/bhv.mjs`: exit 0.
- `/opt/node/bin/node --test test/economic-calculation/*.test.mjs`: 56/56, exit 0.
- `/opt/node/bin/node --test test/contracts/*.test.mjs`: 67/67, exit 0.
- `/opt/node/bin/node --test operations/audit/IMP-08/ST-08.3/regression.test.mjs`: 9/9, exit 0.
- `/opt/node/bin/node operations/audit/IMP-08/fixture-oracle/verify.mjs`: 35 fixtures, C01–C12 and negative probes PASS, exit 0.
- Historical `/opt/node/bin/node operations/audit/IMP-08/ST-08.3/verify-delivery.mjs`: expected exit 1 because its reviewed ST-08.3 semantic hash is intentionally unchanged and now stale against ST-08.5 bytes.
- `/opt/node/bin/node operations/audit/IMP-08/ST-08.5/verify-delivery.mjs`: PASS; 11 artifacts, 9 protected hashes unchanged, semantic hash `bc0ce6adef42831da21c9339c6569018a8c6b03a587558372ace336d4f661528`, receipt `in_review`, reviewer Astra; exit 0.

Full command/result record: `tests.tap`; exact reproducer/matrix output: `reproducer.txt`.

## Resumen del diff

`computeAllInH` now uses `isValidCompleteCost` plus `findIndex(...) !== -1`, so null/undefined/falsy/scalar/malformed/sparse elements are rejected before reduction. Established result and reason are preserved. Tests add 12 malformed cases and finite/zero/empty/unit controls.

## Pendientes

- Obtain one native independent Astra review on the exact delivered bytes.
- Command separately re-evaluates IMP-08 with ST-08.4; no parent IMP_RECEIPT is produced here.

## Blocker

No implementation blocker. Review gate is pending; the historical ST-08.3 verifier mismatch is expected, bounded, and not to be fixed by editing prior evidence.

## Siguiente acción exacta

The isolated ST-08.5 delivery verifier has passed on the final manifest. Hand the issue to Tech Lead Astra for native independent review. Do not alter ST-08.3 history.

## Supuestos

- H remains the supplied synthetic all-in value; no real ledger formula or new cost semantics are introduced.
- The existing exact unknown result/reason is the frozen contract.
- The workspace has no commit baseline; content hashes identify the bytes.
- Protected prior receipts/manifests/oracle files remain historical and read-only.

## ¿Requiere decisión de arquitectura?

No. LAT-194 identified a bounded local validation defect and the correction preserves the SPEC and frozen economic semantics.

## Estado de la revisión

Author evidence recommends `in_review`; author is Luna and must not approve. Native independent Tech Lead Astra review, approvalsNeeded=1, is required before child completion. ST acceptance remains separate from IMP-08 parent acceptance.
