// Versioning helpers del sizing controller. Mismo criterio de content-hash
// canonical que IMP-07 (src/execution-contract/execution-contract.mjs) para
// que las versiones de controller y contrato sean comparables entre strands.
import { createHash } from "node:crypto";

// PLACEHOLDER (REGLA 2): serialización canónica propia; la SPEC no la fija.
export function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const members = Object.keys(value).sort().map((name) => `${JSON.stringify(name)}:${canonicalJson(value[name])}`);
    return `{${members.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function contentHashOf(value) {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function versionKeyOf(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value.contentHash === "string") {
    return `hash:${value.contentHash}`;
  }
  return null;
}
