// Fixtures SINTÉTICOS para IMP-09. No son evidencia de campañas reales ni de
// edge: existen para probar la ingeniería de la reserva (aceptación, HOLD,
// solapamientos, acceso/consumo). La ventana de procurement se deriva de la
// regla 3-1-3 documentada (01_shared_campaign_rules.md §1): los tres meses
// anteriores al gap, que termina dos meses antes del inicio de delivery.

import { researchCampaignIdFor } from "../../src/procurement-contract/campaign-contract.mjs";

const SYNTHETIC_PROVENANCE = {
  authority: "SYNTHETIC fixture — no es evidencia de campaña real",
  locator: "test/oos-reservation/fixtures.mjs",
};

function isoDate(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

function addMonths(year, month, delta) {
  const total = year * 12 + (month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function quarterlyWindow(year, quarter) {
  const deliveryStartMonth = (quarter - 1) * 3 + 1;
  const start = addMonths(year, deliveryStartMonth, -4);
  const end = addMonths(year, deliveryStartMonth, -2);
  return {
    windowStart: isoDate(start.year, start.month, 1),
    deadline: isoDate(end.year, end.month, lastDayOfMonth(end.year, end.month)),
  };
}

export function gasQuarterlyCampaign({ year, quarter, eligibility = "ELIGIBLE", completeness = "COMPLETE", ...overrides } = {}) {
  const maturity = `${year}Q${quarter}`;
  const { windowStart, deadline } = quarterlyWindow(year, quarter);
  return {
    campaignId: researchCampaignIdFor("Gas", "Quarterly", maturity),
    product: "Gas",
    mission: "Quarterly",
    maturity,
    eligibility,
    completeness,
    windowStart,
    deadline,
    provenance: { ...SYNTHETIC_PROVENANCE },
    ...overrides,
  };
}

// N campañas consecutivas desde (year, quarter). Cada maturity distinta y en
// orden cronológico.
export function gasQuarterlyRegister({ year, quarter, count, eligibility = "ELIGIBLE", completeness = "COMPLETE" } = {}) {
  const campaigns = [];
  let currentYear = year;
  let currentQuarter = quarter;
  for (let index = 0; index < count; index += 1) {
    campaigns.push(gasQuarterlyCampaign({ year: currentYear, quarter: currentQuarter, eligibility, completeness }));
    currentQuarter += 1;
    if (currentQuarter > 4) {
      currentQuarter = 1;
      currentYear += 1;
    }
  }
  return campaigns;
}

// Reserva sintética válida: 10 campañas elegibles y completas (2 de development,
// 8 selladas) cubriendo 2021Q1..2023Q2.
export function validReservationInput() {
  return {
    reservationId: "SYN-OOS-RESERVATION-1",
    campaigns: gasQuarterlyRegister({ year: 2021, quarter: 1, count: 10 }),
    reservationBasis: "CHRONOLOGICAL_ELIGIBLE",
    overlapResolutions: [],
    createdAtUtc: "2026-09-23T12:00:00Z",
  };
}

// Fuerza un solapamiento de ventana entre dos campañas reservadas: la segunda
// empieza antes de que la primera termine.
export function withWindowOverlap(campaigns, leftMaturity, rightMaturity) {
  const mutated = campaigns.map((campaign) => ({ ...campaign }));
  const right = mutated.find((campaign) => campaign.maturity === rightMaturity);
  const left = mutated.find((campaign) => campaign.maturity === leftMaturity);
  if (right && left) {
    right.windowStart = left.deadline;
  }
  return mutated;
}

// Anida la ventana de procurement de `innerMaturity` dentro de la de
// `outerMaturity`. Las dos pueden ser campañas selladas no adyacentes: sirve
// para probar que la detección cubre cualquier par y no sólo vecinos.
export function withNestedWindowOverlap(campaigns, outerMaturity, innerMaturity) {
  const mutated = campaigns.map((campaign) => ({ ...campaign }));
  const outer = mutated.find((campaign) => campaign.maturity === outerMaturity);
  const inner = mutated.find((campaign) => campaign.maturity === innerMaturity);
  if (outer && inner) {
    inner.windowStart = outer.windowStart;
    inner.deadline = outer.deadline;
  }
  return mutated;
}

export function realDurationResolution(overlaps, action, overrides = {}) {
  return overlaps.map((detected) => ({
    kind: detected.kind,
    between: [...detected.between],
    action,
    basis: {
      authority: "SYNTHETIC audit fixture — estructura real",
      locator: "test/oos-reservation/fixtures.mjs",
    },
    ...overrides,
  }));
}
