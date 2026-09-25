# BT-05 — Backtests lanzados desde la app EM

Fuente: PLAN_STATUS.md, fila BT-05 (owner request 25-sep-2026), incluida la parte
"IDENTIDAD Y RETENCION" (commit a9f5b82 en `main`).

## Qué corre

El job `EXPLORATORY_BACKTEST` (versión = `JOB_VERSION` en `src/backtest-jobs/runner.mjs`,
sellada en cada receipt como `jobVersion`) ejecuta el generador existente
`operations/exploratory/run-exploratory-backtest.mjs` sobre el snapshot fijado en
`operations/exploratory/MANIFEST.json` (owner patch EM-SPEC-OWNER-PATCH-2026-09-24-02 §4).
Antes de arrancar verifica por sha256 los slots y cada generador del manifest; si algo
no coincide, no arranca (`INPUT_HASH_MISMATCH`). No lee el lago EEX.

Corre como proceso hijo de `energy-markets-ui.service`, así que cuenta dentro de su
cgroup (MemoryMax 2G, provisional).

## Rutas (un solo camino)

| Quién | Cómo |
|---|---|
| Botón **Run backtest** en `/backtests` (aprobado con cambios por Bru, P-009 2026-09-25) | `POST /api/backtest-jobs` `{"requestedBy":"ui"}` |
| Asistente externo por MCP | tool `start_backtest` → el mismo `POST` con `{"requestedBy":"mcp"}` |
| Estado | `GET /api/backtest-jobs` (en curso + último + resultado vigente) · `GET /api/backtest-jobs/<runId>` (receipt + vigencia) |

Línea de estado del botón (P-009): la arma el backend (`src/backtest-jobs/display.mjs`) y
llega en `display.line` de GET y POST; la UI sólo la copia. Mientras corre, GET publica
`current.startedAt` y `current.elapsedSeconds`. Ejemplos: `Last run: succeeded · 25 Sep 2026
15:00 UTC · current result`, `Last run: reused existing result`, `Last run: failed · killed
for exceeding the memory limit`, `Running · started 15:00 UTC · 3 min elapsed`.

Un job a la vez: un segundo pedido recibe `409 JOB_ALREADY_RUNNING` con el job en curso.
El estado se lee del disco (lock + receipts + registro), así que cualquier proceso ve el job en curso.

Servidor MCP (stdio), para registrarlo en el cliente MCP:

```
node /srv/hot-data/energy-markets/app/src/backtest-jobs/mcp-server.mjs --url http://<ip-tailscale>:8788/
```

## Identidad del run

`run_id = BT-RUN-` + sha256 (JSON canónico) de:
- `codeCommit`: commit git del repo. Si `src/` o el generador tienen cambios sin commitear,
  el job no arranca (`CODE_NOT_COMMITTED`); sin git, `CODE_COMMIT_UNKNOWN`.
- `dataManifestSha256`: hash del manifest exploratorio commiteado + el calendario (ambos por sha256).
- `parameters`: jobKind, generador, slots y salida.
- `engineVersion`: `JOB_VERSION` del runner.

Mismo `run_id` con resultado → `200 reused`, no se recalcula. Si el intento anterior falló o
se interrumpió, se reintenta como `attempt-<n+1>` del mismo run.

## Qué queda de cada run

`operations/backtest-runs/`:
- `REGISTRY.jsonl` — registro append-only. `RUN_CLOSED` guarda el manifest de cada intento
  (identidad, hashes de datos, inicio/fin, pico de RAM, hash del resultado, estado).
  `RESULT_PROMOTED` marca el nuevo resultado vigente y a cuál supera (`supersedes`), en una
  sola línea. De ahí sale la vigencia: `CURRENT`, `SUPERSEDED` (+ `supersededBy`) o `NONE`.
  Si el registro está corrupto, no arranca ningún run (`REGISTRY_CORRUPT`).
- `<runId>/attempt-<n>/RUN_RECEIPT.json` — receipt del intento (no se reescribe al superarse).
- `<runId>/attempt-<n>/workspace/…` — resultado y MANIFEST del run (artefactos pesados).
- `<runId>/attempt-<n>/job.log` — salida del generador.

Solo hay un resultado vigente. Pedir otra vez un run ya superado devuelve su resultado sin
recalcular y no cambia cuál es el vigente.

**Retención:** el código no borra nada. Los artefactos pesados de un run superado solo se
borran después de enumerarlos a Bru y recibir su GO, dejando un ledger de limpieza. Ese
procedimiento todavía no está implementado.

El resultado commiteado que muestra la UI no se reemplaza con un run. El job solo corre el
backtest exploratorio in-sample sobre el snapshot fijado: no consume ni re-sella OOS.

## Medición de RAM del primer run real

El receipt guarda `memory.childMaxRssKb` (pico propio del job),
`memory.cgroupMemoryPeakBytesBefore/After` (memory.peak del servicio completo desde que
arrancó) y `memory.cgroupOomKillsDuringRun`. Con esos datos se fija el techo de EM.

## Valores provisionales (no canónicos)

- Timeout del job: 30 min (`DEFAULT_TIMEOUT_MS`). Recalcular con la duración medida.
