// Fila REAL de trade EEX copiada del lake para derivar el deadline del episodio
// 2021Q1 de Gas Quarterly. Fixture para builders y tests: NO se lee el lago de
// 93 GB. Fuente verificada 23-sep-2026:
//   /srv/hot-data/EEX/table=eex_derivative_trade/cmdty=NATGAS/area=THE/
//     trd_date=2020-11-30/pull_id=d1d9d1850f55944080d9d4af82ba9c47da9b9706f630005c4394f2dd9c4c476b/part.parquet
//   sha256(part.parquet) = 65966b6e0ad593473de9f366ee20e100af8c0417700c0715bf7872a468219a18
//   fila citada por el review energy-markets-IMP-02-20260923-204302-claude-revisar:
//   _row_sha256 = 8c9ab52167f581e2414258526ba4630fd8fd0dc7e0842ce14304e4fe585fc0b2
// La convención 3-1-3 y la regla de cierre provienen del paquete cliente
// verificado (01_campaigns/01_shared_campaign_rules.md §1–§2 y §3).
export const EEX_QUARTERLY_DEADLINE_EVIDENCE = {
  "2021Q1": {
    lake: {
      table: "eex_derivative_trade",
      cmdty: "NATGAS",
      area: "THE",
      partition: "trd_date=2020-11-30",
      pullId: "d1d9d1850f55944080d9d4af82ba9c47da9b9706f630005c4394f2dd9c4c476b",
      rel: "table=eex_derivative_trade/cmdty=NATGAS/area=THE/trd_date=2020-11-30/pull_id=d1d9d1850f55944080d9d4af82ba9c47da9b9706f630005c4394f2dd9c4c476b/part.parquet",
      parquetSha256: "65966b6e0ad593473de9f366ee20e100af8c0417700c0715bf7872a468219a18",
    },
    tradeRows: [
      {
        _pull_id: "d1d9d1850f55944080d9d4af82ba9c47da9b9706f630005c4394f2dd9c4c476b",
        _request_path: "/trd/derivatives/NATGAS/THE/2020-11-30",
        _retrieved_at_utc: "2026-06-06T00:00:00.0000000+00:00",
        _response_sha256: "4170d7e9258dd331d7bd9add1077c129a998af549bfd802469ed18db43da3136",
        _row_sha256: "8c9ab52167f581e2414258526ba4630fd8fd0dc7e0842ce14304e4fe585fc0b2",
        _api_category: "market-data",
        _endpoint_family: "trd",
        AgrsrAct: "SELL",
        Area: "THE",
        Cmdty: "NATGAS",
        Currency: "EUR",
        ExpiryDate: "2020-12-29",
        FromBrokenSpread: "false",
        InstrumentISIN: "DE000C273M16",
        InstrumentType: "Simple Instrument",
        Maturity: "202101",
        ProductISIN: "DE000A0MEW99",
        Px: "15.15",
        ShortCode: "G0BQ",
        Sz: "3",
        Tm: "2020-11-30T16:39:10.124829Z",
        TrdDate: "2020-11-30",
        TrdID: "1966",
        TrdType: "Exchange",
        TrdVol: "6477.0",
        UOM: "MWh",
        UpdtAct: "New",
        VolumeOnly: "",
      },
    ],
  },
};
