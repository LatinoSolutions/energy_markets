// Canonical IMP graph binding (IMP-26). Fuente: SPEC v1.1.1 §20.2.4
// (elegible IMP rule), §20.2.5 (decomposition), §25.1 (objetivos y acceptance)
// y §25.2.2 (única matriz de dependencias consumidas/producidas).
//
// El grafo se deriva de las tablas §25.1/§25.2.2 del doc canónico vigente, no
// de una copia de memoria: cada fila se localiza en su propia tabla y se
// conserva verbatim (objective + acceptance + MUST NOT CHANGE). Los campos
// tipados (REQUIRES / REQUIRES_AUDIT / REQUIRES_EVIDENCE / RESOLVES_AUDIT /
// PRODUCES_EVIDENCE / UNLOCKS) se extraen de la fila; los casos condicionales
// (framework / validación concreta / procedencia / fase) se marcan y nunca se
// resuelven por guess. Reutiliza el algoritmo verificado del audit de IMP-25
// (operations/audit/IMP-25) sin reconstruir una oficina paralela.

import { CANONICAL_SPEC_IDENTITY, specIdentityMismatches } from "./spec-binding.mjs";

export const CANONICAL_IMP_COUNT = 29;

const IMP_HEADER_RE = /^\|\s*ID\s*\|\s*Exact objective\s*\|/m;
const DEPENDENCY_HEADER_RE = /^\|\s*IMP\s*\|\s*REQUIRES\s*\|\s*REQUIRES_AUDIT\s*\|/m;

const IMP_RE = /\bIMP-(\d{1,3})((?:(?:\s*[,/&]\s*|\s+(?:y|o|and)(?:\s*\/\s*(?:o\s*)?)?\s*)\d{1,3}\b)*)/g;
const DEP_RE = /\bDEP-(\d{1,3})((?:\s*[,/&]\s*\d{1,3}\b)*)(?:\s*[\u2013\u2014-]\s*(\d{1,3})\b)?/g;

// Marcadores de alcance/procedencia que vuelven condicional una CLÁUSULA del
// REQUIRES (validación/evaluación concreta, scope Q07, procedencia o disyunción).
// El texto marcado describe un scope que Command decide, nunca el grafo.
const CLAUSE_QUALIFIER_RE = /\b(si el scope|para (validaci[oó]n|evaluaci[oó]n) concreta|cuando corresponda|en (la )?evaluaci[oó]n concreta|seg[uú]n la procedencia|s[oó]lo para una versi[oó]n|y\/o)\b/i;

// Cláusulas de la SPEC que NOMBRAN dependencias negadas/diferidas (§20.2.3 y
// §25.2.2: "sin exigir…", "no exige…", "se verifica durante el trabajo…"). Los
// ids citados dentro de esas cláusulas NO son requisitos para empezar.
const NON_REQUIREMENT_RE = /\b(?:no se exige|no se exigen|no se requiere|no se requieren|no se presume|no exige|no requiere|no a\u00f1ade|no produce|sin exigir|sin requerir|durante el trabajo|antes del acto)\b/i;

// Devuelve el texto con las cláusulas negadas/diferidas eliminadas.
function stripNegatedClauses(text) {
  return String(text ?? "")
    .split(/[;.]\s*/)
    .filter((clause) => !NON_REQUIREMENT_RE.test(clause))
    .join(". ");
}

export function normalizeImpId(value) {
  const match = /^IMP-0*(\d+)$/.exec(String(value ?? "").trim());
  return match ? `IMP-${match[1].padStart(2, "0")}` : null;
}

export function expandImpIds(text) {
  const out = [];
  for (const match of stripNegatedClauses(text).matchAll(IMP_RE)) {
    out.push(`IMP-${match[1].padStart(2, "0")}`);
    for (const extra of (match[2] ?? "").split(/[,/&]|(?:\s+(?:y|o|and)(?:\s*\/\s*(?:o\s*)?)?\s*)/)) {
      const number = extra.trim();
      if (/^\d{1,3}$/.test(number)) out.push(`IMP-${number.padStart(2, "0")}`);
    }
  }
  return [...new Set(out)];
}

// Texto después de "No requiere" / "no exige" nombra lo que NO se exige.
export function expandDepIds(text) {
  const cut = stripNegatedClauses(text).split(/\b(no requiere|no exige|not required)\b/i)[0];
  const out = [];
  for (const match of cut.matchAll(DEP_RE)) {
    const first = Number(match[1]);
    out.push(`DEP-${String(first).padStart(2, "0")}`);
    for (const extra of (match[2] ?? "").split(/\s*[,/&]\s*/)) {
      const number = extra.trim();
      if (/^\d{1,3}$/.test(number)) out.push(`DEP-${number.padStart(2, "0")}`);
    }
    if (match[3]) {
      const extraNumbers = (match[2] ?? "").match(/\d{1,3}/g) ?? [];
      const rangeStart = extraNumbers.length > 0 ? Number(extraNumbers[extraNumbers.length - 1]) : first;
      const last = Number(match[3]);
      for (let n = rangeStart + 1; n <= last && n - first < 40; n += 1) out.push(`DEP-${String(n).padStart(2, "0")}`);
    }
  }
  return [...new Set(out)];
}

// Una columna que empieza con "—" no declara nada antes del guión; los ids que
// siguen pertenecen a una cláusula explicativa ("—; DEP-01–04 son el objeto...").
export function requiredDepIds(column) {
  const text = String(column ?? "").trim();
  if (/^[\u2013\u2014-]/.test(text)) return [];
  if (!NON_REQUIREMENT_RE.test(text)) return expandDepIds(text);
  return expandDepIds(stripNegatedClauses(text));
}

function splitRow(row) {
  const cells = String(row ?? "").split("|").map((cell) => cell.trim());
  return cells.length > 2 ? cells.slice(1, -1) : cells;
}

function tableBlock(specText, headerRe) {
  const match = headerRe.exec(specText);
  if (!match) return null;
  const end = specText.indexOf("\n\n", match.index);
  return specText.slice(match.index, end < 0 ? specText.length : end);
}

function rowsFromBlock(block) {
  const rows = {};
  for (const line of String(block ?? "").split("\n")) {
    const match = /^\|\s*\**\s*(IMP-\d{1,3})\**\s*\|/.exec(line);
    if (!match) continue;
    const id = normalizeImpId(match[1]);
    if (id) rows[id] = splitRow(line);
  }
  return rows;
}

// Requisitos normales (REQUIRES) + los condicionales, sin resolverlos. Cada
// cláusula se clasifica: una con marcador de scope/procedencia va a
// conditionalRequires (Command decide el scope concreto); las demás son duras.
export function parseRequires(rowId, requiresText) {
  const clauses = String(requiresText ?? "")
    .split(/[;.]\s*/)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
  const requires = [];
  const conditionalRequires = [];
  let conditional = false;
  for (const clause of clauses) {
    const ids = expandImpIds(clause).filter((id) => id !== rowId);
    if (CLAUSE_QUALIFIER_RE.test(clause)) {
      conditional = true;
      for (const id of ids) if (!conditionalRequires.includes(id)) conditionalRequires.push(id);
    } else {
      for (const id of ids) if (!requires.includes(id)) requires.push(id);
    }
  }
  // Un id nombrado en una cláusula dura no se degrada a condicional.
  return { requires, conditionalRequires: conditionalRequires.filter((id) => !requires.includes(id)), conditional };
}

export function parseCanonicalGraph(specMarkdown) {
  const objectiveBlock = tableBlock(specMarkdown, IMP_HEADER_RE);
  const dependencyBlock = tableBlock(specMarkdown, DEPENDENCY_HEADER_RE);
  if (!objectiveBlock || !dependencyBlock) return null;
  const objectiveRows = rowsFromBlock(objectiveBlock);
  const dependencyRows = rowsFromBlock(dependencyBlock);
  const imps = {};
  for (const [id, dependency] of Object.entries(dependencyRows)) {
    const [, requiresText = "", requiresAudit = "", requiresEvidence = "", resolvesAudit = "", producesEvidence = "", unlocksText = ""] = dependency;
    const objective = objectiveRows[id] ?? [];
    const { requires, conditionalRequires, conditional } = parseRequires(id, requiresText);
    imps[id] = Object.freeze({
      id,
      objective: objective[1] ?? null,
      inputs: objective[2] ?? null,
      outputs: objective[3] ?? null,
      acceptanceTest: objective[4] ?? null,
      mustNotChange: objective[5] ?? null,
      sourceSections: objective[6] ?? null,
      requiresText,
      requires,
      conditionalRequires,
      conditional,
      requiresAudit,
      requiresAuditDeps: requiredDepIds(requiresAudit),
      requiresEvidence,
      requiresEvidenceDeps: requiredDepIds(requiresEvidence),
      resolvesAudit,
      resolvesAuditDeps: expandDepIds(resolvesAudit),
      producesEvidence,
      producesEvidenceDeps: expandDepIds(producesEvidence),
      unlocks: expandImpIds(unlocksText),
    });
  }
  return { objectiveRows, dependencyRows, imps };
}

// El binding exige que las dos tablas contengan exactamente los 29 IMPs y que
// la identidad declarada coincida con el doc canónico. Fail-closed.
export function buildCanonicalGraph({ specMarkdown, specIdentity = CANONICAL_SPEC_IDENTITY } = {}) {
  const errors = [];
  if (typeof specMarkdown !== "string" || specMarkdown.length === 0) {
    return { ok: false, errors: [{ code: "SPEC_MARKDOWN_MISSING", message: "Faltan los bytes de la SPEC para derivar el grafo." }], graph: null };
  }
  const mismatches = specIdentityMismatches(specIdentity);
  if (mismatches.length > 0) {
    errors.push({ code: "SPEC_IDENTITY_MISMATCH", fields: mismatches, message: "La identidad declarada no es la SPEC canónica vigente." });
  }
  const parsed = parseCanonicalGraph(specMarkdown);
  if (!parsed) {
    return { ok: false, errors: [{ code: "CANONICAL_TABLE_UNLOCATED", message: "No se localizaron las tablas §25.1/§25.2.2 en la SPEC." }], graph: null };
  }
  const objectiveIds = Object.keys(parsed.objectiveRows);
  const dependencyIds = Object.keys(parsed.dependencyRows);
  const projectedIds = Object.keys(parsed.imps);
  if (projectedIds.length !== CANONICAL_IMP_COUNT) {
    errors.push({ code: "CANONICAL_GRAPH_INCOMPLETE", count: projectedIds.length, expected: CANONICAL_IMP_COUNT, message: `El grafo derivado tiene ${projectedIds.length} IMPs, se esperaban ${CANONICAL_IMP_COUNT}.` });
  }
  const missingObjective = dependencyIds.filter((id) => !objectiveIds.includes(id));
  const missingDependency = objectiveIds.filter((id) => !dependencyIds.includes(id));
  if (missingObjective.length || missingDependency.length) {
    errors.push({ code: "CANONICAL_TABLE_MISMATCH", missingObjective, missingDependency, message: "§25.1 y §25.2.2 no contienen el mismo conjunto de IMPs." });
  }
  if (errors.length > 0) return { ok: false, errors, graph: null };
  return {
    ok: true,
    errors: [],
    graph: Object.freeze({
      spec: Object.freeze({ ...specIdentity }),
      imps: Object.freeze(parsed.imps),
    }),
  };
}

export function getImp(graph, impId) {
  const id = normalizeImpId(impId);
  return id && graph?.imps ? graph.imps[id] ?? null : null;
}

export function listImps(graph) {
  return graph?.imps ? Object.values(graph.imps) : [];
}
