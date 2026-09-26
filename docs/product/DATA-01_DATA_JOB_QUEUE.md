# DATA-01 — Cola automática de jobs de data

Owner: Bru. Decisión 2026-09-26: "que se active sin el humano al medio".
Tarea: `PLAN_STATUS.md` fila `DATA-01` (extensión de producto, fuera del grafo
normativo §25.2.2).

## Qué hace

Cuando la descarga del archivo sellado del cliente termina con `CHECKSUM OK`,
la cola descomprime y lanza **en orden**:

1. `DECOMPRESS` — `tar --zstd -xf` del archivo en `/srv/data/eex-client-archive/extracted` (el job crea el directorio antes de extraer y escribe al terminar una marca `.decompress-complete.json` con el sha/tamaño del archivo).
2. `TR01_SCAN` — escaneo de TR-01 (trades desde el archivo verificado, medición + decisión de fuente).
3. `TR03_BRIDGE` — medición del puente de TR-03 (trades del archivo + best ask del lago).
4. `BT06_EXTRACT` — extracción del top of book de Power DE (`operations/exploratory/v3/build_tob_slots.py`). La fuente la decide TR-01: el job lee `DATA_SOURCE_DECISION.json` y extrae del archivo sellado o del lago, el que TR-01 declare canónico.
5. `BT06_BACKTEST` — backtest exploratorio TOB de Power (`operations/exploratory/v3/run-exploratory-backtest.mjs`).

Si la línea es `CHECKSUM FALLA` (o `CHECKSUM OK` con un sha distinto al
declarado), **no se lanza nada** y se avisa por Telegram.

Los artefactos de BT-06 caen en los paths que la UI ya carga como release Power
v3 (`operations/exploratory/v3/{tob-slots-power.json,backtest-results.json,MANIFEST.json}`),
así que el resultado se ve en Backtests sin tocar la UI.

## Cómo se dispara

Unidad systemd `--user` (ver `operations/data-jobs/systemd/`):

- `energy-markets-data-queue.path` vigila `PathModified=/srv/data/eex-client-archive/descarga.log`
  y arranca `energy-markets-data-queue.service`.
- `energy-markets-data-queue.service` corre `node operations/data-jobs/run-data-queue.mjs`.
- `energy-markets-data-queue.timer` (opcional) es una red de seguridad cada 15 min;
  la cola es idempotente, un disparador ya procesado no re-lanza ni re-avisa.

Instalación:

```bash
mkdir -p ~/.config/systemd/user ~/.config/energy-markets
cp operations/data-jobs/systemd/energy-markets-data-queue.* ~/.config/systemd/user/
# Credenciales (no se versionan):
cat > ~/.config/energy-markets/data-queue.env <<'EOF'
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
EOF
systemctl --user daemon-reload
systemctl --user enable --now energy-markets-data-queue.path
# opcional, red de seguridad:
systemctl --user enable --now energy-markets-data-queue.timer
```

## Contrato de jobs

- **Uno a la vez**: lock en disco (mismo primitivo que BT-05: `.job.lock.<n>` con
  `link()`); un segundo disparo no arranca.
- **Receipt por job** (`operations/data-runs/<queueId>/<NN>-<KIND>/JOB_RECEIPT.json`)
  con: comando, `memoryMaxBytes`, `enforcedBy`, `memory.peak` (cgroup), exit,
  estado, aviso de Telegram y artefactos publicados.
- **MemoryMax por job**: en producción cada job corre en su propio scope de
  systemd (`systemd-run --user --scope -p MemoryMax=<bytes>`); un supervisor
  (`src/data-jobs/child-entry.mjs`) escribe el pico del cgroup **del job** en el
  receipt antes de que systemd lo recoja. Sin scope, el pico es del cgroup del
  servicio y así queda declarado (`peakSource`). El techo es PROVISIONAL y se
  recalibra con el `memory.peak` medido del primer run real.
- **Un paso que "termina bien" sin dejar su artefacto es un fallo**
  (`STEP_ARTIFACT_MISSING`); y un artefacto que ya existía y no se reescribió
  tampoco cuenta (`STEP_ARTIFACT_STALE`): un éxito sin prueba no se acepta.
  `DECOMPRESS` declara como artefacto su marca `.decompress-complete.json`, no el
  directorio extraído: `tar` reextrae sobre un árbol que ya existe sin cambiar el
  mtime del directorio, así que medir la frescura por el directorio bloqueaba la
  reanudación tras un corte y el evento nuevo de checksum
  (`DATA01-DECOMPRESS-STALE-DIR`). La marca se reescribe en cada extracción.
- **Idempotencia y reanudación**: la cola se identifica por la huella del
  disparador (`CHECKSUM_OK:<at>:<sha>:<línea>`); un corte a mitad reanuda desde el
  primer paso que no quedó `SUCCEEDED`. Un disparador ya procesado —aunque la cola
  haya fallado— no se relanza ni se reavisa: el timer de red de seguridad no
  repite el paso fallido cada 15 min. Un evento nuevo (otra línea de checksum)
  trae otra huella y sí reanuda.
- **Fail-closed**: el disparador exige el sha declarado del archivo
  (`DATA_ARCHIVE.expectedSha256`); `CHECKSUM FALLA`/mismatch no lanzan nada.

## Relación con BT-05

DATA-01 reutiliza el contrato de jobs de BT-05 (lock de a uno, receipt, registro,
`memory.peak`) y añade los tipos de job de data. El backtest de BT-06 corre por
esta cola automática (decisión del owner 2026-09-26); la ruta HTTP de BT-05 sigue
siendo el camino de los backtests manuales. El backtest de Power no puede usar el
preflight de manifest commiteado de BT-05 porque su manifest lo produce el propio
run (contrato de BT-06, aceptado).

## Qué NO hace

- No corre la cola real a mano: los agentes construyen y prueban con fixtures.
- No resuelve el freeze de TR-04 (gate humano de Bru).
- No inventa fees, settlement ni datos del cliente.
