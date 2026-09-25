// Fixtures sintéticas para las reglas de TR-01. Reproducen la forma de las
// columnas reales del lago EEX (vistas en
// /srv/hot-data/EEX/table=eex_derivative_trade) sin copiar datos de mercado: los
// valores son inventados y sólo prueban la regla.

export function tradeRow(overrides = {}) {
  return {
    AgrsrAct: "BUY",
    Area: "THE",
    Cmdty: "NATGAS",
    Currency: "EUR",
    ExpiryDate: "2025-12-31",
    FromBrokenSpread: "false",
    InstrumentISIN: "ISIN-DEFAULT",
    InstrumentType: "Simple Instrument",
    Maturity: "202512",
    ProductISIN: "PRODUCT-DEFAULT",
    Px: "32.5",
    ShortCode: "G0BM",
    Sz: "1",
    Tm: "2025-11-20T10:00:00.000000Z",
    TrdDate: "2025-11-20",
    TrdID: "1000",
    TrdType: "Exchange",
    UOM: "MWh",
    UpdtAct: "New",
    VolumeOnly: "",
    ...overrides,
  };
}

export function deleteRow(overrides = {}) {
  return tradeRow({
    UpdtAct: "Delete",
    AgrsrAct: "",
    Tm: "2025-11-20T10:30:00.000000Z",
    ...overrides,
  });
}

export function sourceCandidatesFixture({ archiveVerified = false, archivePresent = true, comparison = null } = {}) {
  return {
    documentKind: "TR-01_SOURCE_CANDIDATES",
    candidates: [
      {
        id: "EEX_LAKE",
        path: "/lake",
        kind: "lake",
        present: true,
        sha256Verified: false,
        inventory: { tables: ["eex_derivative_trade"], dateMax: "2026-07-28" },
      },
      {
        id: "CLIENT_SEALED_ARCHIVE",
        path: "/archive.tar.zst",
        kind: "archive",
        present: archivePresent,
        sha256Verified: archiveVerified,
        inventory: archiveVerified ? { tables: ["eex_derivative_trade", "eex_derivative_reference"], dateMax: "2026-09-11" } : null,
      },
    ],
    comparison,
  };
}
