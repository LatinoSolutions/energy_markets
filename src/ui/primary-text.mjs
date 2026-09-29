// UI-10 (intake D-20260929T103404-2ec5, PLAN_UI §4.D step 19): what a reader
// actually sees on a served page, split by context. Primary text is every
// visible text node and tooltip/accessible label outside a `data-provenance`
// container; historical provenance keeps legacy history, and only its alias and
// quote lines may carry the technical aliases or verbatim legacy wording.
//
// The rules are the UI-10 acceptance checks: UI10-02 (no Baseline identity),
// UI10-03 (CONTROL only as the ablation comparator), UI10-04 (no Arm A/B),
// UI10-05 (DIP10 only as legacy provenance), UI10-06 (no raw enums / codes).

const VOID_ELEMENTS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const VISIBLE_ATTRIBUTES = ["title", "aria-label", "data-tip", "alt", "placeholder"];

function decode(text) {
  return text
    .replaceAll("&nbsp;", " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

function attributeOf(attributes, name) {
  return attributes.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1] ?? null;
}

// Segments of visible text, each tagged with the innermost provenance kind
// ("primary", "historical", "alias", "quote") and whether it sits inside an
// ablation context (`data-context="ablation"` or the Results ablation card).
export function visibleSegments(html) {
  const body = String(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  const segments = [];
  const stack = [];
  const current = () => stack.at(-1) ?? { kind: "primary", ablation: false };
  const push = (text, context) => {
    const clean = decode(text).replace(/\s+/g, " ").trim();
    if (clean !== "") segments.push({ text: clean, kind: context.kind, ablation: context.ablation });
  };
  const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
  let cursor = 0;
  for (const match of body.matchAll(tag)) {
    push(body.slice(cursor, match.index), current());
    cursor = match.index + match[0].length;
    const [, closing, rawName, attributes] = match;
    const name = rawName.toLowerCase();
    if (closing) {
      // Pop to the matching element; unbalanced closers are ignored.
      const at = stack.map((entry) => entry.name).lastIndexOf(name);
      if (at >= 0) stack.length = at;
      continue;
    }
    const parent = current();
    const provenance = attributeOf(attributes, "data-provenance");
    // CONTROL is legitimate in the ablation and in the canonical hypothesis
    // definition, whose question names its paired comparator (FIX-07 owns it).
    const declared = attributeOf(attributes, "data-context");
    const context = {
      name,
      kind: provenance ?? parent.kind,
      ablation: parent.ablation || declared === "ablation" || declared === "hypothesis-definition",
    };
    for (const attribute of VISIBLE_ATTRIBUTES) {
      const value = attributeOf(attributes, attribute);
      if (value !== null) push(value, context);
    }
    const selfClosing = /\/\s*$/.test(attributes) || VOID_ELEMENTS.has(name);
    if (!selfClosing) stack.push(context);
  }
  push(body.slice(cursor), current());
  return segments;
}

// UI10-06 (PLAN_UI §3 "never raw enums"; OFICINA.md product language): no
// machine code in SCREAMING_SNAKE form (PENDING_MEASUREMENT, OOS_HISTORICO…)
// and no Spanish zone id; stable ids and codes live in alias lines or data
// attributes only.
const RAW_CODE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/;
const SPANISH_ZONE = /\bPUENTE\b|\bHISTORICO\b/;

const PRIMARY_FORBIDDEN = [
  ["UI10-02", /\bBaseline\b|\bBASELINE\b/],
  ["UI10-02", /client practice/i],
  ["UI10-04", /\bArm [AB]\b|\bARM_[AB]\b/],
  ["UI10-05", /\bDIP10\b/],
  ["UI10-06", /\bnull UNAVAILABLE\b/],
  ["UI10-06", RAW_CODE],
  ["UI10-06", SPANISH_ZONE],
];

// Inside a historical card the legacy history is shown, but never under the
// legacy experiment names: those live only in alias/quote lines.
const HISTORICAL_FORBIDDEN = [
  ["UI10-02", /\bBaseline\b|\bBASELINE\b/],
  ["UI10-02", /client practice/i],
  ["UI10-04", /\bArm [AB]\b|\bARM_[AB]\b/],
  ["UI10-06", /\bnull UNAVAILABLE\b/],
  ["UI10-06", RAW_CODE],
  ["UI10-06", SPANISH_ZONE],
];

const CONTROL = /\bCONTROL\b|\bControl\b/;

// Findings of one page: [{ check, kind, text }]. Empty means the page meets
// UI10-02..06 on its visible text.
export function legacyTextFindings(html) {
  const findings = [];
  for (const segment of visibleSegments(html)) {
    const rules = segment.kind === "primary" ? PRIMARY_FORBIDDEN : segment.kind === "historical" ? HISTORICAL_FORBIDDEN : [];
    for (const [check, pattern] of rules) {
      if (pattern.test(segment.text)) findings.push({ check, kind: segment.kind, text: segment.text.slice(0, 160) });
    }
    if (CONTROL.test(segment.text) && !segment.ablation && segment.kind !== "quote") {
      findings.push({ check: "UI10-03", kind: segment.kind, text: segment.text.slice(0, 160) });
    }
  }
  return findings;
}
