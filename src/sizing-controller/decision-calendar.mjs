// Calendario de decisión predeclarado del baseline A0. Fuente: SPEC v1.1.1
// §13.2 P5.2 (cada eligible trading day de la procurement window es una
// decision opportunity predeclarada), §13.4 (las fechas reales se instancian
// desde el Procurement Contract) y DEP-03 (calendario de campaña auditado).
// El calendario no se deriva del benchmark ni de precios: sólo de las fechas
// de negociación entregadas por el caller (IMP-02 deadline/trade rows).

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value) {
  return typeof value === "string" && ISO_DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function buildDecisionCalendar({ tradingDates, campaignId } = {}) {
  const errors = [];
  if (!Array.isArray(tradingDates)) {
    errors.push({ field: "tradingDates", code: "MISSING_TRADING_DATES", message: "tradingDates debe ser un array de fechas ISO." });
  }
  if (typeof campaignId !== "string" || campaignId.trim().length === 0) {
    errors.push({ field: "campaignId", code: "MISSING_CAMPAIGN_ID", message: "El calendario debe pertenecer a un campaignId (§14.2)." });
  }
  if (Array.isArray(tradingDates)) {
    tradingDates.forEach((date, index) => {
      if (!isIsoDate(date)) {
        errors.push({ field: `tradingDates[${index}]`, code: "INVALID_DATE", message: `"${date}" no es fecha ISO YYYY-MM-DD.` });
      }
    });
    const sorted = [...tradingDates].sort();
    if (sorted.length !== new Set(sorted).size) {
      errors.push({ field: "tradingDates", code: "DUPLICATE_DATES", message: "El calendario no puede repetir opportunities." });
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    calendar: {
      calendarId: errors.length === 0 ? `CAL-${campaignId}` : null,
      campaignId: errors.length === 0 ? campaignId : null,
      opportunities: errors.length === 0 ? [...tradingDates].sort().map((date) => ({ date, scheduled: true })) : [],
      scheduledOpportunitiesCount: errors.length === 0 ? tradingDates.length : 0,
    },
  };
}

// Oportunidades restantes a partir de un decision time (fecha inclusive;
// inicio incluido, final excluido no aplica aquí porque las opportunities
// son fechas completas predeclaradas).
export function remainingOpportunities(calendar, currentDate) {
  if (!calendar || typeof calendar !== "object" || !Array.isArray(calendar.opportunities)) {
    return { ok: false, code: "INVALID_CALENDAR" };
  }
  const opportunities = Array.isArray(calendar.opportunities) ? calendar.opportunities : [];
  if (!isIsoDate(currentDate)) {
    return { ok: false, code: "INVALID_CURRENT_DATE", count: 0 };
  }
  return {
    ok: true,
    count: opportunities.filter((o) => o.date >= currentDate).length,
  };
}

// Calendario auditable: toda opportunity predeclarada tiene fecha y flag.
export function validateDecisionCalendar(calendar) {
  const errors = [];
  if (!calendar || typeof calendar !== "object" || Array.isArray(calendar)) {
    return { ok: false, errors: [{ field: "calendar", code: "MISSING_CALENDAR", message: "Calendario ausente." }] };
  }
  if (!Array.isArray(calendar.opportunities)) {
    errors.push({ field: "opportunities", code: "MISSING_OPPORTUNITIES", message: "El calendario no declara opportunities." });
  }
  if (typeof calendar.scheduledOpportunitiesCount !== "number" || !Number.isInteger(calendar.scheduledOpportunitiesCount) || calendar.scheduledOpportunitiesCount < 1) {
    errors.push({ field: "scheduledOpportunitiesCount", code: "INVALID_COUNT", message: "El conteo de opportunities debe ser un entero >= 1." });
  }
  return { ok: errors.length === 0, errors };
}
