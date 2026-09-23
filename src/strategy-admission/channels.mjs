// Tres canales canónicos de entrada al Strategy Admission Contract.
// Fuente: SPEC v1.1 §8.7.1 (tabla de canales) y §8.7.3 (provenance).
// Los tres canales convergen en un único contrato; se conserva la provenance
// del canal y de su evidencia. Ningún canal acredita edge ni autoridad.

export const CHANNEL = Object.freeze({
  HYPOTHESIS_TO_CANDIDATE: "HYPOTHESIS_TO_CANDIDATE",
  RESEARCH_DISCOVERY: "RESEARCH_DISCOVERY",
  PREDEFINED_STRATEGY_BY_BRU: "PREDEFINED_STRATEGY_BY_BRU",
});

export const INTAKE_CHANNELS = Object.freeze({
  [CHANNEL.HYPOTHESIS_TO_CANDIDATE]: Object.freeze({
    id: CHANNEL.HYPOTHESIS_TO_CANDIDATE,
    label: "Channel 1: Hypothesis → Strategy Candidate",
    section: "§8.7.1",
    canonicalPath:
      "Hypothesis → falsifiable experiment → evidence / refutation → survival if supported → formalization as Strategy Candidate → Strategy Admission Contract",
    discoveryRequired: true,
    requiresDiscoveryFlag: false,
    provenanceRequired: Object.freeze(["hypothesisRef", "experimentRef", "outcomeRef"]),
  }),
  [CHANNEL.RESEARCH_DISCOVERY]: Object.freeze({
    id: CHANNEL.RESEARCH_DISCOVERY,
    label: "Channel 2: Research Discovery → Hypothesis → Strategy Candidate",
    section: "§8.7.1",
    canonicalPath:
      "Research observation / discovery → formalized research question → falsifiable Hypothesis → controlled experiment → evidence / refutation → Strategy Candidate if justified → Strategy Admission Contract",
    discoveryRequired: true,
    requiresDiscoveryFlag: false,
    provenanceRequired: Object.freeze(["discoveryRef", "researchQuestionRef", "hypothesisRef"]),
  }),
  [CHANNEL.PREDEFINED_STRATEGY_BY_BRU]: Object.freeze({
    id: CHANNEL.PREDEFINED_STRATEGY_BY_BRU,
    label: "Channel 3: Predefined Strategy supplied by Bru",
    section: "§8.7.1",
    canonicalPath:
      "Predefined Strategy → formal implementation specification → versioned Strategy Candidate → controlled testing / ablation / OOS as applicable → Strategy Admission Contract",
    discoveryRequired: false,
    requiresDiscoveryFlag: true,
    provenanceRequired: Object.freeze(["sourceRef"]),
  }),
});

export const CHANNEL_IDS = Object.freeze(Object.keys(INTAKE_CHANNELS));

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function isChannelId(value) {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(INTAKE_CHANNELS, value);
}

// §8.7.1: el canal 3 puede omitir discovery; ningún canal omite la validación.
// La bandera discoveryOmitted se exige explícita en el canal 3 para que la
// omisión sea trazable y no un silencio.
export function validateChannelProvenance(channelId, provenance) {
  const errors = [];
  const channel = isChannelId(channelId) ? INTAKE_CHANNELS[channelId] : null;

  if (!channel) {
    errors.push({
      field: "intakeChannel",
      code: "UNKNOWN_CHANNEL",
      message: `"${channelId}" no es uno de los tres canales canónicos de §8.7.1.`,
      allowedChannels: CHANNEL_IDS,
    });
    return { ok: false, errors };
  }

  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) {
    errors.push({
      field: "provenance",
      code: "MISSING_PROVENANCE",
      message: `El canal "${channel.id}" exige provenance de la propuesta y su evidencia.`,
    });
    return { ok: false, errors };
  }

  for (const field of channel.provenanceRequired) {
    if (!isNonEmptyString(provenance[field])) {
      errors.push({
        field: `provenance.${field}`,
        code: "MISSING_PROVENANCE_FIELD",
        message: `El canal "${channel.id}" exige provenance.${field}.`,
      });
    }
  }

  if (channel.discoveryRequired && provenance.discoveryOmitted === true) {
    errors.push({
      field: "provenance.discoveryOmitted",
      code: "DISCOVERY_REQUIRED",
      message: `El canal "${channel.id}" no puede omitir discovery (§8.7.1).`,
    });
  }

  if (channel.requiresDiscoveryFlag && typeof provenance.discoveryOmitted !== "boolean") {
    errors.push({
      field: "provenance.discoveryOmitted",
      code: "MISSING_DISCOVERY_FLAG",
      message:
        "El canal 3 debe declarar discoveryOmitted de forma explícita: puede omitir discovery, pero no validación (§8.7.1).",
    });
  }

  return { ok: errors.length === 0, errors, channel };
}
