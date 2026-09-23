// Evaluación determinista del caso real IMP-09: evidencia EEX fijada +
// calendario oficial EEX -> buildEligibilityRegister -> reserveSealedOos.
// Entradas (todas ligadas por SHA-256):
//   operations/audit/IMP-09/eex-quarterly-episode-evidence.json (+ SHA256SUMS)
//   operations/audit/IMP-09/eex-exchange-calendar.json
//   01_campaigns/* del paquete verificado del cliente (hash en el intake receipt)
//   P-006: identidad determinista (OWNER_P006_CONFIRMATION en campaign-contract)
// Salida: operations/audit/IMP-09/eex-quarterly-register-eval.json
// No modifica la matriz IMP-03 ni nombre en RUN el OOS como aceptado.
//
// El artefacto de salida está pinneado por SHA256SUMS: es una función pura de
// sus entradas. Por eso no lleva timestamp de reloj (un createdAtUtc rompería
// su reproducibilidad byte a byte al regenerarlo; el "cuándo" queda en el
// receipt/commit, no en el contenido evaluado).

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { buildEligibilityRegister } from "../../../src/oos-reservation/register-builder.mjs";
import { evaluateImp09Acceptance, reserveSealedOos, CHRONOLOGICAL_RESERVATION_BASIS } from "../../../src/oos-reservation/reservation.mjs";

const AUDIT_DIR = new URL(".", import.meta.url).pathname.replace(/\/$/, "");
const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");

// Función pura: mismas entradas -> mismo artefacto. La expone el test de
// regresión para comprobar el determinismo sin escribir en el worktree.
export function buildQuarterlyRegisterEvaluation({ evidence, evidenceHash, calendar, calendarHash, clientRulesSha256, p006Hash }) {
  const cutoffIso = evidence.identity.tobPartitions.last;

  const built = buildEligibilityRegister({
    sourceHashes: { clientPackageCampaignRules: clientRulesSha256, eexEvidence: evidenceHash },
    p006: { sha256: p006Hash },
    evidenceSha256: evidenceHash,
    asOfIso: cutoffIso,
    exchangeCalendar: { ...calendar, sha256: calendarHash },
    evidence: {
      snapshot: {
        identity: `${evidence.identity.lakeRoot} @@ _logs/extract.complete sha256=${evidence.identity.snapshotMarker.sha256}`,
        sha256: evidence.identity.snapshotMarker.sha256,
      },
      episodes: evidence.episodes,
    },
  });

  const reservation = reserveSealedOos({
    campaigns: built.register,
    reservationBasis: CHRONOLOGICAL_RESERVATION_BASIS,
    reservationBinding: {
      cutoffIso,
      sourceHashes: {
        clientPackageCampaignRules: clientRulesSha256,
        eexEvidence: evidenceHash,
        exchangeCalendar: calendarHash,
      },
    },
  });

  return {
    artifactKind: "IMP-09_QUARTERLY_REGISTER_EVALUATION",
    cutoffIso,
    register: {
      episodeCount: built.register.length,
      eligibleCount: built.register.filter((episode) => episode.eligibility === "ELIGIBLE").length,
      eligibleComplete: built.register.filter((episode) => episode.eligibility === "ELIGIBLE" && episode.completeness === "COMPLETE").map((episode) => ({
        maturity: episode.maturity,
        windowStart: episode.windowStart,
        deadline: episode.deadline,
      })),
      computedGaps: built.blockedBy,
    },
    reservation: {
      decision: reservation.decision,
      blockedBy: reservation.blockedBy,
      reason: reservation.reason,
      sealedOosCount: reservation.sealedOosCount,
    },
    acceptance: evaluateImp09Acceptance(reservation),
    hashes: {
      eexEvidence: evidenceHash,
      exchangeCalendar: calendarHash,
      clientPackageCampaignRules: clientRulesSha256,
    },
  };
}

function main() {
  const evidencePath = `${AUDIT_DIR}/eex-quarterly-episode-evidence.json`;
  const calendarPath = `${AUDIT_DIR}/eex-exchange-calendar.json`;
  const evidenceHash = sha256(readFileSync(evidencePath));
  const calendarHash = sha256(readFileSync(calendarPath));

  const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
  const calendar = JSON.parse(readFileSync(calendarPath, "utf8"));

  const CLIENT_PACKAGE_ROOT = "/srv/hot-data/oficina-data/client-inputs/energy-markets/ENERGY_MARKETS_CLIENT_INPUTS_2026-09-23/full-package";
  const clientRulesSha256 = sha256(readFileSync(`${CLIENT_PACKAGE_ROOT}/01_campaigns/01_shared_campaign_rules.md`));
  const p006Hash = sha256(readFileSync(new URL("../../../src/procurement-contract/campaign-contract.mjs", import.meta.url)));

  const summary = buildQuarterlyRegisterEvaluation({ evidence, evidenceHash, calendar, calendarHash, clientRulesSha256, p006Hash });

  writeFileSync(`${AUDIT_DIR}/eex-quarterly-register-eval.json`, JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
