# UI-05: fidelidad con el mockup DES-01 y auditoría de data por pieza

- Pedido: Bru, 25-sep-2026 (PLAN_STATUS UI-05).
- Mockup: rama `des-01-blind`, `design-proposal/index.html` (servido en :8765).
- Capturas de referencia: `/srv/hot-data/metrics/ui-compare-20260925/*_mockup.png`, 1440x900.
- Data: solo la release vigente del backend exploratorio, la que resuelve el loader (`BT02_CURRENT_RELEASE = "v2"`, `src/exploratory/reconciliation.mjs`; BT-04, 25-sep): `operations/exploratory/v2/MANIFEST.json` (sha256 `3114f2ffb939…`) → `v2/backtest-results.json` (sha256 `660d14a0f7c5…`) y `v2/tob-slots-the-gas.json` (sha256 `55a6dd6ca944…`), más el registro BT-02 `v2/reconciled-results-BT-02.json` (sha256 `ad0cab12565f…`). La release v1 (`operations/exploratory/MANIFEST.json`, `backtest-results.json` sha256 `ce51969129b4…`) queda en disco superseded y la UI no la consume. Ningún artifact se regeneró en UI-05.

## Capturas para el gate de Bru

| Carpeta | Contenido |
|---|---|
| `compare/<pantalla>.png` | Tres columnas: **MOCKUP** · **ANTES** (esta rama antes del cambio, igual que main) · **DESPUÉS** |
| `before/` | Página completa antes, 1440 px |
| `after/` | Página completa después, 1440 px, más `replay-hindsight-on.png` (overlay de hindsight activado) |

Para regenerarlas: `node src/ui/serve.mjs --port 8799` y Playwright a 1440x900, full page, en `/campaigns`, `/replay`, `/backtests` y `/research`.

Todas las capturas de `before/`, `after/`, `compare/` y `p008-campaigns/` (salvo `prototype-campaigns.png` y los mockups) se regeneraron el 25-sep contra la release v2 (UI05-CAP-01): las anteriores eran del artifact v1 superseded. Comprobado en el HTML servido: ninguna página de los tres servidores contiene el sha v1 `85d0c4ad5c87` y todas contienen el v2 `55a6dd6ca944`, salvo `/replay` de `main`, que no pinta el sha del snapshot.
- ANTES de `before/` y `compare/`: `main` en `09f06d2`, servido desde una copia `git archive` (release v2, UI sin UI-05).
- DESPUÉS: esta rama, servida desde el worktree.
- ANTES de `p008-campaigns/`: **reconstrucción**, no un commit servido tal cual. Es el código de UI de `b25096b` (`render`, `view-models`, `visual-language`) sobre el resto del árbol de esta rama, para que los dos lados pinten la misma release v2. `b25096b` servido tal cual pintaría v1.

## Qué diseño se recuperó

| Pantalla | Pieza del mockup | Antes | Después |
|---|---|---|---|
| Replay | Cabecera `dechead`: meta, h1 serif, lede y botones de decisión a la derecha | Botones debajo del lede | Igual que el mockup |
| Replay | Run timeline: marcas llenas/vacías, marca seleccionada alta, punto de detalle, barra de ventana de evaluación, etiquetas de mes | Tira de cuadrados sin ventana ni etiquetas | Igual que el mockup. Cada compra es un enlace a su decisión. |
| Replay | Cadena de 4 objetos `.chain` (◆ → ▲ → ■ ┆ ●) con `.obj z-asof/z-exec/z-hind`, flechas y horizonte vertical `EVALUATION · LATER` | Cuatro tarjetas genéricas | Igual que el mockup |
| Replay | Leyenda `T₀ · DECISION-TIME / EXECUTION / LATER · EVALUATION` | No estaba | Está |
| Replay | Zonas `.zones`: Known at T₀ · separador `KNOWLEDGE HORIZON` · Later · evaluation (rayado ocre) | Dos tarjetas sin separador | Igual que el mockup |
| Replay | Gráfico 760x250: ejes, horizonte, etiquetas KNOWN AT T₀ / LATER, parte sellada, **overlay de hindsight** | Sin overlay, sin ejes del mockup | Igual. Con el overlay activado, la serie posterior a T₀ se dibuja solo a la derecha del horizonte. |
| Replay | Tabla de inputs de 5 columnas (Input · Value at T₀ · Observed at · **Age at T₀** · State) | 4 columnas | 5 columnas |
| Replay | Zona de evaluación con el bloque `.metric` | Filas `chk` | `.metric` |
| Campaigns | Rail de campañas en una sola tarjeta (`.clist .it`), ítem abierto marcado | Una tarjeta por campaña, sin marca | Igual que el mockup. La marca sale de `:target`, sin JavaScript. **Reemplazado por el rail por misión de P-008 (ver al final).** |
| Campaigns | Lista `What we don't know` con `.unk-item` | Tarjetas genéricas | `.unk-item` |
| Campaigns | Runs: 7 columnas `Run · Arm · Status · Decisions · evaluation · Determinism · Receipts · Drill down`, barra segmentada y `.drill` | Columnas distintas (volumen y H), sin barra ni Receipts ni Research | Las 7 del mockup. Volumen y H (dato de UI-04) se conservan dentro de la celda de decisiones. |
| Campaigns | Leyenda de la barra (closed / not closed / not run) | No estaba | Está |
| Campaigns | Ledger de receipts `.receipt` (hora · qué · id) | Filas `chk` | `.receipt` |
| Research | Pila de candidatos en una tarjeta (`.stack .it`) con `EVIDENCE n` y chip de Authority | Una tarjeta por candidato, sin recuento de evidencia | Igual que el mockup |
| Research | Criterios `.crit` (glifo · texto · chip) y `p.hyp` | Filas `chk` | `.crit` / `.hyp` |
| Research | Caja `AUTHORITY` con doble filete (`.auth-box`) | Tarjeta con borde | `.auth-box` |
| Research | Linaje: nodos con **flechas** (marker), etiqueta de experimento ⧉ y línea discontinua | Línea discontinua sin flecha | Nodos, flecha y etiqueta ⧉ |
| Research | Evidence & receipts: 5 columnas (Receipt · Kind · What · Recorded · open) | 2 columnas | 5 columnas |
| Backtests | Cabecera con pregunta en h1 y leyenda de brazos a la derecha | h1 genérico "canonical producers only" y brazos `UNKNOWN` | Pregunta y leyenda Baseline / Arm A / Arm B |
| Backtests | Efecto emparejado: ejes del mockup, cero sólido, marcadores finales, **Show data table** | Sin tabla desplegable | Tabla por episodio (B*, H y V por brazo) |
| Backtests | Histogramas con eje de conteos, barras redondeadas | Sin eje Y | Con eje Y |
| Backtests | Forest plot "Across campaigns" en SVG con eje | Filas HTML | SVG con eje, un rombo por brazo |
| Todas | Reloj `data as-of` del shell | `UNAVAILABLE` | Último día del snapshot EEX usado (`inputs.dataPeriod.lastDataDay` = 2026-07-28) y sha del snapshot. Sin backtest exploratorio sigue `UNAVAILABLE`. |

Secciones nuevas de UI-04/BT-03 que se conservan: dos bloques por producto (G0BQ, G0BM) en Backtests, tabla "Exploratory backtest · real EEX best ask", perfiles horarios, "Campaign measurements · backend readiness" (BT-02), las 21 campañas, las 31 decisiones con compra y los 8 candidatos (`A0, DIP10, HOUR, S2, S3, S4, S5, Z`).

## Auditoría pieza por pieza: ¿la data de hoy lo sostiene?

Fuente de cada fila: campo del artifact `backtest-results.json` (verificado contra `MANIFEST.json`).

### Replay

| Pieza del mockup | ¿Sostenida? | Fuente o motivo |
|---|---|---|
| Decisión (día, BUY, MW pedidos) | Sí | `replay[].inspector[]` (`day`, `requestedMw`) |
| Tira de decisiones (BUY/WAIT por día) | Sí | `replay[].decisions.ARM_A[]` (`status` FILLED/WAIT). El test comprueba que los días coinciden con `ask11`. |
| Ventana de evaluación y "evaluation closed" | Sí | B* es la media de los asks de 11:00 de toda la ventana (`benchmarkNote`), así que cierra el último día de `ask11`. El gate `Evaluation window closed` de la campaña es PASS. |
| Recomendación: productor | Sí | Brazo A = DIP10 v1-exp (`research.candidates[]`) |
| Recomendación: umbral del disparo (media de asks previos) | **No** | El artifact solo trae `pastAsksUsed`, no la media → `UNKNOWN`. Es trabajo del productor (ver TO-DO 1), no del cliente. |
| Requested action: cantidad | Sí | `requestedMw`. Es el mismo campo que la recomendación: el validador pide lo que se recomienda. |
| Requested action: time in force | **No** | El validador no modela órdenes → `UNKNOWN`. No se pide al cliente: la regla de ejecución del backtest ya está fijada (ask + 0,15, fill completo). |
| Tabla de fills (hora, MW, precio) | Sí, 1 fill por decisión | `quoteTm`, `filledMw`, `priceEurMwh`. El modelo del cliente llena todo contra un solo quote. |
| Residual de la orden | No se muestra | El artifact no lo emite. Se muestra lo que sí emite: `remainingMwAfter`. |
| Aviso de profundidad | Sí | `askSz` vs `filledMw` |
| Outcome ΔV, B*, H del brazo y H de la baseline | Sí | `deltaVEur`, `benchmark`, `hArmA`, `hBaseline`, `baseline` |
| Gráfico known at T₀ y hindsight | Sí | `ask11[]` (ask de 11:00 de cada día). El mockup usaba ±60 días; aquí se usa la ventana de la campaña, que es lo que trae el artifact. |
| Líneas de referencia Budget / Trigger del mockup | **No** | No existe presupuesto en el mandato del cliente. El trigger es la media móvil que no se emite (TO-DO 1). No se dibujan. |
| Inputs: best ask, tamaño, bid, hora | Sí | `ask`, `askSz`, `bid`, `quoteTm` |
| Edad del input a T₀ | Sí, como cota | El loader descarta quotes con más de 15 min (`build_tob_slots.py:25`, `MAX_AGE_S = 15*60`) → "≤ 15 min". No se calcula la edad exacta en la UI. |
| Spread bid/ask | Quitado | Antes se restaba en la UI (cálculo en el frontend). Ahora solo se muestran bid y ask. |
| Fees de ejecución | **No** | `rules.feesEurMwh = UNKNOWN`. Ya pedido al cliente el 24-sep (solicitud 2026-09-24, punto 2). |

### Campaigns & Runs

| Pieza | ¿Sostenida? | Fuente o motivo |
|---|---|---|
| Lista de campañas, readiness y ventana | Sí | `campaigns[]` |
| Readiness gates | Sí | `campaigns[].gates[]` |
| What we don't know | Sí | `campaignUnknowns[]`. El artifact no trae fecha "since", así que no se muestra. |
| Barra de decisiones cerradas / abiertas / no corridas | Sí | `runs[].decisions`, el gate `Evaluation window closed` (PASS) y `tradingDays` (0 no corridas solo si decisiones = días) |
| Hora de inicio del run | **No** | Los manifests no traen timestamp → la fila muestra el slot del run |
| Determinismo por run | **No** | El artifact solo trae un check global (`research.integrity` "Replay determinism", `run-exploratory-backtest.mjs`); ningún productor lo declara por run → UNKNOWN |
| Recuento de receipts | Sí (campañas con runs) / **No, n/a** (runs = 0) | Los 4 artifacts que respaldan cada run (resultado, snapshot, manifest y owner patch 02). Sin runs no hay nada que respaldar → "NO RECEIPTS · no run exists" (UI05-RCP-01) |
| Hora de registro de cada receipt | **No** | Los manifests no tienen fecha de registro → "not recorded" |

### Research

| Pieza | ¿Sostenida? | Fuente o motivo |
|---|---|---|
| Candidatos, etapa, versión, readiness y authority | Sí | `research.candidates[]` |
| Recuento de evidencia | Sí | Candidatos con brazo corrido: 4 receipts. "Hypothesis only": 0. |
| Hipótesis y criterios de éxito | Sí | `hypothesis`, `criteria[]` |
| Readiness & integrity | Sí | `research.integrity[]` |
| Linaje de versiones | Parcial | Hay una sola versión por candidato y la referencia A0 con la que se empareja. No hay versiones previas registradas, así que no se dibuja ninguna. |
| Fecha de registro de la hipótesis | **No** | `research.candidates[]` no trae fecha de registro y el owner patch 02 autoriza la fase exploratoria pero no registra hipótesis → "not recorded". La fase exploratoria sí se cita al patch 02. |

### Backtests

| Pieza | ¿Sostenida? | Fuente o motivo |
|---|---|---|
| Tabla de medidas B* / H / V / ΔV y n | Sí | `comparison[p].table[]` |
| Columna "90 % interval (paired)" | **No** | No hay productor de intervalos de confianza. Se muestra el rango real de episodios con la etiqueta "Range (paired)", nunca como un intervalo al 90 %. |
| Efecto emparejado acumulado | Sí | `comparison[p].paired` |
| Tabla desplegable de datos | Sí, por episodio | `comparison[p].perEpisode[]`. El artifact no trae el detalle por decisión de todos los brazos. |
| Histogramas H − B* | Sí | `comparison[p].distributions` |
| Forest plot por campaña | Sí, sin intervalos | `comparison[p].acrossCampaigns`. No hay intervalo por episodio, así que no se dibuja ninguno. |
| Method & integrity | Sí | `comparison[p].checks` |
| B/H/V canónicos (IMP-05) | **No** | Sigue `UNKNOWN / NO ESTIMATE`. B no está reconciliado con el oficial (ver la solicitud al cliente, punto 2). |

## TO-DO de lo que falta

| # | Falta | Tipo | Quién lo resuelve | Cierre verificable |
|---|---|---|---|---|
| 1 | Media de disparo de DIP10 y motivo de la compra (dip o piso Lₜ) por decisión | Productor (ingeniería) | `run-exploratory-backtest.mjs` / `src/exploratory/backtest.mjs` emiten `triggerMeanEurMwh` y `reason` en `inspector[]`; hay que regenerar el artifact y los manifests (MANIFEST, BT-02) | La fila "Trigger mean" deja de ser UNKNOWN y un test lo compara con el cálculo independiente |
| 2 | Último día de negociación oficial por vencimiento (U-EM-4) | Dato externo EEX | Prompt al cliente, punto 1 | Ventanas Monthly recortadas con la fuente oficial, no con la proxy |
| 3 | Settlement diario oficial EEX de G0BQ/G0BM (B canónico, IMP-05) | Dato externo EEX | Prompt al cliente, punto 2 | Fila canónica B/H/V deja NO ESTIMATE solo si reconcilia |
| 4 | Fees de ejecución | Dato del cliente | Ya pedido el 24-sep (no se repite) | Execution contract sin UNKNOWN |
| 5 | Timestamps de registro en los manifests (hora de run y de receipt) | Productor (ingeniería) | Generadores de los manifests | Columnas "Recorded" y "started" con valor |
| 6 | Intervalo de confianza emparejado | Método (ingeniería / SPEC) | Productor de comparación | Columna del intervalo con método versionado |

No se vuelve a pedir el top of book anterior a julio de 2025: el cliente confirmó el 25-sep que no existe (solo hay trades).

## Contrato conservado

- Cero datos demo. Un test (`test/ui/ui-05.test.mjs`) comprueba que no aparece `SYN-`, `Cal-27`, `Tranche-trigger`, `Procurement committee`, `T₀+84`, `Budget 92` ni `Trigger 89`.
- La UI no calcula economía. Se quitó la única resta que quedaba en Replay (el spread).
- Sin backtest exploratorio verificado, Replay sigue ERROR fail-closed y el reloj dice `UNAVAILABLE`.
- `src/exploratory/*` y los artifacts no se tocaron (el manifest los fija por hash).

## P-008 — rail de Campaigns por misión (decisión de Bru 2026-09-25)

- Replay y Research: aprobados por Bru. Backtests: el hover del chart queda en UI-06.
- Campaigns: el rail de 21 tarjetas se reemplaza por grupos plegables (`<details>`) Gas Quarterly · Gas Monthly · Power Quarterly · Power Monthly. Referencia: `/srv/hot-data/oficina-data/design-selections/energy-markets/UI-05-prototipo-2026-09-25/prototipo-ui05.html` (sha256 `a79c8652e8ce274cc27c46a3d5439103159d7de9fd9941ccc07afa83f1b9a1c3`), pestaña Campaigns.
- Datos: `projectExploratoryPages` (`src/ui/view-models.mjs`, servidor) proyecta `campaignGroups` desde el artifact verificado: recuentos por `readiness`, entrega desde `maturity` ("Q1-2026", "Oct 2025"), ventana desde `firstDay`/`lastDay`. El render solo pinta. Ventana ausente = `UNAVAILABLE` (GAS-M-202609..202612). Power no tiene campaigns en el artifact: "no data yet".
- Solo abierto el grupo de la campaign seleccionada: `open` en el grupo por defecto; al navegar a `#cmp-…` un script inline abre su grupo y cierra el resto.
- Diferencia consciente con el prototipo: la ventana se muestra con fecha completa (`2025-09-01 → 2025-11-28`) en vez de `09-01 → 11-28`, para no truncar el año (la ventana puede caer en otro año que la entrega). El texto del prototipo "enters with TR-01..TR-07" no se copió: no hay fuente en PLAN_STATUS para esa afirmación.
- Panel derecho: sin cambios respecto de UI-05.
- Capturas para la aprobación final de Bru: `p008-campaigns/compare-campaigns.png` (PROTOTIPO · ANTES · DESPUÉS, 1440x900), `before-campaigns.png`, `after-campaigns.png` (página completa) y `after-campaigns-gas-monthly-selected.png` (navegación a GAS-M-202610: solo Gas Monthly abierto, ventana UNAVAILABLE).
