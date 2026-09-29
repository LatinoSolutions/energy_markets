# UI-08 · turno de corrección posterior a la revisión (2026-09-29)

Rama `run/energy-markets-UI-08-20260928-234414-opencode`, base del turno `0c70894`.
Basado en el handoff `energy-markets-UI-08-20260929-005155-openrouter-revisar-to-opencode-corregir.json`:
el implementador cerró R01–R10/R12/R13 en `52f4211` y `0c70894`; el revisor independiente
confirmó los 13 CHECK (11 CUMPLE, UI08-10/R11 pendiente) con suite 2274/0.

## Verificación técnica repetida en este turno

- Suite completa: `node --test $(find test -name '*.test.mjs')` → 2274 pass / 0 fail
  (idéntica al checkpoint del implementador; sin regresión frente a `main`).
- UI-08: `node --test test/ui/ui-08.test.mjs` → 32/32; patrón UI08-07/R07/R08 ok
  (los tests citados por el revisor existen y pasan).
- Worktree limpio en la base del turno (`0c70894`); sin cambios de código necesarios.
- Proceso servido verificado en vivo: `systemctl --user status energy-markets-ui.service`
  → WorkingDirectory `/srv/hot-data/energy-markets/app`, checkout en `main` 607f426;
  `GET http://100.92.44.106:8788/backtests` muestra el título DIP/HOUR anterior y su
  `/health` no expone `semanticSnapshot.semanticVersion`. Confirmo el mismo hecho del
  implementador y del revisor.

## CONTRATO DE CORRECCIÓN (OFF-29 §3.4) — respuesta por cada hallazgo abierto

NO_CORREGIDO UI08-R11 | Falta publicar el build integrado en el proceso activo y obtener exit 0 del smoke con su SHA cargado. La parte de la
rama está ejecutada y registrada (`docs/product/ui-08/INTEGRATED_BUILD_SMOKE_2026-09-29.md`:
build `52f4211`, revisión semántica SEM-1/2026-09-28/v1, snapshot `f5163b54…`, 6 rutas 200,
título "Backtesting", 0 preguntas DIP/HOUR). La parte restante es el acto de publicación
(integrar la rama a `main` y reiniciar `energy-markets-ui.service`), que ni OFICINA.md
("Trabaja solo dentro del directorio actual… No hagas merge a `main`, no hagas push, no
cambies de rama") ni el encargo de la tarea ("Haz commit en la rama… No hagas merge ni
push") autorizan desde esta rama. El corrector pidió "seguir el procedimiento establecido y
registrar build cargado, revisión semántica y de datos, y smoke de las cinco rutas":
verificado que no existe en el repo documento ni script de despliegue sobre el checkout
servido distinto de merge a `main` + reinicio (búsqueda en `docs/` y `operations/`; el
servicio sirve el checkout de trabajo, no un artefacto). Esa vía es la ya registrada en
`DELIVERY_REVIEW_ROUND2_2026-09-29.md`, `INTEGRATED_BUILD_SMOKE_2026-09-29.md` y la
`NECESITO_DE_BRU [acceso]` de los resúmenes previos. UI08-10 queda fail-closed, bloqueada
solo por la necesidad de acceso humano; el resto del acceptance técnico está cerrado.

## Dependencia humana vigente

Implementador (`…000635-opencode-corregir`), revisor (`…005155-openrouter-revisar`) y este
turno llegan al mismo hecho con la misma conclusión: confirmación triangulada. La
`NECESITO_DE_BRU [acceso]` ya está redactada completa (FUENTES, BLOQUEA, ALCANCE,
ACTO: ACTUAL, OPCIONES a-c) en los resúmenes de esos dos turnos. No existe REF `P-…`.
No se vuelve a preguntar ni se reemplaza por una respuesta técnica; el punto queda
bloqueado fail-closed hasta decisión de Bru/Oficina.

## Resumen del cierre técnico

El código de la rama conserva los demás CHECK; UI08-10/R11 sigue abierto por el acto
de publicación fuera de la autorización de la rama. Ningún test nuevo en rojo frente
a `main`. Sin merge, sin push, sin tocar el servicio activo. La dependencia humana
de acceso permanece ACTUAL y sin ID `P-` asignado; no se reemplaza por una
corrección técnica ni se da por resuelta.
