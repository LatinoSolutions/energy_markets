# ST-28.1 — revisión final de etapa 2: approved

Aceptación limitada a WP-IMP-28-ST-1-v1.1 / ST-28.1, framework v1.1 del proyecto Energy Markets. SPEC SHA256 `86c4bd4eeb5f9d0ebad94763128b221eb64525a2b7fff1007dab0af88b39cb6c`. Código/tests revisados: `274bec7430ffc9e90c6898eacd55a55ad5f0e1a797656ce88db53ef413b0d8d2`. ST_RECEIPT SHA256 `148a7b45bddabe7d98fdbaa47113355e522d1ee53a07f01394936cb3391cb225`.

## Decisión y secuencia de revisión

Stage 1 Opus aprobado nativamente (decision `4da37f43-3636-4ed7-bf28-6a7cfce77fa9`, run `5015e990-6303-4934-86db-f83305f0e7e9`). Stage 2 Command solicitó CMD-1 y CMD-2 por las transiciones nativas; ambas remediaciones volvieron al mismo participante conforme a executionPolicy, sin reabrir ni simular la etapa 1. Autor de remediación más reciente: `2f30b8dd`, run `dfa59164-9b18-406f-b64e-cc7725132d1f`. Command no implementó el código revisado.

Todos los cambios bloqueantes solicitados quedan resueltos. No quedan rondas obligatorias pendientes en este issue. Se registra approved por PATCH nativo al finalizar esta evidencia.

## Hallazgos cerrados

- CMD-1: identidad componente/rol/version/protocolo cotejada contra todo el historial antes de mutar estado. Probe original inalterado: ambas reutilizaciones rechazadas, REJECT/HOLD preservados, eligible=false.
- CMD-2: clave JSON del tuple `(versionKey(componentVersion), protocolId, versionKey(protocolVersion), value)` incluye el protocolo y evita ambigüedad de delimitadores. Probe original inalterado: dos REJECT de protocolos diferentes sobreviven en priorFindings, tanto semver como content-hash. La misma entrada repetida entre las listas se deduplica sin perder identidades distintas.
- R1/R2: correcciones anteriores preservadas; el delta actual de producción sólo cambia esa clave de deduplicación y añade su regresión en tests.

## Criterios del packet

1. Cuatro clases y catorce campos §11.6.2, identidades/versiones y protocolo predeclarado: satisfecho; CMD-1/2 completan las guardas de identidad revisadas.
2. JEV sin rol predeterminado, outcomes por rol independientes, namespace separado de research: satisfecho; fuente ya revisada y suites actuales sin regresión.
3. Autoridad inicial vacía, requested/granted separados, Strategy/Evidence con gate externo §8.7 y Execution/Governance con validación separada: satisfecho en el framework estructural. No se afirma comprobar la autenticidad externa de futuras referencias.
4. Unknowns, coste/latencia/carga, overlap, reproducibilidad y rollback conservados; engineering no reclama procurement edge ni hay integración automática: satisfecho para el alcance sintético.
5. Protocolo/evidencia/gates ausentes, separación, autoridad y versiones previas cubiertos; ambos probes de Command pasan. Satisfecho.
6. ST_RECEIPT y linkage validados, alcance y facts abiertos explícitos; prerequisites y hashes preservados, evidencia y snapshot vigente adjuntos. Satisfecho con la evidencia de scope disponible en workspace compartido.

## Verificación independiente de este wake

- Host/cwd: brunode, /srv/hot-data/energy-markets/app.
- Suites: 38/38 role-evaluation, 67/67 contracts, exit 0.
- Probes CMD-1 y CMD-2: exit 0; originales comparados byte a byte con snapshot anterior, sin cambios.
- validateStReceipt y linkStReceiptToPacket: ok=true, exit 0.
- SPEC, accepted IMP-01 receipt y baseline: hashes exactos. Todos los hashes de evidencia del IMP-01 aceptado coinciden.
- Manifiesto del autor: 58/58 hashes coinciden. Hash agregado de diez archivos fuente/test reproducido con sha256 de líneas ordenadas `path + espacio + sha256 + newline`.

Las salidas completas, comandos, códigos de salida y hashes constan en verification.json y check-*.txt de este directorio. Sólo se añadió evidencia de review dentro de operations/audit/IMP-28 y en este issue; no hubo cambios del revisor en producción, receipts previos, SPEC, políticas compartidas, timers o routing. La evidencia de write set y las revisiones previas no equivalen a una auditoría global de todas las escrituras históricas del workspace compartido.

## Límites conservados

R3-E (congelación de algunos objetos del llamante) sigue siendo una observación no bloqueante, no un cambio obligatorio sin resolver ni una afirmación de aislamiento perfecto. No altera las condiciones de aceptación de esta ST.

Esta aprobación acepta sólo ST-28.1 framework: no es IMP_RECEIPT, no acepta el padre [LAT-113](/LAT/issues/LAT-113), no cierra DEP-28, no evalúa/admite ningún componente real ni concede autoridad productiva. La aceptación §20.2.10 del padre debe ejecutarse por separado con sus propios gates. Command sale de este wake tras registrar el estado nativo; no permanece supervisando.
