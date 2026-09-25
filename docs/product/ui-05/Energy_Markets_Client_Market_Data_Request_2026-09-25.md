We are building the decision inspector and the backtest comparison of the Energy Markets procurement research on real EEX data. Two items are still missing from verifiable sources. Without them, the evaluation window of each Monthly campaign and the official benchmark cannot be shown as exact figures.

Already covered, please do not resend: the historical order book before July 2025 (you confirmed on 2026-09-25 that only trades exist for that period), and execution fees and historical purchases (requested on 2026-09-24).

Please inspect the data sources, subscriptions and exports available to you and provide only verified data or facts with an identifiable source. Do not reconstruct, interpolate or fill gaps. If something cannot be found or is not licensed, say NOT FOUND or NOT AVAILABLE and state where you searched.

1. Official last trading day per contract (highest priority)

For Gas THE Monthly futures (G0BM) and Quarterly futures (G0BQ), every maturity from December 2020 to December 2026:

- first trading day and last trading day, as published by EEX (contract specifications, trading calendar, or expiry calendar), with the document name, version and validity dates.

Today we infer the last trading day from when quotes stop in the data. For Monthly contracts, that shows the contract not quoted on its last exchange day, but we need the official rule to confirm it.

2. Official daily settlement prices

EEX daily settlement prices for the same Gas THE Monthly (G0BM) and Quarterly (G0BQ) contracts, every maturity, from 2020-11-02 to today. Per row: trading date, product and maturity identifiers (ISIN, short code), settlement price in EUR/MWh, and any status flag EEX publishes with it.

The EEX market-data lake you shared has trades and top of book, but no settlement table. We need this to reconcile our benchmark with the official EEX reference price. It does not replace the existing benchmark methodology.

The same export format and endpoints as the existing lake (EEX DataSource) are ideal.

3. Reply format

Per item: the data or file, its source, coverage period, and anything missing. Files can go into the shared folder. For large exports, please tell us the size and the delivery method before sending.
