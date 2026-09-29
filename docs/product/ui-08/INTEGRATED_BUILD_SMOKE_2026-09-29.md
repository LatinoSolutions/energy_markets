# UI-08 — Smoke del build integrado servido (UI08-10 / R11) · 2026-09-29

Procedimiento establecido (`docs/product/UI-02_SERVING.md`), ejecutado desde el
worktree de la tarea **sin job en curso** (ningún lock vivo en
`operations/backtest-runs`; el servicio `energy-markets-ui.service` no se tocó ni
se reinició). Comando:

```bash
node src/ui/serve.mjs --port 8792 --host 127.0.0.1
```

Salida del arranque (proceso, no checkout):

```
Energy Markets Operator UI: http://127.0.0.1:8792/
build servido: commit=52f4211b3082fc860092a67684633c464d66a40f
backend canónico: manifest=true records=17 valores atestados=0 errores=0
```

## Identidad del build cargado (`GET /health`)

```json
"build": { "service": "energy-markets-operator-ui",
           "commit": "52f4211b3082fc860092a67684633c464d66a40f",
           "dirty": false, "capturedAt": "2026-09-29T00:46:10.657Z" }
```

## Revisión semántica y de datos (`GET /health`)

- `semanticSnapshot.semanticVersion`: **SEM-1/2026-09-28/v1**
- `semanticSnapshot.revision` (snapshot publicado, compartido por las cuatro
  lecturas): **f5163b540e9292b99f5085b374f196c23254bff2f1d726a2df6536f92684cb6d**
- `semanticSnapshot.source`: VERIFIED · EXPLORATORY — Gas v2
  (`operations/exploratory/v2/backtest-results.json`,
  sha256 660d14a0f7c5131f…), Power v3
  (`operations/exploratory/v3/backtest-results.json`,
  sha256 3ad9a23457e1e635…)
- `backend`: manifest=true, records=17, valores atestados=0, errores=0
- `backtestJobs.running`: false (ningún job en curso durante el smoke)

## Smoke de las cinco rutas

| Ruta | HTTP | Verificación |
|---|---|---|
| `/` | 200 | navegación |
| `/campaigns` | 200 | `<h1>` por campaña en inglés (Gas Monthly/Quarterly, Power Monthly/Quarterly · delivery …); `data-nav="research"`=1; `data-ui-visual-language="claude-blind"`=1 |
| `/replay` | 200 | decisiones en inglés (`Decision #NNN — BUY at … 11:00 Berlin`); misma nav y visual language |
| `/backtests` | 200 | `<h1 class="page">Backtesting</h1>`; **0** ocurrencias de la pregunta global DIP/HOUR; secciones en orden `scope → hypotheses → results`; misma nav y visual language |
| `/research` | 200 | nombres canónicos ingleses (`H-S1-01 · Session-Anchored Rolling Reference`, `H-RD-01 · Execution Hour`, `Historical calendar comparator (A0)`, pila S1–S5/Z); misma nav y visual language |
| `/health` | 200 | payload arriba |

Comprobaciones de lenguaje: en las cuatro rutas la navegación y los estados
primarios están en inglés (owner clarification 2026-09-28); los aliases
históricos (A0/DIP10/HOUR) aparecen sólo como provenance en Research, no como
identidad primaria de Backtesting.

## Proceso servido activo (pendiente, fuera de mi autorización)

El servicio Tailscale `energy-markets-ui.service` sirve
`/srv/hot-data/energy-markets/app` en `main` (607f426) y aún muestra el título
antiguo. Publicar este build ahí requiere integrar la rama a `main` y reiniciar
el servicio — acto prohibido explícitamente para este agente (OFICINA.md;
encargo de la tarea). Registrado como `NECESITO_DE_BRU [acceso]` en el resumen.

### Gate reproducible para la publicación autorizada

`verify-served-build.mjs` consulta por HTTP el proceso cargado. Requiere el SHA
completo del commit que la Oficina haya publicado, `dirty:false`, ausencia de
jobs en ejecución con estado legible al inicio y al final del smoke, versión semántica y revisión de snapshot
coherentes entre `/health`, `/api/backtest-jobs` y las cuatro superficies. También
comprueba los nombres y versiones de misión e hipótesis del contrato backend,
el orden Scope → Hypotheses → Results y el título estable. Solo hace GET; no
lanza backtests ni toca el servicio. Comando para la Oficina, **después** de
integrar y arrancar el commit aprobado sin un job en curso:

```bash
node docs/product/ui-08/verify-served-build.mjs http://100.92.44.106:8788/ <sha-completo-del-commit-servido>
```

El 2026-09-29, ejecutado contra el proceso Tailscale aún anterior con el SHA de
esta rama `6f79ab46de576f3f89b1bfaf0225f40d8ca485bc`, terminó **exit 1**.
Las seis lecturas (`/health`, `/api/backtest-jobs` y las cuatro páginas) fueron
HTTP 200, pero el proceso no declaró build ni revisión semántica; `/backtests`
seguía mostrando la pregunta DIP/HOUR global. Este resultado es evidencia de
**NO publicación**, no de aceptación UI08-10. El commit esperado de entrega
deberá ser el SHA realmente cargado tras la integración, no el checkout de la
rama leído por separado.

### Relectura de Cierre · 2026-09-29T01:40:04Z

`main` en `/srv/hot-data/energy-markets/app` sigue en
`607f426b51638fb3afb993292dbc0ed0743ab7ed`; el proceso
`energy-markets-ui.service` está `active/running` desde
`2026-09-26 14:10:22 UTC`. El verificador de esta rama, ejecutado con el HEAD
`be1bade6136e689827a894e36095536ad48ccfe5` contra
`http://100.92.44.106:8788/`, terminó **exit 1**: las seis rutas respondieron
200, pero `/health` no publica commit ni revisión semántica y `/backtests`
conserva el título DIP/HOUR. La lectura no afirma que haya un job corriendo:
el endpoint antiguo no permite demostrar el estado legible exigido por el
verificador. No se hizo merge ni restart. UI08-10 sigue abierto.

La verificación de Cierre también exige que las lecturas finales de `/health`
y `/api/backtest-jobs` mantengan el mismo build limpio, snapshot y versión
semántica que las lecturas iniciales; un cambio durante el smoke falla cerrado.
