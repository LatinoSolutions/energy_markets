# UI-02 — Serving de la UI de Energy Markets (owner 24-sep-2026)

Estado: implementación de la tarea UI-02 (PLAN_STATUS). Served UI = la
implementación aceptada de UI-03 (dirección visual Claude Blind, commit
`c35510b` integrado en `src/ui`); no se cambió `src/ui/render.mjs` ni
`src/ui/binding.mjs` (boundary UI-01/UI-03 congelado). Una corrección
posterior (UI02-H1, commit `749ca54`) añadió a `src/ui/view-models.mjs`
sólo el flag aditivo `hasAnyBoundData` en `buildReplayViewModel` (sin
cambiar el render ni la semántica del Operator Interface Boundary de
IMP-29; SPEC v1.1.1 §26.5: la UI no calcula, no gobierna, no es Source of
Truth).

## Cómo servir (comando)

```bash
node src/ui/serve.mjs                # default 127.0.0.1:8787
node src/ui/serve.mjs --port 8787 --host 127.0.0.1
```

## URL para Bru

```
http://127.0.0.1:8787/
```

- `/` — navegación (enlaces a las cuatro superficies).
- `/replay` — Replay / Decision Inspector.
- `/backtests` — Backtests / Economic Comparison.
- `/research` — Research / Strategy Lab.
- `/campaigns` — Campaigns & Runs.
- `/health` — health check JSON (estado real por superficie).

## Estado de los datos (fail-closed)

Sin manifest backend verificado, el servidor parte sin datos: `/replay`
queda en ERROR fail-closed (exige timeline+exposición validados del boundary)
y las demás superficies declaran sus ítems como UNAVAILABLE, nunca como
valores. `/health` reporta ese estado con `canonicalData: false`. No hay
ningún dato de muestra ni demo.

La inyección del estado canónico es programática (front door único):

```js
import { createUiServer } from "./src/ui/server.mjs";
import { backendIndexFromManifest } from "./src/operator-interface/index.mjs";
const started = createUiServer({
  port: 8787,
  inputs: {
    backendIndex: backendIndexFromManifest(verifiedPitManifest),
    timeline, exposure,                  // salida validada del boundary (IMP-29)
    backtestsRows: [...],                // candidatos atados al manifest
    researchRecords: [...],
    campaigns: [...], runs: [...],
  },
});
```

Nada se calcula en el frontend ni por request: los view models fail-closed se
montan una vez al arrancar y cada respuesta es su render.

## Límites de este serving (acceptance UI-02)

- Enlace por defecto 127.0.0.1: no se abre exposición pública nueva. Un
  `--host` distinto (p. ej. `0.0.0.0`) es una decisión operativa explícita del
  arrancador, nunca el default del código.
- Semántica de `/health`: `ok: true` significa servicio vivo y rutas
  canónicas servidas; el estado real de los datos va por superficie en
  `surfaces[].state` (READY|ERROR) y `surfaces[].canonicalData` (true sólo si
  esa superficie exhibe datos enlazados a registros canónicos verificados).
- Sólo GET/HEAD de lectura; POST/PUT/… → 405; rutas no canónicas → 404
  fail-closed. La UI no expone comandos (§26.5); nada de ejecución real ni
  capital.
- Tests de serving/navegación: `test/ui/ui-02.test.mjs`
  (`node --test $(find test -name '*.test.mjs')`).
