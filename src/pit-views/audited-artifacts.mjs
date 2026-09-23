// Verificación de artifacts auditados contra disco y receipts aceptados.
// Fuente: SPEC v1.1.1 §25.2 ("Cada claim debe indicar scope, ..., contenido
// satisfecho, resultado, source/evidence y receipt aceptado"), §6.4 (la
// auditoría verifica publicación y consumo) y §6.1 (sin prueba suficiente el
// dato es unavailable).
//
// Un path y un hash declarados por el llamante no acreditan nada: el módulo
// lee los bytes del artifact dentro del repo, recalcula su sha256 y exige que
// ese mismo path+hash esté registrado en un IMP_RECEIPT aceptado. El contenido
// que se usa es el leído de disco, nunca una copia en memoria del llamante.
//
// Raíz de confianza: el repo de este módulo, fija. La superficie pública no
// deja elegir otra (un directorio propio con un receipt "accepted" fabricado
// acreditaría cualquier cosa). Un IMP_RECEIPT sólo cuenta si además:
//  - está commiteado en git y su contenido es idéntico al de HEAD (un receipt
//    sin commit o editado en disco no acredita);
//  - su IMP figura `aceptado` en PLAN_STATUS.md commiteado ("Solo Bru ... pasa
//    un IMP a `aceptado`", PLAN_STATUS.md §Reglas; OFICINA.md: "No marques un
//    IMP como `aceptado`").
// Las funciones `*At(trustRoot, ...)` existen sólo como costura de tests con
// repos git sintéticos; no se exportan desde index.mjs y no son superficie
// pública. Código en el mismo proceso que importe módulos internos puede
// saltarse cualquier guarda JS: la frontera defendida es index.mjs.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const RECEIPTS_DIR = "operations/receipts";
const SHA256_HEX = /^[0-9a-fA-F]{64}$/;

function sha256Of(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

// Contenido de `relativePath` idéntico al commiteado en HEAD. Sin git, sin
// commit o con cambios locales: no es confiable.
function isCommittedUnchanged(trustRoot, relativePath) {
  try {
    const run = (args) => execFileSync("git", ["-C", trustRoot, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return run(["rev-parse", `HEAD:${relativePath}`]) === run(["hash-object", "--", relativePath]);
  } catch {
    return false;
  }
}

// IMPs marcados `aceptado` en la tabla de PLAN_STATUS.md commiteado.
function impsAcceptedInPlan(trustRoot) {
  const accepted = new Set();
  if (!isCommittedUnchanged(trustRoot, "PLAN_STATUS.md")) {
    return accepted;
  }
  const plan = readFileSync(path.join(trustRoot, "PLAN_STATUS.md"), "utf8");
  for (const line of plan.split("\n")) {
    const match = /^\|\s*(IMP-\d+)\s*\|\s*aceptado\s*\|/.exec(line);
    if (match !== null) {
      accepted.add(match[1]);
    }
  }
  return accepted;
}

// Artifacts registrados por receipts aceptados: los `evidenceTestHashes` del
// IMP_RECEIPT y los `changedFileHashes` de cada ST que ese receipt declara
// accepted (un ST_RECEIPT suelto con status in_review no acredita: "ST
// accepted is not IMP accepted"). Un receipt que no cumple cualquiera de las
// condiciones no aporta nada: la omisión reduce lo acreditado, nunca lo amplía.
function acceptedArtifactRegistry(trustRoot) {
  const registry = [];
  let receiptFiles = [];
  try {
    receiptFiles = readdirSync(path.join(trustRoot, RECEIPTS_DIR)).filter((name) => name.endsWith("-IMP_RECEIPT.json")).sort();
  } catch {
    return registry;
  }
  const acceptedInPlan = impsAcceptedInPlan(trustRoot);
  for (const fileName of receiptFiles) {
    const receiptPath = `${RECEIPTS_DIR}/${fileName}`;
    const receipt = readJson(path.join(trustRoot, receiptPath));
    if (receipt?.receiptKind !== "IMP_RECEIPT" || receipt?.outcome !== "accepted") {
      continue;
    }
    // El receipt habla de su propio IMP (nombre de archivo) y ese IMP está
    // aceptado en el plan.
    const impIdentity = receipt.impIdentity;
    if (typeof impIdentity !== "string" || fileName !== `${impIdentity}-IMP_RECEIPT.json` || !acceptedInPlan.has(impIdentity)) {
      continue;
    }
    if (typeof receipt.acceptedAtUtc !== "string" || receipt.acceptedAtUtc.length === 0) {
      continue;
    }
    if (!isCommittedUnchanged(trustRoot, receiptPath)) {
      continue;
    }
    const origin = { receiptPath, impIdentity, acceptedAtUtc: receipt.acceptedAtUtc };
    for (const entry of Array.isArray(receipt.evidenceTestHashes) ? receipt.evidenceTestHashes : []) {
      if (typeof entry?.path === "string" && typeof entry?.sha256 === "string") {
        registry.push({ path: entry.path, sha256: entry.sha256.toLowerCase(), ...origin });
      }
    }
    for (const st of Array.isArray(receipt.requiredStIdentities) ? receipt.requiredStIdentities : []) {
      if (st?.status !== "accepted") {
        continue;
      }
      const changed = st?.resultingVersion?.changedFileHashes ?? {};
      for (const [changedPath, sha256] of Object.entries(changed)) {
        if (typeof sha256 === "string") {
          registry.push({ path: changedPath, sha256: sha256.toLowerCase(), ...origin });
        }
      }
    }
  }
  return registry;
}

function failure(code, message) {
  return { ok: false, errors: [{ field: "artifactRef", code, message }] };
}

// Lee y verifica un artifact JSON auditado. `ref` = { path (relativo al repo),
// sha256 }. Devuelve el contenido parseado de disco y su procedencia
// (path, sha256 recalculado y receipt aceptado que lo registra).
export function verifyAcceptedArtifact(ref, options = {}) {
  if (options !== null && typeof options === "object" && Object.hasOwn(options, "repoRoot")) {
    return trustRootNotConfigurable();
  }
  return verifyAcceptedArtifactAt(DEFAULT_REPO_ROOT, ref);
}

export function trustRootNotConfigurable() {
  return {
    ok: false,
    errors: [{ field: "repoRoot", code: "TRUST_ROOT_NOT_CONFIGURABLE", message: "La raíz de confianza es el repo del módulo; no la elige el llamante (§25.2)." }],
  };
}

export function verifyAcceptedArtifactAt(repoRoot, ref) {
  if (!ref || typeof ref.path !== "string" || ref.path.length === 0
    || typeof ref.sha256 !== "string" || !SHA256_HEX.test(ref.sha256)) {
    return failure("MISSING_ARTIFACT_REF", "artifactRef requiere path relativo al repo y sha256 de 64 hex (trazabilidad §6.2/§25.2).");
  }
  if (path.isAbsolute(ref.path)) {
    return failure("ARTIFACT_PATH_OUTSIDE_REPO", `"${ref.path}" debe ser relativo al repo.`);
  }
  let rootReal;
  let artifactReal;
  try {
    rootReal = realpathSync(repoRoot);
    artifactReal = realpathSync(path.resolve(repoRoot, ref.path));
  } catch {
    return failure("ARTIFACT_NOT_FOUND", `No existe el artifact "${ref.path}" en el repo.`);
  }
  // Se compara contra el path real (symlinks resueltos): un enlace no puede
  // hacer pasar un archivo de fuera del repo por un artifact auditado.
  const relativePath = path.relative(rootReal, artifactReal).split(path.sep).join("/");
  if (relativePath.startsWith("../") || relativePath === ".." || path.isAbsolute(relativePath)) {
    return failure("ARTIFACT_PATH_OUTSIDE_REPO", `"${ref.path}" resuelve fuera del repo.`);
  }

  if (!statSync(artifactReal).isFile()) {
    return failure("ARTIFACT_NOT_FOUND", `"${relativePath}" no es un archivo.`);
  }
  const bytes = readFileSync(artifactReal);
  const actualSha256 = sha256Of(bytes);
  if (actualSha256 !== ref.sha256.toLowerCase()) {
    return failure("ARTIFACT_HASH_MISMATCH", `El sha256 declarado para "${relativePath}" no coincide con su contenido (${actualSha256}).`);
  }
  const registered = acceptedArtifactRegistry(rootReal)
    .find((entry) => entry.path === relativePath && entry.sha256 === actualSha256);
  if (registered === undefined) {
    return failure(
      "ARTIFACT_NOT_IN_ACCEPTED_RECEIPT",
      `"${relativePath}"@${actualSha256} no está registrado en ningún IMP_RECEIPT aceptado de ${RECEIPTS_DIR}; sin receipt aceptado no acredita nada (§25.2).`,
    );
  }
  let artifact;
  try {
    artifact = JSON.parse(bytes.toString("utf8"));
  } catch {
    return failure("ARTIFACT_NOT_JSON", `"${relativePath}" no es JSON.`);
  }
  return {
    ok: true,
    artifact,
    provenance: {
      path: relativePath,
      sha256: actualSha256,
      receiptPath: registered.receiptPath,
      impIdentity: registered.impIdentity,
      acceptedAtUtc: registered.acceptedAtUtc,
    },
  };
}
