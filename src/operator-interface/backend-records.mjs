// Backend de registros canónicos para el Operator Interface Boundary.
// Fuente: SPEC v1.1.1 §26.5 (los datos presentados remiten a registros y
// versiones canónicos; la UI no calcula otra verdad), §25.2.2 fila IMP-29
// ("provenance, metadata y datos backend del scope mostrado") y §6.1 (probar
// consumo/identidad de una versión concreta).
//
// Todo lo que la interfaz muestra debe contrastarse contra un manifest PIT
// verificado (buildPitManifest; un objeto armado a mano no acredita nada, por
// eso backendIndexFromManifest devuelve null = fail-closed sin manifest
// verificado). Sin backend verificado, ninguna procedencia, autoridad,
// receipt ni vínculo a recomendación puede aceptarse.
//
// PLACEHOLDER de contrato (no canónico): la SPEC §26.5 exige "comando
// explícitamente autorizado" y "receipt aplicable" pero no fija la sintaxis
// de la referencia a un registro/versión. Forma asumida (revisar con future
// DEP-25/§18 artifacts): "<recordKey>@<revisionId>".

import { isVerifiedPitManifest } from "../pit-views/views.mjs";

export function parseBackendRef(ref) {
  if (typeof ref !== "string") {
    return null;
  }
  const atIndex = ref.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === ref.length - 1) {
    return null;
  }
  const recordKey = ref.slice(0, atIndex);
  const revisionId = ref.slice(atIndex + 1);
  if (recordKey.trim().length === 0 || revisionId.trim().length === 0) {
    return null;
  }
  return { recordKey, revisionId };
}

export function backendRefOf(record) {
  if (!record || typeof record.key !== "string" || typeof record.revisionId !== "string") {
    return null;
  }
  return `${record.key}@${record.revisionId}`;
}

// Índice de registros canónicos desde un manifest verificado. Devuelve el
// índice, o null si el manifest no proviene de buildPitManifest (fail-closed:
// sin fuente canónica verificada nada remite a registros, §26.5/§25.2).
export function backendIndexFromManifest(manifest) {
  if (!isVerifiedPitManifest(manifest) || !Array.isArray(manifest.records)) {
    return null;
  }
  const byIdentity = new Map(
    manifest.records
      .filter((record) => typeof record?.key === "string" && typeof record?.revisionId === "string")
      .map((record) => [`${record.key}::${record.revisionId}`, record]),
  );
  return Object.freeze({ manifest: Object.freeze(manifest), byIdentity });
}

// Resuelve una procedencia a su registro canónico: `null` nunca remite.
export function resolveBackendRecord(index, recordKey, revisionId) {
  if (index === null || index.byIdentity === undefined) {
    return null;
  }
  return index.byIdentity.get(`${recordKey}::${revisionId}`) ?? null;
}
