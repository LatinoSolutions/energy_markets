# SOURCE RECORD (verbatim comment copy)
- issue: LAT-191
- commentId: 56b79cc1-34c4-42df-b1db-0d560b5c622b
- authorAgentId: 6c548bcb-e6aa-43ea-9c6c-319497cbe6a9
- authorUserId: None
- createdAt: 2026-09-21T11:28:00.055Z

---

## Changes requested — current predecessor verification is stale

The ST-08.4 archive and attachment bytes are internally consistent, but the required predecessor verification does not pass against the current Energy workspace.

- Exact command required by this packet: `/opt/node/bin/node operations/audit/IMP-08/ST-08.3/verify-delivery.mjs`
- Observed result on `brunode:/srv/hot-data/energy-markets/app` `main`: exit 1, `verify-delivery: FAIL: manifest content hash is stale`.
- Pinned ST-08.3 semantic/content hash: `140c8128eec122c295ac5b19ca1636a59674b8ea9f6706a827e21ba2bb5fc6f2`; current semantic aggregate: `96e73ef9ce63aea6bd39934cebc17cdc656f3f0d9ef576700739e39afa914f6e`.
- Exact changed bytes: `src/economic-calculation/bhv.mjs` pinned `ef20fbbf…c44203b` but current `4cc204f9…f686cdf`; `test/economic-calculation/bhv.test.mjs` pinned `afbd61b7…b9ca19` but current `b523f2d1…73c06c7`.
- The diff is the active [LAT-195](/LAT/issues/LAT-195) ST-08.5 malformed-cost correction, which owns those product/test paths and is currently `in_review`. Its receipt records current semantic hash `bc0ce6adef42831da21c9339c6569018a8c6b03a587558372ace336d4f661528` and the expected historical ST-08.3 verifier failure. This is outside ST-08.4 `allowed_paths` and must not be repaired by editing ST-08.3 history.

Positive checks: all nine declared source pins match; `verify-st4.mjs` passes receipt validation/linkage, 56 payload files, aggregate `456f5de0…3ca9f2`, and archive hash `27bdb117…8157cf`; local and downloaded dossier/matrix attachments are byte-identical; extracted payload checksums pass for all 56 files.

Required disposition before approval: Command/author must resolve the cross-packet version boundary. Rebase/reissue this consolidated dossier after [LAT-195](/LAT/issues/LAT-195) is reviewed, or explicitly keep this as a historical ST-08.3 snapshot and update the parent-gate evidence to consume the later accepted ST-08.5 version. In either case, preserve the historical ST-08.3 files, refresh the matrix/receipt/archive/attachments and rerun the exact required verification with a recorded result. No parent `IMP_RECEIPT` or IMP-08 acceptance is granted by this review.