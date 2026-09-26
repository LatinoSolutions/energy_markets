# BT-05 — Backtests lanzados desde la app EM

Fuente: PLAN_STATUS.md, fila BT-05 (owner request 25-sep-2026), incluida la parte
"IDENTIDAD Y RETENCION" (commit a9f5b82 en `main`).

## Qué corre

El job `EXPLORATORY_BACKTEST` (versión = `JOB_VERSION` en `src/backtest-jobs/runner.mjs`,
sellada en cada receipt como `jobVersion`) ejecuta la release vigente del backtest
exploratorio, `BT02_CURRENT_RELEASE` en `src/exploratory/reconciliation.mjs` (la misma que
muestra la UI; hoy v2, `operations/audit/BT-04/HANDOFF-BT-04.md`): el generador
`operations/exploratory/v2/run-exploratory-backtest.mjs` sobre el snapshot fijado en
`operations/exploratory/v2/MANIFEST.json` (owner patch EM-SPEC-OWNER-PATCH-2026-09-24-02 §4).
La release queda en el receipt (`inputs.release`). Antes de arrancar verifica por sha256 los
slots y cada generador del manifest; si algo no coincide, no arranca (`INPUT_HASH_MISMATCH`);
si el manifest no es el de la release vigente, tampoco (`RELEASE_MISMATCH`). No lee el lago EEX.

Sin extracción del lago (Bru, P-011 2026-09-25: "El job corre sobre el snapshot de slots
existente, sin extracción del lago (la extracción pesada es de los jobs de TR-01/TR-03)").
El extractor de la release (`build_tob_slots.py`) sólo se coteja por hash; el único proceso
que lanza el job es el generador node sobre el snapshot commiteado (test `BT-05 P-011`).

Corre como proceso hijo de `energy-markets-ui.service`, así que cuenta dentro de su
cgroup (MemoryMax 2G, validado con el primer run real: ver abajo).

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
- `<runId>/attempt-<n>/output/…` — resultado y MANIFEST que escribió el generador, con las
  mismas rutas relativas; el receipt los ata por sha256.
- `<runId>/attempt-<n>/job.log` — salida del generador.

**Sin duplicados (OPS-01, Bru 2026-09-26):** el run corre en `attempt-<n>/workspace/`
(código extraído del commit + datos copiados y verificados por hash), pero ese workspace es
temporal: se borra al cerrar el intento, con éxito o con fallo, después de copiar resultado y
MANIFEST a `output/`. El receipt lo declara (`workspace.retention: TEMPORARY`,
`workspace.removed`). Si el servicio muere a mitad, el siguiente arranque cierra el intento
como `INTERRUPTED` y borra su workspace. Si el borrado falla, el receipt lo dice
(`workspace.removed: false` + `error`) y cada arranque y cada run lo reintentan; cuando se
borra, el receipt pasa a `removed: true` (+ `removedAt`) y el registro asienta `WORKSPACE_REMOVED`. Reproducir un run = mismo commit + mismos datos (por
hash) + mismos parámetros de la identidad: da el mismo `run_id` y el mismo resultado.
Los runs anteriores a OPS-01 no declaran workspace temporal y el código no los toca.

Solo hay un resultado vigente. Pedir otra vez un run ya superado devuelve su resultado sin
recalcular y no cambia cuál es el vigente.

**Retención:** fuera del workspace temporal, el código no borra nada. Los artefactos de un run superado solo se
borran después de enumerarlos a Bru y recibir su GO, dejando un ledger de limpieza. Ese
procedimiento todavía no está implementado.

El resultado commiteado que muestra la UI no se reemplaza con un run. El job solo corre el
backtest exploratorio in-sample sobre el snapshot fijado: no consume ni re-sella OOS.

## Medición de RAM del primer run real

El receipt guarda `memory.childMaxRssKb` (pico propio del job),
`memory.cgroupMemoryPeakBytesBefore/After` (memory.peak del servicio completo desde que
arrancó) y `memory.cgroupOomKillsDuringRun`. Con esos datos se fija el techo de EM.

Secuencia autorizada por Bru (P-011, 2026-09-25): la Oficina integra BT-05 en `main` y
reinicia `energy-markets-ui.service`; Bru lanza el primer backtest real desde el botón y el
techo (`MemoryMax`) se fija con el `memory.peak` de ese receipt.

Resultado (Bru, 2026-09-25 23:16 UTC, `evidence/BT-05/first-real-run/`): `SUCCEEDED` en 229 ms,
pico del cgroup ~53 MB, hijo ~67 MB de RSS, 0 OOM kills. `MemoryMax=2G` queda validado con
ese dato y se mantiene (razones en el README de esa evidencia).

## Valores provisionales (no canónicos)

- Timeout del job: 30 min (`DEFAULT_TIMEOUT_MS`). Recalcular con la duración medida.
