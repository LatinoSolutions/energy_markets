// Restricciones duras del MUST NOT CHANGE de §25.1 fila IMP-20: "No ampliar
// P5; no 23 drivers obligatorios ni meta-policy automática" y límites de
// autoridad de §§7.1/9/10 (un solo reward global; ninguna admisión automática
// por outcome; ninguna autoridad durante research). Cada guard es fail-closed.

import { DEP15_LANE, DEP16_LANE, getLayer } from "./layers.mjs";
import { TOPOLOGIES } from "./topologies.mjs";

const HYBRID_GLOBAL_META_POLICY = "HYBRID_GLOBAL_META_POLICY";

export const P5_INTEGRITY_GUARD = {
  specCitation: "§25.1 fila IMP-20 MUST NOT CHANGE; §25.2 IMP-20 REQUIRES (resultado y límites del núcleo conservados); §13 (P5 congelado); §13.9 no rescue",
  protectedAspects:
    "Población/campaña de P5, baseline A0, frontera OOS reservada, identidad/configuración S1 frozen, veredicto conservado. El diseño nuevo puede inscribirse sobre la evidencia, no reabrirla.",
};

const P5_FORBIDDEN_FIELDS = [
  "p5Ampliation",
  "p5Modification",
  "rescueLayer",
  "reopenOos",
  "rebaselineA0",
  "modifyS1Identity",
];

// Un experimento no puede alterar el primer experimento de P5 ni usar el
// experimento nuevo para rescatarlo.
export function assertNoP5Ampliation(design) {
  const errors = [];

  const declarations = design?.nonAmpliation ?? {};
  for (const field of ["population", "baselineA0", "oosFrontier", "s1Identity", "conservedVerdict"]) {
    if (declarations[field] !== true) {
      errors.push({
        field: `nonAmpliation.${field}`,
        code: "P5_AMPLIATION_UNDECLARED",
        message: `El diseño debe declarar explícitamente que no amplía/modifica ${field} de P5 (§25.1 MUST NOT CHANGE; §13.9).`,
      });
    }
  }

  for (const field of P5_FORBIDDEN_FIELDS) {
    if (design?.[field]) {
      errors.push({
        field,
        code: "P5_AMPLIATION_DECLARED",
        message: `El diseño declara ${field}: ampliar/rescatar P5 está prohibido (§25.1 MUST NOT CHANGE; §13.9 no rescue).`,
      });
    }
  }

  return { ok: errors.length === 0, errors };
}

const DRIVER_LAYER_IDS = ["DRIVERS"];

// Los drivers se auditan/mapan por muestra; ningún experimento puede exigir
// los 23 bloques como features obligatorias ni proposar categorías nuevas.
export function assertNoMandatory23Drivers(design) {
  const errors = [];

  for (const layer of design?.layers ?? []) {
    if (!DRIVER_LAYER_IDS.includes(layer.layerId)) {
      continue;
    }

    if (layer.taxonomyClosed !== true) {
      errors.push({
        field: "layers[].taxonomyClosed",
        code: "TAXONOMY_OPEN_UNDECLARED",
        message: "El experimento de drivers debe declarar la taxonomía cerrada (§7.2.5); no se añaden categorías por intuición.",
      });
    }
    if (layer.mandatoryFeatures !== false) {
      errors.push({
        field: "layers[].mandatoryFeatures",
        code: "MANDATORY_23_FEATURES",
        message: "Los 23 bloques son categorías conceptuales, no 23 features obligatorias (§7.2); el experimento debe declarar mapping/muestra con ablation, no cobertura forzada.",
      });
    }
    if (!Array.isArray(layer.auditMappingScope) || layer.auditMappingScope.length === 0) {
      errors.push({
        field: "layers[].auditMappingScope",
        code: "MISSING_AUDIT_MAPPING",
        message: "El experimento de drivers necesita su scope de audit/mapping declarado (DEP-16; §25.2 REQUIRES_AUDIT).",
      });
    }
  }

  return { ok: errors.length === 0, errors };
}

// Ninguna outcome automática: la meta-policy no se automatiza, la admisión
// sigue §8.7, ninguna capa gana autoridad durante research y no existe
// reward económico independiente por capa.
export function assertNoAutomaticAuthority(design) {
  const errors = [];

  for (const layer of design?.layers ?? []) {
    if (layer.autoAdmission === true || layer.grantsAuthority === true) {
      errors.push({
        field: "layers[].autoAdmission/grantsAuthority",
        code: "AUTO_AUTHORITY_CLAIMED",
        message: "Ningún diseño IMP-20 concede admisión u autoridad automática; la admisión sigue §8.7 y ninguna capa gana autoridad durante research (§25.1 MUST NOT CHANGE; §§8.7.4, 16–18).",
      });
    }
    if (layer.ownEconomicReward === true) {
      errors.push({
        field: "layers[].ownEconomicReward",
        code: "SECOND_REWARD",
        message: "Existe un solo Global Procurement Reward; cada Strategy no posee un economic reward independiente (§10.1).",
      });
    }
  }

  const topology = design?.topology ?? design?.topologyId;
  if (topology === HYBRID_GLOBAL_META_POLICY && design?.topologyResearchOnly !== true) {
    errors.push({
      field: "topologyResearchOnly",
      code: "AUTOMATIC_META_POLICY",
      message: "La topología hybrid/global meta-policy sólo puede declararse como candidata de research, sin activación automática ni cambio de P5/P7 (§8.6; §9.2; MUST NOT CHANGE §25.1).",
    });
  }

  if (design?.automaticPromotionUponOutcome === true) {
    errors.push({
      field: "automaticPromotionUponOutcome",
      code: "AUTOMATIC_PROMOTION",
      message: "Un outcome favorable no activa nada automáticamente; consumes gates de §15–18 e IMP-24 por versión (§10.2, §25.2).",
    });
  }

  return { ok: errors.length === 0, errors };
}

// Cada capa del diseño debe existir en el catálogo y declarar su estático
// rol normativo; una capa con semántica editada no es una instancia más.
export function assertLayersAreRegisteredAndFrozen(design) {
  const errors = [];

  for (const layer of design?.layers ?? []) {
    const catalog = getLayer(layer.layerId);
    if (!catalog) {
      errors.push({
        field: "layers[].layerId",
        code: "UNKNOWN_LAYER",
        message: `Capa no registrada en el catálogo: ${layer?.layerId}. Sólo S2–S5, Z y DRIVERS son los candidatos de IMP-20 (§25.1; §24 DEP-15/16).`,
      });
      continue;
    }
    if (layer.frozenSemantics !== catalog.frozenSemantics) {
      errors.push({
        field: "layers[].frozenSemantics",
        code: "FROZEN_SEMANTICS_EDITED",
        message: `La capa ${catalog.layerId} debe conservar su semántica frozen de la SPEC; un experimento instancia, no edita (§8; §7.1/§7.2).`,
      });
    }
    if (layer.noEconomicParameters !== true) {
      errors.push({
        field: "layers[].noEconomicParameters",
        code: "ECONOMIC_PARAMETERS_UNDECLARED",
        message: "Los parámetros de la capa no pueden redefinir el objetivo económico (§10.1; §8.6 calibración compartida).",
      });
    }

  }

  return { ok: errors.length === 0, errors };
}
