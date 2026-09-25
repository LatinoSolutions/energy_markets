# BT-05 — Backtests lanzados desde la app EM

Fuente: PLAN_STATUS.md, fila BT-05 (owner request 25-sep-2026).

## Qué corre

El job `EXPLORATORY_BACKTEST` v1 ejecuta el generador existente
`operations/exploratory/run-exploratory-backtest.mjs` sobre el snapshot fijado en
`operations/exploratory/MANIFEST.json` (owner patch EM-SPEC-OWNER-PATCH-2026-09-24-02 §4).
Antes de arrancar verifica por sha256 los slots y cada generador del manifest; si algo
no coincide, no arranca (`INPUT_HASH_MISMATCH`). No lee el lago EEX.

Corre como proceso hijo de `energy-markets-ui.service`, así que cuenta dentro de su
cgroup (MemoryMax 2G, provisional).

## Rutas (un solo camino)

| Quién | Cómo |
|---|---|
| Botón **Run backtest** en `/backtests` | `POST /api/backtest-jobs` `{"requestedBy":"ui"}` |
| Asistente externo por MCP | tool `start_backtest` → el mismo `POST` con `{"requestedBy":"mcp"}` |
| Estado | `GET /api/backtest-jobs` (en curso + último) · `GET /api/backtest-jobs/<runId>` (receipt completo) |

Un job a la vez: un segundo pedido recibe `409 JOB_ALREADY_RUNNING` con el job en curso.

Servidor MCP (stdio), para registrarlo en el cliente MCP:

```
node /srv/hot-data/energy-markets/app/src/backtest-jobs/mcp-server.mjs --url http://<ip-tailscale>:8788/
```

## Qué queda de cada run

`operations/backtest-runs/<runId>/`:
- `RUN_RECEIPT.json` — estado, quién lo pidió, hashes de inputs y código (`gitHead`),
  hashes de resultados y MANIFEST del run, `reproducesCommittedResults`, memoria.
- `workspace/operations/exploratory/backtest-results.json` + `MANIFEST.json` — el resultado versionado.
- `job.log` — salida del generador.

El resultado commiteado que muestra la UI no se reemplaza con un run.

## Medición de RAM del primer run real

El receipt guarda `memory.childMaxRssKb` (pico propio del job),
`memory.cgroupMemoryPeakBytesBefore/After` (memory.peak del servicio completo desde que
arrancó) y `memory.cgroupOomKillsDuringRun`. Con esos datos se fija el techo de EM.

## Valores provisionales (no canónicos)

- Timeout del job: 30 min (`DEFAULT_TIMEOUT_MS`). Recalcular con la duración medida.
