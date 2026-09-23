# IMP-08 parent acceptance — bounded Command verification
Current UTC start: 2026-09-22. Workspace `/srv/hot-data/energy-markets/app`; project `96bbd5b1-94da-4781-8c2b-455fdfb28d1a`; root LAT-91; Command LAT-244.

Actual checks run by this parent gate, on current bytes:

- Canonical SPEC SHA256: `86c4bd4eeb5f9d0ebad94763128b221eb64525a2b7fff1007dab0af88b39cb6c`.
- Accepted IMP-01 receipt SHA256: `78d92de81d8c480b7d96c7203fa2a0651e...` (exact value in parent receipt).
- ST-08.6 verifier, run once before acceptance: `PASS; pins=11; claims=0; sha256sum entries=12`.
- Workspace-relative SHA manifest: 12/12 `OK`.
- `validateStReceipt` independently run for ST-08.1 through ST-08.6: six/six valid; receipt file SHA256 values match the accepted lineage.
- Native LAT-229 reviewer approval and FINAL-ACCEPTANCE comments inspected directly through the Paperclip API; current run is `321dd797-225f-4377-b978-dacefe31ef9a` for agent `2b6bf987-6800-4d4c-a23a-d470a4bb0ea6`.

The prior staged test evidence in `ST-08.6/tests.tap` is reused as valid hash-bound evidence; it was re-pinned by the once-run verifier and SHA manifest. The disclosed ST-08.3 baseline typo is assessed as a residual provenance defect, not a lineage break, because predecessor bytes and accepted child identities are preserved and the current accepted semantic version is ST-08.5.

No prior accepted receipts or accepted ST trees were rewritten. No product code, office policy, timer, budget, provider or Alexandria surface was touched.
