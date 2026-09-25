# BT-05 — primer backtest real (P-011)

Lanzado por Bru desde el botón **Run backtest** de `/backtests` el 2026-09-25 a las 23:16:12 UTC
(`requestedBy: "ui"`), con el servicio `energy-markets-ui.service` en `214ba05`.

Copias byte a byte del checkout de producción `/srv/hot-data/energy-markets/app`
(`operations/backtest-runs/` no está versionado):

| Archivo | Origen | sha256 |
|---|---|---|
| `RUN_RECEIPT.json` | `operations/backtest-runs/BT-RUN-94a2d47e…f7fd/attempt-1/RUN_RECEIPT.json` | `01c35539b760b8a8ac32483d5be98d69fc090aa5a2ff616fec7a921aabc8ce58` |
| `REGISTRY-RUN_CLOSED.jsonl` | línea 1 de `operations/backtest-runs/REGISTRY.jsonl` | `9f32e35ccebc0c2e5b99af44b635430627b95a0f519fcb1f84546050f04448f3` |

## Lo que mide

- `status: SUCCEEDED`, exit 0, `reproducesCommittedResults: true` (resultado sha256 `660d14a0…77f8`).
- Duración: 229 ms (`startedAt` 23:16:12.695Z → `finishedAt` 23:16:12.924Z).
- `memory.childMaxRssKb`: 68 432 KB (~67 MB), pico propio del proceso hijo.
- `memory.cgroupMemoryPeakBytesBefore/After`: 36 638 720 → 55 717 888 B (~35 → ~53 MB), servicio completo.
- `memory.cgroupOomKillsDuringRun`: 0.

El RSS del hijo es mayor que el pico del cgroup porque el RSS cuenta las páginas compartidas
(binario de node, librerías) que el cgroup no carga de nuevo; el dato que cuenta para el techo es
`memory.peak` del cgroup.

## Techo de RAM

`MemoryMax=2G` (drop-in `~/.config/systemd/user/energy-markets-ui.service.d/memory-ceiling.conf`)
queda validado con este dato: pico medido ~53 MB = ~2,6 % del techo, sin OOM. Se mantiene 2G y no
se baja, porque `MemoryMax` es un tope y no una reserva (no le quita RAM a BruNode, 62 GB), y
el margen cubre releases con un snapshot de slots más grande. Esta medición vale para la release v2
sobre el snapshot actual; otra release u otro job kind se mide en su propio receipt.
