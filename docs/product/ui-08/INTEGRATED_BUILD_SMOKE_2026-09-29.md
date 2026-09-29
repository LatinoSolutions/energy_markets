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
