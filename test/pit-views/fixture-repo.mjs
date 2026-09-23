// Repo git temporal SINTÉTICO para tests. No es evidencia real ni un receipt
// aceptado real: vive en un directorio temporal fuera del repo y existe sólo
// para ejercitar el camino "artifact verificado en disco + IMP_RECEIPT
// aceptado, commiteado y con su IMP `aceptado` en PLAN_STATUS.md" (SPEC
// v1.1.1 §25.2) sin inventar nada dentro del repo. Se usa con las costuras
// `*At(trustRoot, ...)`, que no son superficie pública.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const created = [];
process.on("exit", () => {
  for (const dir of created) {
    rmSync(dir, { recursive: true, force: true });
  }
});

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export const FIXTURE_IMP = "IMP-90";
export const FIXTURE_RECEIPT_PATH = `operations/receipts/${FIXTURE_IMP}-IMP_RECEIPT.json`;

function git(repoRoot, args) {
  execFileSync("git", ["-C", repoRoot, ...args], { stdio: "ignore" });
}

// `artifacts`: [{ path, content (string|Buffer), registered = true }].
// `receiptOutcome`: outcome del IMP_RECEIPT sintético que registra los
// artifacts con `registered: true`. `planStatus`: estado del IMP en
// PLAN_STATUS.md. `commitReceipt`: si el receipt queda commiteado; con
// `editReceiptAfterCommit` se modifica en disco tras el commit.
export function fixtureRepo({
  artifacts = [],
  receiptOutcome = "accepted",
  planStatus = "aceptado",
  commitReceipt = true,
  editReceiptAfterCommit = false,
} = {}) {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "pit-views-fixture-"));
  created.push(repoRoot);
  const refs = [];
  const evidenceTestHashes = [];
  for (const artifact of artifacts) {
    const bytes = Buffer.isBuffer(artifact.content) ? artifact.content : Buffer.from(artifact.content);
    const absolute = path.join(repoRoot, artifact.path);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, bytes);
    const ref = { path: artifact.path, sha256: sha256Hex(bytes) };
    refs.push(ref);
    if (artifact.registered !== false) {
      evidenceTestHashes.push(ref);
    }
  }
  mkdirSync(path.join(repoRoot, "operations/receipts"), { recursive: true });
  const receipt = {
    receiptKind: "IMP_RECEIPT",
    impIdentity: FIXTURE_IMP,
    outcome: receiptOutcome,
    acceptedAtUtc: "2026-09-01T00:00:00Z",
    evidenceTestHashes,
  };
  writeFileSync(path.join(repoRoot, FIXTURE_RECEIPT_PATH), JSON.stringify(receipt));
  writeFileSync(path.join(repoRoot, "PLAN_STATUS.md"), `| IMP | ESTADO |\n|---|---|\n| ${FIXTURE_IMP} | ${planStatus} | — | fixture sintético |\n`);
  git(repoRoot, ["init", "-q"]);
  git(repoRoot, ["add", "-A"]);
  if (!commitReceipt) {
    git(repoRoot, ["reset", "-q", "--", FIXTURE_RECEIPT_PATH]);
  }
  git(repoRoot, ["-c", "user.name=fixture", "-c", "user.email=fixture@invalid", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "fixture"]);
  if (editReceiptAfterCommit) {
    writeFileSync(path.join(repoRoot, FIXTURE_RECEIPT_PATH), JSON.stringify({ ...receipt, evidenceTestHashes: [...evidenceTestHashes] }, null, 1));
  }
  return { repoRoot, refs };
}

export const ATTESTATION_PATH = "evidence/fixture/consumption-attestations.json";

// Repo sintético con un artifact PIT_CONSUMPTION_ATTESTATIONS registrado en
// un receipt aceptado sintético.
export function attestationRepo(attestations, { auditId = "AUDIT-FIXTURE", registered = true, ...repoOptions } = {}) {
  const content = JSON.stringify({ artifactKind: "PIT_CONSUMPTION_ATTESTATIONS", auditId, attestations });
  const { repoRoot, refs } = fixtureRepo({ artifacts: [{ path: ATTESTATION_PATH, content, registered }], ...repoOptions });
  return { repoRoot, attestationRef: refs[0] };
}
