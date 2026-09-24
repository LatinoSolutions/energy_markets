// Tests de misiones separadas, identidad y reserva propia (§23; DEP-12).

import { test } from "node:test";
import assert from "node:assert/strict";

import { MISSION_IDS, validateIdentity, IMP22_SPEC_IDENTITY } from "../../src/imp22-sizing/identity.mjs";
import {
  MISSIONS,
  MISSION_MINIMUM_EVIDENCE,
  getMission,
  isMinimumEvidenceInstalled,
  validateMissionExtension,
} from "../../src/imp22-sizing/missions.mjs";
import { validateMissionReserve, RESERVE_STATUS } from "../../src/imp22-sizing/reserve.mjs";
import { validateSizingCandidate, SIZING_FAMILIES, CONSTRAINT_STATUSES } from "../../src/imp22-sizing/sizing-candidate.mjs";
import { deepCloneDesign } from "./fixtures.mjs";

function okIdentityFixture() {
  return {
    experimentId: "IMP22-EX-SZ09-01",
    missionId: "GAS-QUARTERLY",
    actionSpaceVersion: "BUY-WAIT-V1",
    createdAt: "2026-09-24T00:00:00.000Z",
    specId: IMP22_SPEC_IDENTITY.id,
    specVersion: IMP22_SPEC_IDENTITY.version,
    specSha256: IMP22_SPEC_IDENTITY.sha256,
    parentImp: "IMP-22",
    scope: "Sizing research Gas Quarterly",
    objectVersion: "1.0",
    protocolVersion: "1.0",
  };
}

function syntheticGuard(projectedQuantity, remainingVolume) {
  if (projectedQuantity <= 0) return 0;
  return Math.min(projectedQuantity, remainingVolume);
}

test("las cuatro Mission están registradas separadamente con sus mínimos y su B propio", () => {
  assert.deepEqual([...MISSION_IDS].sort(), ["GAS-MONTHLY", "GAS-QUARTERLY", "POWER-MONTHLY", "POWER-QUARTERLY"]);
  for (const mission of MISSIONS) {
    assert.equal(mission.ownBenchmarkB, true, mission.missionId);
    assert.equal(mission.separateEvaluation, true, mission.missionId);
    assert.equal(isMinimumEvidenceInstalled(mission), true, mission.missionId);
  }
  // Mínimos DEP-12 §24 literales: Quarterly >=8/>=2 años; Monthly >=24 meses.
  assert.deepEqual(MISSION_MINIMUM_EVIDENCE["GAS-MONTHLY"], { cadence: "MONTHLY", minMonthsOos: 24 });
  assert.deepEqual(MISSION_MINIMUM_EVIDENCE["POWER-QUARTERLY"], { cadence: "QUARTERLY", minCompleteQuartersOos: 8, minCalendarYearsOos: 2 });
});

test("acortar el estándar de evidencia de una Mission deja falta circunscripta fail-closed (DEP-12)", () => {
  const degraded = { ...getMission("POWER-MONTHLY"), minimumEvidence: { cadence: "MONTHLY", minMonthsOos: 18 } };
  assert.equal(isMinimumEvidenceInstalled(degraded), false);

  const invalidMission = { ...getMission("GAS-MONTHLY"), separateEvaluation: false };
  const result = validateMissionExtension(invalidMission.missionId);
  assert.equal(result.ok, true, "validateMissionExtension juzga el registro canónico, no la copia degradada");
  assert.equal(getMission("GAS-SQUARED"), null, "una Mission desconocida no existe: no se inventa");
});

test("identidad: Mission conocida, action space versionado e identidad de instancia §25.2.1 obligatorios", () => {
  const ok = validateIdentity({
    experimentId: "IMP22-EX-SZ09-01",
    missionId: "GAS-QUARTERLY",
    actionSpaceVersion: "BUY-WAIT-V1",
    createdAt: "2026-09-24T00:00:00.000Z",
    specId: IMP22_SPEC_IDENTITY.id,
    specVersion: IMP22_SPEC_IDENTITY.version,
    specSha256: IMP22_SPEC_IDENTITY.sha256,
    parentImp: "IMP-22",
    scope: "Sizing research Gas Quarterly",
    objectVersion: "1.0",
    protocolVersion: "1.0",
  });
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));

  const noActionSpace = { ...okIdentityFixture(), actionSpaceVersion: undefined };
  const noActionSpaceResult = validateIdentity(noActionSpace);
  assert.equal(noActionSpaceResult.ok, false);
  assert.ok(noActionSpaceResult.errors.some((error) => error.code === "ACTION_SPACE_VERSION_REQUIRED"));

  // §25.2.1: sin SPEC hash/parent/scope no hay binding de procedencia (H3).
  const bare = validateIdentity({
    experimentId: "IMP22-EX-SZ09-01",
    missionId: "GAS-QUARTERLY",
    actionSpaceVersion: "BUY-WAIT-V1",
    createdAt: "2026-09-24T00:00:00.000Z",
  });
  assert.equal(bare.ok, false);
  for (const code of ["SPEC_IDENTITY_INVALID", "PARENT_IMP_REQUIRED", "SCOPE_REQUIRED", "OBJECT_VERSION_REQUIRED", "PROTOCOL_VERSION_REQUIRED"]) {
    assert.ok(bare.errors.some((error) => error.code === code), code);
  }

  // El parent está fijado: una instancia no cambia de parent por su cuenta.
  const wrongParent = validateIdentity({ ...okIdentityFixture(), parentImp: "IMP-20" });
  assert.ok(wrongParent.errors.some((error) => error.code === "PARENT_IMP_REQUIRED"));
});

test("reserva: frontera ex-ante, cronológico sin shuffle, HOLD en insuficiencia y sin IMP-09", () => {
  const reserve = {
    reserveId: "IMP22-RSV-09-01",
    missionId: "GAS-MONTHLY",
    minimumEvidence: MISSION_MINIMUM_EVIDENCE["GAS-MONTHLY"],
    status: RESERVE_STATUS.HOLD,
    split: { boundary: "2026-08-31T23:59:59Z", randomShuffle: false },
    reusesGasQuarterlyImp09Reservation: false,
    missionAuditScopeDeclaresOwnHistory: true,
  };
  assert.equal(validateMissionReserve(reserve).ok, true, JSON.stringify(validateMissionReserve(reserve)));

  const shuffled = structuredClone(reserve);
  shuffled.split.randomShuffle = true;
  assert.ok(validateMissionReserve(shuffled).errors.some((error) => error.code === "RANDOM_SHUFFLE_FORBIDDEN"));

  const reservedWithoutBoundary = structuredClone(reserve);
  reservedWithoutBoundary.status = RESERVE_STATUS.RESERVED;
  delete reservedWithoutBoundary.split.boundary;
  const boundaryCheck = validateMissionReserve(reservedWithoutBoundary);
  assert.equal(boundaryCheck.ok, false);
  assert.ok(boundaryCheck.errors.some((error) => error.code === "SPLIT_BOUNDARY_REQUIRED"));

  const reuseImp09 = structuredClone(reserve);
  reuseImp09.reusesGasQuarterlyImp09Reservation = true;
  const reuseCheck = validateMissionReserve(reuseImp09);
  assert.equal(reuseCheck.ok, false);
  assert.ok(reuseCheck.errors.some((error) => error.code === "OOS_REUSE_FORBIDDEN"));

  const noOwnAudit = structuredClone(reserve);
  noOwnAudit.missionAuditScopeDeclaresOwnHistory = false;
  assert.ok(validateMissionReserve(noOwnAudit).errors.some((error) => error.code === "OWN_HISTORY_AUDIT_REQUIRED"));
});

test("candidato LEARNED exige protocolo versionado; candidato exige estado de audit explícito", () => {
  const learnedWithoutProtocol = {
    identity: { sizingCandidateId: "IMP22-SZ-07-01", parametrizationVersion: "v1", missionId: "POWER-MONTHLY" },
    family: SIZING_FAMILIES.LEARNED,
    constraintStatus: CONSTRAINT_STATUSES.AUDIT_PENDING,
    constraints: {
      lotSizeAvailable: false,
      roundingRuleAvailable: false,
      feasibilityGuardsInstalled: true,
      guardFunction: syntheticGuard,
      unknownsDeclared: ["lotSize", "roundingRule"],
    },
    evaluationBinding: { sizeOnlyArm: true },
  };
  const learnedCheck = validateSizingCandidate(learnedWithoutProtocol);
  assert.equal(learnedCheck.ok, false);
  assert.ok(learnedCheck.errors.some((error) => error.code === "LEARNED_PROTOCOL_REQUIRED"));

  const noStatus = deepCloneDesign(learnedWithoutProtocol);
  delete noStatus.constraintStatus;
  assert.ok(validateSizingCandidate(noStatus).errors.some((error) => error.code === "CONSTRAINT_STATUS_KNOWN"));
});

test("el guard de factibilidad es determinista y clampéado a RemainingVolume (§4.2)", () => {
  assert.equal(syntheticGuard(7, 10), 7);
  assert.equal(syntheticGuard(-2, 10), 0);
  assert.equal(syntheticGuard(25, 10), 10);
  assert.equal(syntheticGuard(5, 0), 0);
});
