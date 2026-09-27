import { mkdtempSync, statfsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A full /tmp must not turn a reproducible fixture read into a false failure.
// Prefer the configured OS temporary directory; /var/tmp is the standard
// filesystem-backed fallback on the Linux host when tmpfs has no inodes left.
export function mkdtempWithFallback(prefix, { preferred = tmpdir(), fallback = "/var/tmp" } = {}) {
  let lastError;
  for (const base of new Set([preferred, fallback])) {
    try {
      if (statfsSync(base).ffree < 10_000) continue;
      return mkdtempSync(join(base, prefix));
    } catch (error) {
      if (!["ENOSPC", "EACCES", "EROFS", "ENOENT"].includes(error?.code)) throw error;
      lastError = error;
    }
  }
  throw new Error("No writable temporary directory with sufficient free inodes", { cause: lastError });
}
