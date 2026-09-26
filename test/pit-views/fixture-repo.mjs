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
import { createTempDir } from "../helpers/tmpdir.mjs";
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

// El productor de DEP-06/07 es IMP-03 (§25.2.2): el receipt sintético usa esa
// identidad sólo dentro del repo temporal para ejercitar la acreditación.
export const FIXTURE_IMP = "IMP-03";
export const FIXTURE_SCOPE = "FIXTURE sintético: scope DEP-06/07 de tests";
export const FIXTURE_RECEIPT_PATH = `operations/receipts/${FIXTURE_IMP}-IMP_RECEIPT.json`;

function git(repoRoot, args) {
  execFileSync("git", ["-C", repoRoot, ...args], { stdio: "ignore" });
}

// `artifacts`: [{ path, content (string|Buffer), registered = true }].
// `receiptOutcome`: outcome del IMP_RECEIPT sintético que registra los
// artifacts con `registered: true`. `planStatus`: estado del IMP en
// PLAN_STATUS.md. `commitReceipt`: si el receipt queda commiteado; con
// `editReceiptAfterCommit` se modifica en disco tras el commit. `claims`: los
// claims del receipt; por defecto DEP-06 y DEP-07 audit "satisfied" para
// FIXTURE_SCOPE, citando los artifacts registrados y cubriendo las keys de sus
// atestaciones. Una función recibe ese default y devuelve los claims.
function defaultClaims(evidenceArtifacts, coveredKeys) {
  return ["DEP-06", "DEP-07"].map((dep) => ({
    dep,
    kind: "audit",
    scope: FIXTURE_SCOPE,
    content: "fixture sintético",
    result: "satisfied",
    evidence: "fixture sintético",
    evidenceArtifacts,
    coveredKeys,
  }));
}

function attestedKeysOf(bytes) {
  try {
    const parsed = JSON.parse(bytes.toString("utf8"));
    return Array.isArray(parsed?.attestations) ? parsed.attestations.map((entry) => entry?.key).filter((key) => typeof key === "string") : [];
  } catch {
    return [];
  }
}

export function fixtureRepo({
  artifacts = [],
  receiptOutcome = "accepted",
  planStatus = "aceptado",
  commitReceipt = true,
  editReceiptAfterCommit = false,
  claims,
  imp = FIXTURE_IMP,
} = {}) {
  const repoRoot = createTempDir("pit-views-fixture-");
  created.push(repoRoot);
  const refs = [];
  const evidenceTestHashes = [];
  const coveredKeys = new Set();
  for (const artifact of artifacts) {
    const bytes = Buffer.isBuffer(artifact.content) ? artifact.content : Buffer.from(artifact.content);
    const absolute = path.join(repoRoot, artifact.path);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, bytes);
    const ref = { path: artifact.path, sha256: sha256Hex(bytes) };
    refs.push(ref);
    if (artifact.registered !== false) {
      evidenceTestHashes.push(ref);
      attestedKeysOf(bytes).forEach((key) => coveredKeys.add(key));
    }
  }
  mkdirSync(path.join(repoRoot, "operations/receipts"), { recursive: true });
  const receipt = {
    receiptKind: "IMP_RECEIPT",
    impIdentity: imp,
    outcome: receiptOutcome,
    acceptedAtUtc: "2026-09-01T00:00:00Z",
    evidenceTestHashes,
  };
  const fallbackClaims = defaultClaims(evidenceTestHashes.map((ref) => ({ ...ref })), [...coveredKeys]);
  receipt.claims = typeof claims === "function" ? claims(fallbackClaims) : (claims ?? fallbackClaims);
  const receiptPath = `operations/receipts/${imp}-IMP_RECEIPT.json`;
  writeFileSync(path.join(repoRoot, receiptPath), JSON.stringify(receipt));
  writeFileSync(path.join(repoRoot, "PLAN_STATUS.md"), `| IMP | ESTADO |\n|---|---|\n| ${imp} | ${planStatus} | — | fixture sintético |\n`);
  git(repoRoot, ["init", "-q"]);
  git(repoRoot, ["add", "-A"]);
  if (!commitReceipt) {
    git(repoRoot, ["reset", "-q", "--", receiptPath]);
  }
  git(repoRoot, ["-c", "user.name=fixture", "-c", "user.email=fixture@invalid", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "fixture"]);
  if (editReceiptAfterCommit) {
    writeFileSync(path.join(repoRoot, receiptPath), JSON.stringify({ ...receipt, evidenceTestHashes: [...evidenceTestHashes] }, null, 1));
  }
  return { repoRoot, refs };
}

export const ATTESTATION_PATH = "evidence/fixture/consumption-attestations.json";

// Repo sintético con un artifact PIT_CONSUMPTION_ATTESTATIONS registrado en
// un receipt aceptado sintético.
// Con `artifactKind: "PIT_VALUE_ATTESTATIONS"` es un artifact de procedencia
// de valores.
export function attestationRepo(attestations, { auditId = "AUDIT-FIXTURE", registered = true, artifactKind = "PIT_CONSUMPTION_ATTESTATIONS", scope = FIXTURE_SCOPE, ...repoOptions } = {}) {
  const content = JSON.stringify({ artifactKind, auditId, scope, attestations });
  const { repoRoot, refs } = fixtureRepo({ artifacts: [{ path: ATTESTATION_PATH, content, registered }], ...repoOptions });
  return { repoRoot, attestationRef: refs[0] };
}

export const VALUE_ATTESTATION_PATH = "evidence/fixture/value-attestations.json";
