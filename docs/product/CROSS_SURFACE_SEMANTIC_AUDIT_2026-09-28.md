# Energy Markets — auditoría semántica transversal

Fecha: 28 de septiembre de 2026. Autor: ChatGPT, a solicitud explícita de Bru. Este documento es una consolidación técnica, no una cita literal del usuario.

## Resultado

La inconsistencia mostrada en Campaigns & Runs y Replay está confirmada. No es solo cosmética: hay significado obsoleto en productores históricos, proyecciones del backend y presentación. La aplicación servida tampoco acredita qué versión de código tiene cargada. La solución debe propagar un contrato compartido, no sustituir etiquetas en cada pestaña.

Base de auditoría: `main e8bbdd4eec60f3b9cd2a92506670c73852a1dbae`; rama FIX-07 inspeccionada en `acfcba1` mientras seguía en corrección. Lecturas HTTP GET de las cuatro rutas y `/health` sobre el servicio existente, puerto 8788. No se lanzó backtest ni se abrió OOS. Las capturas de Bru muestran el diseño claro/editorial que debe conservarse.

## Hallazgos y evidencia

### CS-01 — Los productores históricos atribuyen el comparador simulado al cliente

`operations/exploratory/v2/run-exploratory-backtest.mjs:122-125,247-254` y su equivalente v3 `:177,299-306` crean `BASELINE`, `ARM_A`, `ARM_B` y `research.candidates` con el nombre `Client practice · calendar at 11:00` y autoridad `Current client practice`. Los JSON guardados de v2/v3 conservan esos campos. Son hechos sobre el contenido de los artefactos, no prueba del comportamiento real del cliente. La operación de corrección no debe modificar sus bytes ni cambiar retrospectivamente resultados.

### CS-02 — El backend de las otras páginas transmite esos conceptos sin normalización semántica

`src/ui/view-models.mjs:319-333` transmite `results.replay`, `results.campaigns` y `results.research` mediante `projectExploratoryPages`. `src/ui/server.mjs:101-112` conecta esa proyección a Replay, Research y Campaigns. La integración SEM-1 está separada en `buildBacktestsViewModel`, `view-models.mjs:376-381`. Por tanto, agregar una tabla semántica en Backtests no actualiza los otros consumidores.

### CS-03 — La presentación también contiene decisiones semánticas hardcodeadas

`src/ui/render.mjs:595-596`: diccionario `Baseline / Arm A / Arm B`. `:1181-1187`: enlace Replay condicionado a `ARM_A`. `:1213-1216`: pregunta contra la supuesta práctica del cliente. `:1371-1385`: run, productor DIP10 y reloj 11:00 construidos en el renderer. `:1400-1402,1460-1464`: etiquetas del benchmark proxy, comparador y efectos. `:1514-1515,1540-1542`: autoridad de cliente derivada de BASELINE. No basta sustituir textos: el tipo, versión, rol, alcance y origen deben venir de un contrato de backend verificable.

### CS-04 — Existe un desfase entre checkout, proceso y snapshot servido

`energy-markets-ui.service` estaba activo con PID 796583 y arranque 2026-09-26 14:10:22 UTC, antes de los contratos de hoy. `src/ui/serve.mjs:55-60` carga inputs al iniciar; `src/ui/server.mjs:98-112,198-199` construye una única colección de view models para ese proceso. El payload de `/health`, `server.mjs:139-156`, no identifica el commit/build cargado. No puede afirmarse su commit exacto a partir del HEAD actual del checkout.

Las lecturas GET confirmaron etiquetas antiguas en las cuatro rutas y ninguna aparición de H-S1-01, H-RD-01 o CONTROL. `/health` declaró `canonicalData:false` y `exploratoryData:true` en las cuatro; Replay declaró además `state:ERROR` por falta de boundary canónico, mientras podía mostrar la evidencia exploratoria. Canonizar los conceptos no permite convertir ese estado en evidencia canónica acreditada.

### CS-05 — El trabajo existente no cierra la integración transversal

La revisión operativa v2 de FIX-07 define identidad y compatibilidad; su diff inspeccionado modifica solo 14 líneas de renderer y cuatro de view model, centradas en Backtests/TRADES. UI-08 v2 está dedicada al workspace Backtesting. BT-08 aporta ejecución y resultados del nuevo experimento. Ninguno acreditaba por sí solo la propagación completa de un resultado por Campaigns, Replay, Backtests y Research. No se cambió el contrato congelado del FIX-07 en curso.

### CS-06 — El mockup generado no es el diseño aprobado ni una fuente científica

El mockup oscuro del chat se aleja de la interfaz clara/editorial aportada por Bru. Sus cifras, win rate, sigma threshold, fechas y defaults no son datos ni decisiones aprobadas. Se mantiene el diseño existente; solo se actualiza estructura donde fue autorizada y se propagan los conceptos correctos.

## Decisiones operativas registradas

- SEM-2: nueva integración transversal, posterior a SEM-1, FIX-07 y BT-08. Reutiliza el contrato único; adapta evidencia histórica fuera de los productores congelados; integra las cuatro superficies, sus enlaces, metadatos, estados y snapshots. Exige pruebas de backend sin renderer y pruebas end-to-end con fixtures pequeñas.
- UI-08: revisión operativa v3, manteniendo todo su alcance v2 y añadiendo dependencia de SEM-2, preservación visual explícita y verificación final de las cuatro rutas sobre el build/snapshot realmente cargados.
- Cadena de entrega: SEM-1 -> HYP-1 -> FIX-07 -> BT-08 -> SEM-2 -> UI-08. Las dependencias de pruebas previas se conservan. FIX-06 no se revive. No se reabre HYP-1 ni se interrumpe el FIX-07 en curso.

## Qué debe permanecer verdadero

CLIENT solo contiene evidencia del cliente. Un único BENCHMARK conserva fuente, ventana, unidades, estado y versión por campaña. H-S1-01 y H-RD-01 son hipótesis, con distinto origen; RD no es una familia adicional de comparación. CONTROL pertenece al experimento/ablation, no al cliente ni al benchmark. La misma hipótesis se aplica a Gas Monthly, Gas Quarterly, Power Monthly y Power Quarterly, con datos, estados y resultados separados.

Legacy DIP10 no prueba la nueva H-S1-01; un comparador histórico solo puede vincularse como CONTROL si su protocolo/origen lo permite. Los aliases ambiguos quedan sin homologar, no reinterpretados. Las cantidades solicitadas, fills, MW, MWh, precio y coste total conservan sus unidades y origen. Los desconocidos nunca se convierten en cero. Los datos históricos legibles no se eliminan para esconder la inconsistencia.

Un resultado nuevo publicado por BT-08 debe actualizar una revisión compartida y verificada de lectura para las cuatro páginas, sin ejecutar trabajo en GET ni requerir reiniciar manualmente para cada resultado. La identidad del build se captura desde el código cargado, no desde un HEAD que podría cambiar detrás del proceso.

## Estado de esta entrega de auditoría

Se modifican planificación, criterios y documentación; no se afirma que la UI de producción ya esté corregida. La aceptación del código, las pruebas completas de integración y el despliegue final pertenecen a las tareas indicadas. No hay autorización implícita para abrir OOS, aprobar freezes, lanzar backtests reales, borrar artefactos históricos, cambiar límites de recursos o activar compras.

## Evidencia guardada

`/srv/hot-data/oficina-data/tmp/em-canonical-audit-20260928/`: `health.json`, HTML y texto de las cuatro rutas, `live-route-inventory.json` con hashes y hallazgos de texto, más los receipts de intake/revisión. Los recuentos se refieren al HTML completo de cada ruta, incluidas secciones no seleccionadas, no a una única vista de pantalla.
