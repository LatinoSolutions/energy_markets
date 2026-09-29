# UI-08 — Entrega: correcciones de revisión, build integrado y verificación visual (2026-09-29)

Ronda de corrección sobre `8440eda` (handoff `energy-markets-UI-08-20260929-000054-oa3-revisar-to-opencode-corregir.json`,
veredicto CAMBIOS, hallazgos UI08-R01…UI08-R13). Contrato de corrección OFF-29 §3.4.

## Correcciones de ingeniería (con tests en `test/ui/ui-08.test.mjs`)

| ID | Corrección | Test |
|---|---|---|
| UI08-R01 | Scope proyecta la ventana de calendario de CADA campaña atada a su fuente (`campaignId` + `maturity` + `firstDay → lastDay`), tomada del artifact exploratorio verificado por producto; sin ventana verificada queda UNAVAILABLE con motivo, nunca la primera campaña en nombre de las demás. (`src/backtesting-semantics/projection.mjs` `exploratoryWindowIndex`/`missionCampaigns`, `src/ui/view-models.mjs` `backtestScopeEntry`, `src/ui/render.mjs` `scopeMissionCard`) | `UI08-R01: Scope shows the calendar window of each campaign of the mission, tied to its source` |
| UI08-R02 | Los estados de la tarjeta de hipótesis son propios: `registered` por presencia en la colección canónica, `scientificallyEvaluated` por los `researchPass` de SUS resultados, y un estado declarado por el backend prevalece sobre la derivación; la disponibilidad ya no cuelga del launch de H-S1-01. (`src/ui/view-models.mjs` `backtestHypothesisCollectionEntry`, exportada para test) | `UI08-R02: the hypothesis collection entry carries each hypothesis's own states, not fixed values` |
| UI08-R03 | La celda BENCHMARK muestra campaña · estado · versión · fuente para cada referencia atada; la referencia oficial del resultado BT-08 viaja con el run comparable (`benchmark <versión> (<estado>)` desde `comparison.active`). | `UI08-R03: BENCHMARK keeps source and version visible, and the official BT-08 reference is presented` |
| UI08-R04 | La comparación principal sólo lleva evidencia comparable (CURRENT + `validComparison`); runs FAILED/NOT_CURRENT/superados quedan como historial técnico etiquetado (`data-technical-run`), nunca como resultados de hipótesis. | `UI08-R04: a FAILED run …` y `UI08-R04: a superseded run …` |
| UI08-R05 | La ablation ya no fija H-S1-01: cabecera "CONTROL ↔ active hypothesis" y cada fila nombra la hipótesis de su resultado (`ablationViewFor` deriva `hypothesisId`); una hipótesis futura con ablation propia se muestra sin editar el renderer. La proyección además ya no ata los resultados por misión a H-S1-01 (excluye Research Discovery, SEM-1). | `UI08-R05: the ablation names the hypothesis its result belongs to, without a renderer edit` |
| UI08-R06 | El bloque de enlaces al control Development es siempre navegable: las cuatro misiones conservan su enlace con estado backend (`data-hypothesis-run-status`), y navegar a una misión bloqueada muestra el botón deshabilitado con su código exacto (p. ej. `FREEZE_PENDING`). | `UI08-R06: without READY missions every mission keeps its Development link and its exact blocker` |
| UI08-R07 | El refresco del cliente no reactiva el botón: en modo HYPOTHESIS `refresh()` exige un request validado embebido (`hypothesisReady()`); un job que termina o un error de POST con misión bloqueada lo dejan deshabilitado. Verificado ejecutando el MISMO script del navegador con un stub mínimo de DOM/fetch. | `UI08-R07: a finished job does not re-enable…` y `UI08-R07: a POST failure…` |
| UI08-R08 | `hypothesisLaunchRequestForMission` coteja los hashes del request contra los archivos actuales antes de declarar READY: fuente alterada → `INPUT_HASH_MISMATCH` (con path/expected/actual), fuente ausente → `SOURCE_MISSING`; la UI no habilita Run. | `UI08-R08: a source altered after the request keeps the mission blocked with INPUT_HASH_MISMATCH` |
| UI08-R09 | La conversión runner→proyección transporta `phase` y `dataMode` (del job view o de la clave de familia), y la proyección los conserva en el resultado; dos resultados de la misma hipótesis/misión con modo distinto quedan separados e identificados en la tabla principal. | `UI08-R09: results of one hypothesis and mission with different modes stay separated and identified` |
| UI08-R10 | El E2E ejecuta el clic del botón (script real del navegador con stub DOM), inspecciona payload y handler (POST `requestedBy/mode/job` idéntico al request embebido, 202), comprueba que el ledger de acceso OOS (`operations/trades/TR-06/trades-oos-access.jsonl`) no cambia, y valida la identidad completa del resultado publicado (run/hipótesis/versión/misión/fase/modo/candidate/search-space/configuration hashes). | `UI08-R10: the E2E clicks the button, inspects payload and handler, preserves the OOS ledger and validates the published result` |
| UI08-R12 | Composición aprobada verificada en estados disponible y bloqueado con las invariantes fluidas de ambas anchuras de referencia, más capturas reales a 1440 px y 820 px comparadas con las referencias claras/editoriales (ver abajo). | `UI08-R12: the approved composition holds at both reference widths in available and blocked states` |
| UI08-R13 | Tras publicar el resultado del fixture por el handler real, las cuatro superficies (Campaigns & Runs, Replay, Backtests, Research) comparten revisión de snapshot (`data-snapshot-revision` = `semanticSnapshot.revision` de `/health`), nombres ingleses canónicos (H-S1-01, versión, "Gas Monthly") y la identidad run/fase/modo en Backtests — sin reinicio. | `UI08-R13: after publishing a BT-08 result the four surfaces share revision, English names and result identity` |

Además: la tira canónica SEM-2 de las cuatro superficies marca cada hipótesis con
`data-hypothesis-id` (identidad verificable cross-surface, la usó UI08-R13).

## Build integrado servido (smoke, UI08-10)

Procedimiento establecido (`docs/product/UI-02_SERVING.md`): `node src/ui/serve.mjs`
desde el worktree de la tarea, sin job en curso (ningún lock vivo; el servicio
Tailscale no se tocó). Resultados: ver `INTEGRATED_BUILD_SMOKE_2026-09-29.md`.

## Entrega visual (UI08-11/R12)

- Script de captura: `docs/product/ui-08/render-capture-pages.mjs` (páginas
  autónomas; los valores del estado disponible son datos de test sintéticos, no hechos de producto).
- Capturas: `docs/product/ui-08/captures/{1440,820}-*.png` (Chromium headless del
  cache de Playwright, misma herramienta que la auditoría de fidelidad UI-FIDELITY).
- Comparación con las referencias aprobadas (diseño claro/editorial, `golden/` de
  `docs/product/ui-fidelity/FIDELITY_AUDIT.md` y capturas "before" del servicio):

| Elemento aprobado | Verificado en capturas 1440/820 |
|---|---|
| Banner superior striped + texto de régimen de datos | Igual geometría y texto |
| Navegación de cuatro pestañas (1 Campaigns & Runs · 2 Replay · 3 Backtests · 4 Research) con sub-línea | Igual orden, anchos y subrayado activo |
| `CONTEXT` strip + referencia del boundary | Igual |
| Título serif estable "Backtesting" (sin pregunta DIP/HOUR global) | Igual; las preguntas viven en las tarjetas |
| Tarjetas compactas con cabecera/chip de estado y texto pequeño | Scope 2×2, Hypotheses y Results mismas anatomías |
| Tabla comparativa dentro de contenedor de scroll (iPad) | En 820 la tabla hace scroll, no desborda |
| Estados: UNAVAILABLE con motivo, chip de estado, sin métricas inventadas (win rate / sigma / defaults) | Presentes; ninguna métrica del mockup oscuro |
| Estado disponible: resultado comparable + ΔV de ablation + referencia oficial visible | En `backtests-state-available` |
| Estado bloqueado: UNAVAILABLE explícito por campaña/obligación y enlaces Development marcados bloqueados | En `backtests-state-blocked` |

Diferencia conocida y aceptada: en 820 px el cuerpo mantiene `min-width` del shell
y las tablas canónicas hacen scroll horizontal (misma conducta aprobada en SEM2-T15);
no hay reflow nuevo inventado.

## Acto pendiente fuera de mi autorización

El servicio activo `energy-markets-ui.service` sigue sirviendo el checkout `main`
(`/srv/hot-data/energy-markets/app`, `607f426`) — muestra aún el título antiguo.
Publicar esta entrega ahí exige **integrar la rama a `main` y reiniciar el
servicio**, acto que mis instrucciones prohíben explícitamente (OFICINA.md: "No
hagas merge a `main`"; encargo: "No hagas merge ni push"). Queda registrado como
necesidad de acceso para Bru/Oficina; el smoke del build integrado de esta rama
está completo y registrado arriba.
