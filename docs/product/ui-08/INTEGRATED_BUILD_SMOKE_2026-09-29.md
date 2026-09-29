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
el orden Scope → Hypotheses → Results y el título estable. El CLI también
contrasta el PID de ambas lecturas de `/health` con el `MainPID` de
`energy-markets-ui.service`, para que un servidor local de fixture no acredite
la unidad activa. Solo hace GET; no
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

### Relectura de Cierre · 2026-09-29T01:50:01Z

El verificador ahora coteja también `health.surfaces[route].snapshotRevision`
con la revisión publicada al inicio y al final. Una prueba HTTP altera la
revisión de Replay en `/health` y exige rechazo; el test focalizado pasa 7/7.
No se usó esta mejora para declarar publicada la rama.

El smoke GET contra `http://100.92.44.106:8788/`, esperando
`80e5d6e81cf922c9192f4cd25602d3a0d6966532`, terminó con **exit 1**.
Las seis rutas `/health`, `/api/backtest-jobs`, `/campaigns`, `/replay`,
`/backtests` y `/research` respondieron HTTP 200. El proceso no declara commit,
versión semántica ni revisión, y `/backtests` mantiene la pregunta global
DIP/HOUR. El checkout servido sigue en `main` `607f426b51638fb3afb993292dbc0ed0743ab7ed`.
El estado antiguo de jobs no basta para acreditar el gate de inactividad al
inicio y al final. Se conserva UI08-R11 como **NO_CORREGIDO** hasta que la
Oficina publique el build autorizado sin job en curso y el verificador salga 0
contra el SHA efectivamente cargado. La solicitud de acceso ya registrada
permanece abierta (sin ID `P-`); esta relectura no solicita una decisión nueva.

### Relectura de Cierre · 2026-09-29T02:03:39Z

El commit `b2b09d5ef87904829841e452f3bd3d78103d1985` vincula los títulos de
navegación de las cuatro superficies a la proyección canónica del backend. El
verificador ahora compara la etiqueta dentro de cada enlace de navegación y
las etiquetas primarias de misión/identidad en su posición visible; una mención
inglesa secundaria ya no oculta una etiqueta primaria distinta. Los tests
focales pasaron **42/42** y `node --test $(find test -name '*.test.mjs')` pasó
**2284/2284**, sin fallos.

El smoke GET con ese SHA esperado contra `http://100.92.44.106:8788/` terminó
**exit 1**. Las seis rutas respondieron HTTP 200, pero `/health` no declaró
commit, versión semántica ni revisión de snapshot y `/backtests` conservó el
título anterior. El servicio siguió `active/running` (PID 796583) sobre `main`
`607f426b51638fb3afb993292dbc0ed0743ab7ed`. El endpoint antiguo no
acredita un estado de jobs legible; esto no afirma que hubiese un job en curso.
No se hizo merge ni reinicio. UI08-R11 sigue abierto hasta publicación
autorizada sin job en curso y smoke **exit 0** del SHA efectivamente cargado.

### Cierre técnico del verificador · 2026-09-29

El verificador coteja ahora en **cada una de las seis respuestas HTTP** los
headers `X-EM-Build-Commit`, `X-EM-Snapshot-Revision` y
`X-EM-Semantic-Version` con el build y la revisión publicados en `/health`.
El servidor fija los tres al responder desde el proceso y snapshot cargados;
una ruta que declara otro commit, snapshot o versión falla cerrada. El test
`UI08-R11: each HTTP route must report the loaded build and published revision`
altera sólo el header de `/research` y exige rechazo. La suite completa terminó
con **2285 pass / 0 fail**.

El smoke de solo lectura contra `http://100.92.44.106:8788/`, esperando el
HEAD previo a este cambio (`9db31f44eaa946565032d190c8fd2169dfa6b8cf`),
terminó **exit 1**. Las seis lecturas respondieron HTTP 200, pero el servicio
antiguo no declaró commit, revisión ni versión semántica, ni los headers nuevos;
`/backtests` aún sirvió el título global anterior. El estado de jobs tampoco
resultó legible bajo el contrato nuevo: no se infiere que hubiera uno corriendo.
Esta evidencia **no** acredita UI08-10. La publicación y el smoke con el SHA
final cargado siguen pendientes del acto autorizado ya registrado.

### Corrección del gate de publicación · 2026-09-29

El verificador rechaza ahora un snapshot cuya última republicación fue
rechazada, aunque el proceso conserve una revisión anterior válida. Comprueba
`semanticSnapshot.publishedAt` y `lastPublicationRejected` en las lecturas
inicial y final de `/health`; el test `UI08-R11: a rejected canonical snapshot
refresh cannot pass the served smoke` reproduce el caso. Esto evita atribuir a
la versión servida un resultado BT-08 que el backend no llegó a publicar.

La lectura GET de `http://100.92.44.106:8788/` contra el HEAD previo
`4d164c5d5d4332ba7866db673c64ec54e19e8c49` terminó con **exit 1**.
Las seis rutas respondieron HTTP 200, pero el servicio aún no expone build,
versión semántica, revisión ni metadatos de publicación del contrato nuevo;
`/backtests` mantiene el título anterior. El nuevo error de publicación
ausente es una señal adicional del servicio antiguo, no evidencia de un
rechazo real de republish en ese proceso. UI08-R11 sigue abierto hasta la
publicación autorizada y el smoke exit 0 del SHA cargado.

### Relectura del mismo gate · 2026-09-29

Con HEAD `06060a96226378ec7f82149e5c38d809f026b250`, el verificador de
solo lectura volvió a consultar `http://100.92.44.106:8788/` y terminó
**exit 1**. `/health`, `/api/backtest-jobs`, `/campaigns`, `/replay`,
`/backtests` y `/research` respondieron 200; el proceso cargado no declaró
commit, versión semántica ni revisión de snapshot bajo el contrato nuevo, y
`/backtests` aún mostró el título global anterior. El checkout servido está
en `main` `607f426b51638fb3afb993292dbc0ed0743ab7ed`. El endpoint antiguo
declara `running:false` para el job conocido, pero no permite acreditar el
estado de todos los runners del build integrado. UI08-10/R11 permanece
abierto. Una corrección de etiqueta de rol dentro de la rama no sustituye la
publicación y la verificación del SHA finalmente servido.

### Relectura de Cierre: metadatos ingleses y proceso activo · 2026-09-29

El commit `c0bb24f00f4156bbb0a196b8dea2d50f2fe39c15` hace que el smoke
rechace `labels.tabs` ausente o traducido en la proyección backend, aunque el
HTML tenga navegación inglesa. La prueba `UI08-R11: a served backend with
missing or translated navigation metadata fails closed` pasa en ambos casos.
`node --test $(find test -name '*.test.mjs')` terminó **2289 pass / 0 fail**.

Con ese commit esperado, el verificador consultó en solo lectura
`http://100.92.44.106:8788/` y terminó **exit 1**. Las seis rutas respondieron
HTTP 200, pero el servicio no declaró commit cargado, versión semántica ni
revisión de snapshot y `/backtests` conservó el título anterior. Su estado de
jobs no es legible bajo el contrato nuevo; no se afirma que haya un job
corriendo. `energy-markets-ui.service` sigue apuntando al checkout
`/srv/hot-data/energy-markets/app` en `main` `607f426b51638fb3afb993292dbc0ed0743ab7ed`.
La mejora del verificador es ingeniería de la rama; **UI08-R11 no está
corregido** mientras el build integrado no sea publicado con autorización y
verificado con exit 0 contra el SHA efectivamente cargado. Se conserva la
dependencia de acceso ya registrada, ACTO: ACTUAL, sin un nuevo pedido.

### Cierre del gate de inactividad · 2026-09-29

El smoke ahora rechaza una respuesta de `/health` sin el runner de backtests
configurado y cualquier respuesta de `/api/backtest-jobs` sin los runners de
TRADES e Hypotheses. Repite la comprobación después de leer las cuatro páginas.
Antes, un servidor de fixture sin ejecutores podía pasar el gate con
`configured:false` y `running:false` o `null`; ese estado no acredita que el
almacén de jobs del proceso real esté inactivo. El test
`UI08-R11: a server without the canonical job runners cannot attest release
idleness` reproduce el rechazo y el fixture positivo usa tres ejecutores
explícitos en reposo. `node --test test/ui/ui-08-served-build.test.mjs` pasó
16/16 y `node --test $(find test -name '*.test.mjs')` pasó 2293/2293.

El servicio activo sigue configurado para arrancar desde
`/srv/hot-data/energy-markets/app` en `main` `607f426b51638fb3afb993292dbc0ed0743ab7ed`.
Este cierre del verificador no acredita la publicación: UI08-R11 requiere aún
el smoke exit 0 del SHA cargado tras la integración autorizada, sin job en
curso. La dependencia de acceso ya registrada permanece ACTO: ACTUAL y sin ID
`P-` asignado.

### Proyección backend estable durante el smoke

El verificador coteja también el contenido de `canonicalSemantics` entre la
primera y la última lectura de `/api/backtest-jobs`. Una misión que cambia de
etiqueta conservando `semanticVersion` y los headers de revisión debe fallar:
lo cubre el test `UI08-R11: backend projection changing without a version
change fails the served smoke`. Este control sólo mejora la comprobación de la
publicación; la aceptación UI08-10 sigue pendiente del smoke con exit 0 en el
proceso activo tras la publicación autorizada y sin job en curso.

### Legibilidad explícita de los tres ejecutores · Cierre

El endpoint de jobs ahora declara `statusReadable:true` sólo cuando cada
ejecutor devuelve su estado sin error. El smoke exige esa declaración para
TOB, TRADES e Hypotheses al principio y al final: `running:false` sin una
lectura acreditada ya no supera el gate. El test de R11 elimina el campo de
cada ejecutor por separado y exige rechazo. Esta corrección es verificable
en la rama; el servicio activo sigue requiriendo publicación autorizada y
smoke `exit 0` contra el SHA realmente cargado. No se considera R11 cerrado.

### Gate de vocabulario canónico y estado de entrega · 2026-09-29

El verificador exige ahora que la proyección backend sirva los nombres ingleses
aprobados de las cuatro misiones y de H-S1-01/H-RD-01, así como las etiquetas
canónicas de identidad, rol y estado. El render continúa consumiendo esa misma
proyección; estas aserciones son sólo del smoke de entrega. Una prueba altera
el payload backend mientras deja el HTML en inglés y exige rechazo explícito.
`node --test test/ui/ui-08-served-build.test.mjs` pasó 15/15 y
`node --test $(find test -name '*.test.mjs')` pasó 2291/2291.

El smoke GET del servicio Tailscale aún anterior, esperando el SHA de la rama
antes de este cambio (`a08c66569acd992923605194c36f9f3c7946a7fd`), terminó
**exit 1**. Las seis rutas respondieron 200, pero `/health` no declaró build,
versión semántica ni revisión de snapshot del contrato integrado y `/backtests`
conservó el título antiguo. La unidad sigue configurada para ejecutar
`/srv/hot-data/energy-markets/app` en `main`. UI08-R11 continúa abierto:
después de la integración y publicación por la Oficina, con inactividad de jobs
verificada, se debe ejecutar el verificador contra el SHA efectivamente cargado
y exigir **exit 0**. Esta nota no acredita publicación ni aceptación UI08-10.

### Registro de todas las respuestas del smoke · Cierre

El informe del verificador incluye ahora `responses`: las seis rutas HTTP y
las lecturas finales repetidas de `/health` y `/api/backtest-jobs`, en orden,
con código HTTP, commit, revisión del snapshot y versión semántica observados
en cada respuesta. La prueba positiva exige las ocho identidades iguales; las
comprobaciones de rechazo del verificador siguen vigentes. Así el informe
permite auditar el intervalo completo sin inferir las identidades a partir de
un solo valor final. La publicación del servicio Tailscale sigue pendiente y
este cambio no acredita UI08-10 por sí mismo.

### Revalidación de Cierre · 2026-09-29T03:52:52Z

`node --test test/ui/ui-08-served-build.test.mjs` pasó 16/16 y
`node --test $(find test -name '*.test.mjs')` pasó 2293/2293, sin fallos.
Un proceso local de `src/ui/serve.mjs` cargó el commit de código `d87e85d28c6efcb7885b6a8218ba4556d2425e46`:
el verificador salió 0, las seis rutas respondieron HTTP 200 y las ocho
lecturas registraron ese commit, `SEM-1/2026-09-28/v1` y el snapshot
`04b5f12591a8077115f6271a233f93d110f4332a56285dfee05a483f963b9288`.

La lectura de solo GET del servicio activo en `http://100.92.44.106:8788/`,
esperando ese commit, salió 1. Las seis rutas respondieron 200, pero
`/health` no declaró build ni revisión y `/backtests` mantuvo el título
anterior. El checkout de la unidad sigue en `main`
`607f426b51638fb3afb993292dbc0ed0743ab7ed`. El contrato antiguo no
permite acreditar la inactividad de todos los runners; no se infiere que
hubiese un job en curso. No se integró la rama ni se reinició la unidad.
UI08-R11 y UI08-10 siguen pendientes del acto de publicación autorizado y
del smoke exit 0 del SHA realmente cargado.

### Revalidación de la ventana de entrega · 2026-09-29T04:45:36Z

El verificador rechaza ahora un job que empieza y termina entre sus dos
lecturas inactivas: compara la última ejecución de TOB, TRADES e Hypotheses,
y el índice de familias publicado. El test `UI08-R11: a job completing between
two idle reads invalidates the release smoke` reproduce los tres casos sin
ejecutar un backtest. `node --test test/ui/ui-08-served-build.test.mjs` pasó
24/24 y `node --test $(find test -name '*.test.mjs')` pasó 2301/2301.

El smoke de solo lectura del servicio activo, esperando el HEAD previo a este
commit `de7d2f75693d799042b4c95e339d1a16460d21fb`, devolvió **exit 1**.
Las seis rutas HTTP respondieron 200, pero `/health` no declaró el commit
cargado ni la revisión del snapshot; tampoco acreditó el PID de la unidad.
El servicio sigue configurado para arrancar desde `/srv/hot-data/energy-markets/app`
en `main` (`607f426b51638fb3afb993292dbc0ed0743ab7ed`). Ese contrato
anterior no permite certificar la inactividad de los tres runners; la prueba
no afirma que hubiera un job en curso. UI08-R11 permanece abierto para la
publicación por el cauce de la Oficina y un smoke posterior con **exit 0**
contra el commit efectivamente cargado y las seis respuestas con identidad
compartida. No se hizo merge, push ni reinicio del servicio.

### Comprobación de Cierre · 2026-09-29T04:54:20Z

- Rama de UI-08: `run/energy-markets-UI-08-20260928-234414-opencode`,
  HEAD comprobado `85f53d0b20c9bcd5bd39e8295581870b851fd88b`, árbol limpio
  antes de registrar esta evidencia.
- `node --test $(find test -name '*.test.mjs')`: **2301 pass, 0 fail**.
- `energy-markets-ui.service`: `active/running`, PID `796583`, iniciado
  `2026-09-26 14:10:22 UTC`. Su `WorkingDirectory` y su `ExecStart` apuntan
  a `/srv/hot-data/energy-markets/app`; el checkout de esa ruta estaba en
  `main` (`607f426b51638fb3afb993292dbc0ed0743ab7ed`) con archivos
  de runtime sin seguimiento. El contrato HTTP antiguo no identifica el
  commit cargado en memoria; el SHA del checkout **no** se atribuye al proceso.
- `node docs/product/ui-08/verify-served-build.mjs
  http://100.92.44.106:8788/ 85f53d0b20c9bcd5bd39e8295581870b851fd88b`:
  **exit 1**. `/health`, `/api/backtest-jobs`, `/campaigns`, `/replay`,
  `/backtests` y `/research` respondieron HTTP 200. Ninguna de las ocho
  lecturas (incluidas las repeticiones de los dos endpoints mutables) declaró
  commit, revisión de snapshot ni versión semántica. `/backtests` siguió
  mostrando la pregunta global antigua. El estado de los tres runners no
  es certificable con este payload; no se afirma que hubiera un job en curso.

**Estado separado:** los tests del código de UI-08 están verdes; la
aceptación UI08-10 y el hallazgo UI08-R11 siguen pendientes de la publicación
autorizada y del smoke **exit 0** sobre el PID y SHA realmente servidos.
La unidad tiene una ruta fija a `main`; este agente tiene prohibido integrar
la rama y reiniciar el servicio. Los `REQUIRES*` de §25.2 son dependencias
consumidas; `RESOLVES_AUDIT` y `PRODUCES_EVIDENCE` son salidas. Esta prueba
servida es un criterio de entrega de la fila UI-08, no una evidencia que pueda
sustituirse con un checkout o un test local.

### Relectura de Cierre · 2026-09-29T05:04:36Z

- Rama UI-08: `run/energy-markets-UI-08-20260928-234414-opencode`,
  HEAD de la verificación `216daa6d5ca7bdad295dbf7847c8644536f9ceb7`.
- `node --test $(find test -name '*.test.mjs')`: **2301 pass, 0 fail**.
- `energy-markets-ui.service`: `active/running`, MainPID `796583`;
  `WorkingDirectory` y `ExecStart` apuntan a
  `/srv/hot-data/energy-markets/app`, cuyo checkout está en `main`
  (`607f426b51638fb3afb993292dbc0ed0743ab7ed`) con archivos de runtime
  sin seguimiento. No se tocó ese checkout ni la unidad.
- `node docs/product/ui-08/verify-served-build.mjs
  http://100.92.44.106:8788/ 216daa6d5ca7bdad295dbf7847c8644536f9ceb7`:
  **exit 1**. Las seis rutas respondieron 200; sus ocho lecturas HTTP,
  incluidas las dos lecturas de `/health` y `/api/backtest-jobs`, carecen de
  identidad de build, revisión de snapshot y versión semántica. El payload
  antiguo tampoco acredita el PID ni un estado legible de los tres runners.

El hecho técnico no cambió: el verificador y su prueba local ya están en la
rama, pero UI08-10 requiere el proceso de la unidad realmente servido con el
SHA integrado. Esta relectura no prueba que hubiese un job activo y no declara
aceptado UI08-R11. La publicación requiere integrar la rama en `main` y
reiniciar la unidad; ambas operaciones quedan fuera de la autorización de
este worktree. Tras la publicación autorizada y con los runners inactivos y
legibles, el mismo comando debe salir 0 y mostrar identidad compartida en
las seis respuestas HTTP.

### Corrección de Cierre · 2026-09-29T05:16Z

El verificador ahora lee también los cuatro drilldowns Development por misión
del proceso servido. Cada lectura debe compartir build, revisión de snapshot y
versión semántica con los seis endpoints canónicos. Para una misión bloqueada,
el control debe seguir deshabilitado, no puede incluir un request de ejecución
y debe mostrar el motivo que Scope recibió del backend. Para una misión READY,
el request embebido debe ligar hipótesis, versión, misión y fase Development.
Así el smoke cubre el estado `UNAVAILABLE` del control realmente servido, no
solo el enlace de la página general. Las pruebas de regresión alteran un botón,
su motivo y la revisión HTTP de un drilldown para exigir fallo cerrado.

- `node --test test/ui/ui-08-served-build.test.mjs`: **27 pass, 0 fail**.
- `node --test $(find test -name '*.test.mjs')`: **2304 pass, 0 fail**.
- `node docs/product/ui-08/verify-served-build.mjs
  http://100.92.44.106:8788/ d615f9728661e4ce46cd95c620e031b297a07b4f`:
  **exit 1**. Los seis endpoints y cuatro drilldowns devolvieron HTTP 200
  (12 lecturas, incluidas las repeticiones finales de los dos endpoints
  mutables), pero el proceso no declara commit, revisión ni versión semántica.
  El verificador no afirma que conozca el SHA cargado ni que haya un job activo.

La corrección del verificador queda en esta rama. UI08-R11 permanece abierto:
un test local y estas respuestas del proceso anterior no acreditan el smoke
`exit 0` del build integrado. Se conserva la dependencia de acceso ya
registrada, sin ID `P-` asignado; no se vuelve a solicitar ni se declara
resuelta. La publicación y el reinicio de la unidad están fuera de la
autorización de este worktree.

### Verificación de Cierre · 2026-09-29T05:31Z

El CLI vuelve a leer `MainPID` de `energy-markets-ui.service` después de la
última respuesta HTTP. Si la unidad cambia o deja de publicar un PID legible
durante el smoke, el resultado falla cerrado aunque todas las respuestas
anteriores procediesen del proceso esperado. La prueba de regresión fuerza
ambos casos, además del PID estable.

- `node --test test/ui/ui-08-served-build.test.mjs`: **28 pass, 0 fail**.
- `node --test $(find test -name '*.test.mjs')`: **2305 pass, 0 fail**.
- `node docs/product/ui-08/verify-served-build.mjs
  http://100.92.44.106:8788/ 4d505f6c196c1fa9fc3bfd942c3fd720c6d01b5c`:
  **exit 1**. Las seis rutas canónicas y los cuatro drilldowns devolvieron
  HTTP 200 (12 lecturas), pero el proceso activo no publicó commit cargado,
  versión semántica ni revisión de snapshot. El payload antiguo tampoco
  acredita el estado legible de los tres runners. No se infiere que haya un
  job activo.
- La unidad seguía `active/running`, `MainPID=796583`, con
  `WorkingDirectory=/srv/hot-data/energy-markets/app`; ese checkout continuaba
  en `main` `607f426b51638fb3afb993292dbc0ed0743ab7ed`. Es evidencia de la
  ruta configurada, no prueba del SHA cargado por el proceso antiguo.

UI08-R11 continúa abierto. Este smoke no reemplaza la publicación autorizada
de UI-08 ni el **exit 0** posterior contra el SHA realmente cargado. El gate de
acceso ya registrado para integrar y reiniciar permanece abierto, sin ID `P-`
asignado; esta verificación no solicita una decisión nueva. Conforme a la fila
UI-08 de `PLAN_STATUS.md`, el smoke servido pertenece a la entrega actual.
Los `REQUIRES*` de SPEC §25.2 son dependencias consumidas y `RESOLVES_AUDIT` y
`PRODUCES_EVIDENCE` son salidas; ninguno sustituye este acto de UI08-10.
