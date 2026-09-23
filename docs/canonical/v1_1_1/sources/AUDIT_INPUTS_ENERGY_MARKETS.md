# AUDIT ACOTADO — INPUTS EXISTENTES DE ENERGY MARKETS

**Fecha de corte:** 2026-09-22  
**Modo:** sólo lectura sobre fuentes, código, datos y sistemas  
**Entregables:** este informe y `AUDIT_INPUTS_ENERGY_MARKETS.csv`  
**No realizado:** cambios de SPEC, Paperclip, tickets, agentes, servicios o configuración; backtests; compras; descargas masivas; copia del lago fuera de BruNode; solicitudes al cliente.

## 1. Resumen de una página

### Conclusión ejecutiva

Bru ya confirmó cuatro cantidades y **no deben volver a preguntarse**:

- Gas Monthly: **10 MW**.
- Power Monthly: **10 MW**.
- Gas Quarterly: **60 MW**.
- Power Quarterly: **20 MW**.

Las tres primeras coinciden con dos documentos anteriores que dicen conservar información comunicada por Bru. Power Quarterly no coincide: ambos documentos anteriores registran **«10 Energy» con unidad no explicitada o pendiente**. La discrepancia aparece exactamente en:

- `/Users/brunillo/Documents/energy_markets/plan/Power_Gas_Plan_Maestro_v1_1_2026-09-14.pdf`, página física 4, tabla “Datos comunicados por Bru”.
- `/Users/brunillo/Documents/energy_markets/research/Power_Gas_Cuaderno_Investigacion_13_Preguntas_v1_2026-09-14.pdf`, página física 2, tabla “Obligaciones comunicadas; no reinterpretadas”.
- `/Users/brunillo/Documents/energy_markets/canonical engineering documents/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1.md`, línea 1990, `CCR-08`.
- `/Users/brunillo/Documents/energy_markets/canonical engineering documents/PROCUREMENT_RESEARCH_CANONICAL_CONSOLIDATION_REPORT_v1_1.md`, línea 104, `CCR-08`.
- Bru confirma ahora **20 MW** en `/Users/brunillo/.codex/attachments/dcbf3077-803f-471c-9555-a1c732cd9d21/Pasted text.txt`, líneas 10–21.

No se ha sobrescrito ni reinterpretado el dato anterior. Este informe registra 20 MW como confirmación actual de Bru y conserva “10 Energy” como antecedente contradictorio. Tampoco convierte MW a MWh: siguen faltando periodo, horas y perfil de entrega.

La SPEC v1.1 **sí preserva correctamente la arquitectura y los huecos**: separa Power/Gas y Monthly/Quarterly; distingue obligación total, sizing, BUY/WAIT, fills y cobertura; prohíbe inferir hub o convertir unidades; exige calendario, ejecución, costes, residual y ownership auditados; separa benchmark, baseline y precio ejecutable; y permite implementar piezas independientes sin fingir que existe una campaña real. Esto consta especialmente en §§4–6, 13–14, 24–25.

La SPEC **no contiene las cuatro cantidades como valores reconciliados del contrato de campaña**. Las conserva sólo como cifras históricas en `CCR-08`. Eso era coherente con el corpus anterior, pero queda incompleto frente a la confirmación actual de Bru: 10/10/60 continúan fuera del contrato materializado y 20 MW Power Quarterly no aparece aún en la SPEC. No se corrige aquí porque este audit no autoriza modificarla.

No se localizaron en el alcance inspeccionado los documentos operativos originales de la empresa que materialicen mandato/campaña, producto o hub exacto, delivery, calendario, relación Monthly/Quarterly, fills, residual, costes o reglas de ejecución. BruNode estaba accesible. En `/srv/hot-data/energy-markets/reference` hay 15 PDF y 3 Markdown, pero son el mismo corpus de research/plan/documentación que existe en Mac; los hashes de la SPEC, D08, D15 y D16 coinciden byte a byte entre ambos entornos. Parte del corpus declara expresamente que formaliza conversaciones de Bru y no es una transcripción literal. Por tanto, se clasifica como **documentación derivada/provenance**, no como contrato original de empresa. “No encontrado” sólo describe este alcance; no significa “nunca entregado”.

Sí existen datos reales fuera del workspace: `/srv/hot-data/EEX`. La comprobación acotada confirmó 59.961 Parquet según el log de importación, 93 GB totales, y particiones de trades y top-of-book para NATGAS/THE y POWER/DE. En las cuatro raíces prioritarias se observaron:

- THE trades: 2.801 archivos, fechas de partición 2020-11-02 a 2026-07-28.
- THE top-of-book: 9.251 archivos, 2025-07-25 a 2026-07-28.
- POWER/DE trades: 4.802 archivos, 2020-11-02 a 2026-07-28.
- POWER/DE top-of-book: 33.453 archivos, 2025-07-25 a 2026-07-28.

Los esquemas contienen `ShortCode`, `Maturity`, `ProductISIN`, `InstrumentISIN`, precios, cantidades, `Tm`, `TrdDate`, `_retrieved_at_utc`, hashes de respuesta/fila y acciones de actualización; top-of-book añade bid/ask. El explorador existente mapea `G0BM/G0BQ` para Gas Monthly/Quarterly y `DEBM/DEBQ` para Power Monthly/Quarterly. Esa es evidencia de datos e identificadores, no evidencia de que sean los contratos del cliente ni de derechos de uso.

Por ello, la conclusión de IMP-03 “no existe ninguna serie” es válida sólo para el workspace y corpus que inspeccionó; **no es válida como afirmación global**. Su receipt aceptado mantiene DEP-06/07 sin resolver y A0/A1 en `DATA_BLOCKED`, lo cual sigue siendo prudente. Debe ampliarse el inventario de IMP-03 al lago EEX, no desecharse. La falta de captura contemporánea impide demostrar por sí sola qué conocía la policy históricamente, pero no vuelve automáticamente inútiles todos los datos: los trades y libros sirven para inventario, cobertura, identificadores, cálculo proxy y pruebas de disponibilidad desde la fecha de retrieval; no prueban publicación/consumo histórico anterior a esa captura.

La metodología del benchmark está documentada y existe una implementación sintética aceptada en `src/economic-calculation/benchmark.mjs`, pero no existe todavía un benchmark completo y reconciliado de una campaña real. Una auditoría anterior reprodujo un solo día de Gas Quarterly como referencia derivada provisional; no fue settlement oficial, benchmark trimestral, precio ejecutable ni backtest. Tampoco se localizó en BruNode el código externo `Program.fs`/`HighResolutionProcurementModel.fs` citado por el documento histórico.

### Qué puede continuar ahora

Puede continuar sin nueva información del cliente el trabajo independiente que no pretenda cerrar una campaña real: ampliar el inventario temporal de IMP-03 al lago EEX; validar contract IDs, esquemas, cobertura, duplicados/revisiones y DST; materializar adaptadores fail-closed; continuar fixtures y cálculo B/H/V sintético; y reproducir/reconciliar el proxy de benchmark cuando se disponga de fuente oficial autorizada. La SPEC permite estas piezas sin resultados OOS, Shadow ni evidencia futura.

No puede ejecutarse con validez económica A0 frente a A1 hasta tener una campaña Gas Quarterly auditada y vinculada a los datos: producto/hub/contrato; delivery; calendario/deadline/oportunidades/pausas; relación y ownership de obligaciones; regla terminal; ejecución y costes; lista de campañas elegibles; permisos; y evidencia temporal suficiente. Tampoco existe autorización para operación real.

## 2. Clasificación de las fuentes

| Clase | Qué se encontró | Fuerza probatoria |
|---|---|---|
| Confirmación actual de Bru | Cuatro cantidades en el encargo actual, líneas 10–21 | Autoridad actual para no volver a preguntar las cantidades; aún debe vincularse cada valor a obligación/campaña, periodo y perfil |
| Originales operativos de empresa | No localizados en `/srv/hot-data/energy-markets` ni en los directorios locales priorizados | No se puede afirmar que no existan fuera del alcance; no hay base para inventar sus términos |
| Documentos derivados/provenance | Plan Maestro, Cuaderno, Master Plans P1–P7, research, SPEC y reports | Definen arquitectura, decisiones y antecedentes; no sustituyen mandato, ejecución, derechos ni datos reales |
| Datos observados | Lago EEX en BruNode y su metadata Parquet | Prueba de existencia/cobertura técnica de series; no de compras del cliente, entitlement ni disponibilidad histórica contemporánea |
| Resultados de auditoría | IMP-02, IMP-03, IMP-08 y auditoría EEX previa | Evidencia del alcance inspeccionado; no fuente independiente de hechos que sólo repite del corpus |

## 3. Directorios y documentos inspeccionados

### Mac

Se inventariaron y buscaron términos relevantes en:

- `/Users/brunillo/Documents/energy_markets/documentation/`
- `/Users/brunillo/Documents/energy_markets/plan/`
- `/Users/brunillo/Documents/energy_markets/research/`
- `/Users/brunillo/Documents/energy_markets/canonical engineering documents/`
- `/Users/brunillo/Documents/energy_markets/operations/`, limitado a artifacts de auditoría/progreso pertinentes.

Se leyeron directamente:

- SPEC v1.1 completa por secciones y, en detalle, §§0, 4–6, 13–14, 24–25.
- Consolidation Report v1.1 y Patch Report en los hallazgos de inputs/dependencias.
- Plan Maestro D08 p.4 y Cuaderno D15 p.2.
- Master Plan Open Points D05 p.3.
- Master Plans P1–P4, P5 y P6 en las páginas citadas por la SPEC.
- `documentation/eex-reference-price.md`, líneas 1–126.

No se escucharon audios porque la información necesaria estaba disponible en texto.

### BruNode

Se inspeccionaron en sólo lectura:

- `/srv/hot-data/energy-markets/` hasta cinco niveles para localizar PDFs, documentos, hojas, CSV, Markdown, texto y JSON.
- `/srv/hot-data/energy-markets/reference/`: 15 PDF y 3 Markdown.
- `/srv/hot-data/energy-markets/app/docs/canonical/`.
- `/srv/hot-data/energy-markets/app/operations/audit/IMP-02/`.
- `/srv/hot-data/energy-markets/app/operations/audit/IMP-03/`.
- Receipts `IMP-02-ST-1`, `IMP-03-ST-1`, `IMP-03-IMP_RECEIPT` e `IMP-08-IMP_RECEIPT`.
- `/srv/hot-data/energy-markets/app/src/economic-calculation/benchmark.mjs` y sus referencias/documentación, sólo para verificar existencia y alcance.
- `/srv/hot-data/EEX/_logs/` y `/srv/colibri/reports/eex-import-20260803T231020Z.md`.
- Metadata acotada de las cuatro raíces EEX THE/DE de trade/top-of-book; no se reescaneó el contenido completo del lago.
- `/home/op/apps/power-markets-explorer/scripts/generate_eex_snapshot.py`, líneas 21–134, para mapping e interfaz de lectura existente.
- Búsqueda dirigida de `Program.fs`, `HighResolutionProcurementModel.fs` y nombres de benchmark/settlement en `/srv/hot-data` y `/home/op/apps`.

### Límites

- No se inspeccionaron emails, drives o sistemas corporativos fuera de los paths autorizados.
- No se encontró un registro contractual que pruebe qué documentos “entregó la empresa” ni una firma/origen corporativo de los PDFs derivados.
- No se ejecutó una enumeración integral de filas del lago; se reutilizaron logs, auditoría previa y metadata por raíces concretas.
- No se hizo verificación externa actual de EEX V5.36, endpoints, licencias o vigencia del procedimiento.
- No se ejecutó el código de benchmark, tests ni backtests.
- No se consultó ni modificó Paperclip; los receipts en disco bastaron para el contraste solicitado.

## 4. Información que no debemos volver a pedir al cliente

No volver a preguntar estas cantidades:

| Mission | Confirmación actual de Bru | Trazabilidad anterior | Tratamiento correcto |
|---|---:|---|---|
| Gas Monthly | 10 MW | D08 p.4; D15 p.2 | Conservar como MW; no convertir a MWh sin perfil/horas |
| Power Monthly | 10 MW | D08 p.4; D15 p.2 | Igual |
| Gas Quarterly | 60 MW | D08 p.4; D15 p.2 | Igual |
| Power Quarterly | 20 MW | Encargo actual, líneas 10–21 | Registrar como confirmación actual; conservar “10 Energy” como antecedente contradictorio |

Tampoco debe reabrirse como pregunta conceptual:

- El objetivo es procurement, no trading P&L.
- Power/Gas y Monthly/Quarterly son Missions separadas.
- BUY/WAIT, sizing y execution son funciones distintas.
- WAIT no reduce residual; sólo fills elegibles lo reducen.
- 1-0-1 y 3-1-3 son ventanas del benchmark, no permisos de ejecución.
- La primera población experimental es Gas Quarterly; historia insuficiente produce HOLD.
- Benchmark oficial, proxy derivado y precio/fill ejecutable son objetos distintos.
- OOS, Shadow, parámetros aprendidos y evidencia futura se producen por la investigación; no son información pasada que el cliente debía haber entregado.

## 5. Campañas y obligaciones

### Disponible

- Las cuatro cantidades actuales de Bru.
- El tipo de Mission de cada una.
- Las reglas conceptuales de separación, conservación, ownership y residual de la SPEC.
- Las ventanas documentales del benchmark: Monthly `[S−1 mes,S)` y Quarterly `[Q−4 meses,Q−1 mes)`.

### No encontrado en el alcance inspeccionado

- Campaign IDs reales.
- Producto, hub/mercado y contrato exactos del cliente.
- Periodo, horas y perfil de entrega; liquidación física/financiera.
- Apertura/cierre de compras, oportunidades, deadline y pausas/exclusiones de ejecución.
- Si Monthly y Quarterly son adicionales, solapadas o alternativas.
- Historial de coberturas/compras del cliente y asignación de cada fill a una obligación.
- Volumen ejecutado/restante de una campaña concreta.
- Enmiendas/cancelaciones y regla terminal del residual.

Los trades de EEX son actividad de mercado. No son compras del cliente ni prueban cobertura.

## 6. Ejecución y costes

### Reglas documentadas

- Sólo fills elegibles reducen el residual.
- Partial/no-fill, latencia, lotes, redondeo, spread/slippage, fees y demás costes deben compartir contrato entre A0 y A1.
- Los costes se contabilizan una sola vez.
- Sin regla terminal válida, el residual no recibe fill inventado; queda `COVERAGE_INCOMPLETE`.

### Implementación/fixtures existentes

- IMP-08 fue aceptado el 2026-09-22 para cálculo/scoring y fixtures **sintéticos**.
- Existe código de benchmark/cálculo económico en `/srv/hot-data/energy-markets/app/src/economic-calculation/`.
- Su receipt prohíbe convertir esa aceptación en campaña real, DEP cerrada, research PASS, admisión o autoridad productiva.

### Valores desconocidos

No se encontraron lot sizes, reglas de fill/partial/no-fill reales, latencia, fees, spread/slippage, redondeos, restricciones de liquidez o presupuesto, ni mediciones de ejecución del cliente. Cero no es un default admisible para una evaluación económica real. Se pueden definir escenarios sintéticos para testear código, claramente etiquetados; no sustituyen el contrato real.

## 7. Datos, identificadores, temporalidad y benchmark

### Datos que existen

El lago `/srv/hot-data/EEX` existe y contiene series de trades y top-of-book. Las raíces prioritarias verificadas tienen los campos necesarios para identificar instrumento y evento: producto, maturity, ISIN, moneda/UOM, timestamps de evento y retrieval, hashes y acciones de actualización. El mapping existente del explorador es:

- Power DE-LU Monthly: `DEBM`.
- Power DE-LU Quarterly: `DEBQ`.
- Gas THE Monthly: `G0BM`.
- Gas THE Quarterly: `G0BQ`.

Este mapping y los ISIN son candidatos técnicos para reconciliación. No prueban que DE-LU/THE sean el mandato del cliente; la residencia alemana no basta para seleccionar el hub de Gas.

### Qué permite reconstruir

- Cobertura por partición, instrumento, maturity y fecha observada.
- Trades, updates/deletes, order-book capturado, duplicados por hash y versiones de retrieval.
- Una referencia diaria proxy reproducible y etiquetada cuando las filas cumplen el procedimiento definido.
- Disponibilidad cierta no anterior al retrieval registrado.

### Qué no demuestra por sí solo

- Publicación o disponibilidad para la policy en la fecha histórica del evento cuando la captura fue posterior.
- Que cada trade/book row cumpla toda la cualificación oficial EEX.
- Settlement oficial, entitlement/licencia, calendario contractual completo o equivalencia proxy-oficial.
- Que una serie corresponda a la obligación del cliente.
- Que existan ocho campañas Gas Quarterly elegibles y completas; eso exige vincular datos de mercado a campañas reales.

### Metodología y código

`documentation/eex-reference-price.md` documenta:

- tres valores separados: settlement oficial, referencia diaria derivada y benchmark AskFi;
- ventanas 17:05–17:15 CE(S)T para Power alemán y 17:00–17:15 para Gas/THE;
- proxy trades/book 75/25 o rama disponible;
- fallback ±60 minutos etiquetado `nearby-60m`;
- prioridad official-over-derived;
- benchmark con igual peso por trading date y ventanas 1-0-1/3-1-3;
- reconciliación versionada y limitación del guard 0.01.

La SPEC incorpora esta metodología en §5 y el código actual materializa semántica sintética. Sin embargo, la consolidación no inspeccionó los sistemas externos citados por D16, y la búsqueda actual no encontró `Program.fs` ni `HighResolutionProcurementModel.fs`. El script del explorador genera velas 4H; no es por sí solo la implementación validada del benchmark de campaña.

La auditoría previa de un día, conservada en `/Users/brunillo/.codex/memories/rollout_summaries/2026-09-14T14-43-22-yxW3-brunode_eex_quarterly_gas_read_only_audit.md`, reprodujo para `G0BQ`, maturity `202604`, fecha 2025-12-01, una referencia derivada de **28,4468058192 EUR/MWh**. Ese resultado está correctamente limitado a proxy provisional de un día; no es settlement, benchmark trimestral, fill, ahorro ni evidencia PIT original.

## 8. Cobertura de la SPEC y contradicciones/omisiones

### Correctamente incorporado

| Hecho/regla | SPEC v1.1 | Evaluación |
|---|---|---|
| Separación Power/Gas y Monthly/Quarterly | §4.1, líneas 243–258 | Correcto |
| Volumen total conocido pero sin inventar valor no reconciliado | §4.1, línea 247 | Correcto para el corpus anterior |
| MW no equivale a MWh; hub no se infiere por residencia | §4.1, línea 258 | Correcto |
| BUY/WAIT separado de sizing y execution | §4.2, líneas 260–271 | Correcto |
| Fills, partials, ownership y residual | §4.3, líneas 273–289 | Correcto |
| Benchmark oficial/proxy/AskFi separados | §5.2, líneas 311–361 | Correcto |
| Ventanas 1-0-1/3-1-3 no son calendario de ejecución | §5.3, líneas 382–389 | Correcto |
| PIT, timestamps, missing/revisions | §6 | Correcto como contrato; valores reales pendientes |
| Primer experimento Gas Quarterly y HOLD si falta historia | §13 | Correcto |
| Evaluator, ledgers, residual, statuses y fixtures | §14 | Correcto |
| Dependencias reales y backlog por alcance | §§24–25 | Correcto; no todo faltante bloquea todo trabajo |

### Omisiones o contradicciones vigentes

1. **Power Quarterly.** D08 p.4, D15 p.2, SPEC `CCR-08` línea 1990 y Consolidation Report `CCR-08` línea 104 conservan “10 Energy”. Bru confirma ahora 20 MW. Se registra la contradicción; no se altera la SPEC.
2. **Las cuatro cantidades no están materializadas.** La SPEC dice que el volumen total es conocido, pero no asigna valores numéricos reconciliados en §4.1. Con la confirmación actual, 10/10/60/20 son datos disponibles; aún faltan binding a campaña, unidad ejecutable completa y delivery.
3. **No hay original operativo de empresa en el corpus inspeccionado.** D08/D15 son formalizaciones derivadas de conversación; la SPEC los trata como provenance. La consolidación no demuestra que haya inspeccionado mandato, contratos o fee schedules corporativos.
4. **IMP-02 sigue correctamente bloqueado para campaña real.** `campaignIdentified=false`; la confirmación de MW corrige el conocimiento de cantidad, pero no aporta producto/hub/contrato, delivery, calendario, ownership, residual o ejecución.
5. **IMP-03 tiene una omisión de alcance material.** Su auditoría inspeccionó app/reference y registró `dataArtifactsPresent=[]`. No inspeccionó `/srv/hot-data/EEX`, donde sí hay datos. Su conclusión debe leerse como “no hay series en el workspace”, no “no hay series en BruNode”. DEP-06/07 siguen sin resolverse porque los datos no están vinculados, auditados PIT ni autorizados.
6. **D16 cita implementación externa no localizada.** El documento histórico afirma visibilidad en `Program.fs` y `HighResolutionProcurementModel.fs`; esos archivos no se encontraron en la búsqueda dirigida actual. Sí existe una implementación posterior/sintética en el app Energy Markets, con receipt IMP-08 y limitaciones explícitas.
7. **El rango 2020–2026 no equivale a disponibilidad uniforme.** Trades comienzan en 2020-11-02 en las raíces verificadas; top-of-book comienza en 2025-07-25. La cobertura completa por contrato/maturity, missingness y revisiones está a producir; no se debe llamar a todo “siete años completos”.

## 9. Lista mínima de preguntas externas pendientes

No se envían ahora. Son los únicos paquetes externos que siguen siendo necesarios para una evaluación económica real:

1. **Paquete de mandato/campañas.** Para cada obligación relevante, vincular las cantidades ya confirmadas —sin volver a preguntarlas— a Campaign ID, producto/hub/contrato, vigencia, periodo/horas/perfil de entrega, liquidación, apertura/cierre, oportunidades, deadline, pausas, relación Monthly/Quarterly, ownership de fills, enmiendas y regla terminal. Debe incluir la lista histórica de campañas elegibles si existe.
2. **Paquete de ejecución y costes.** Lotes/redondeo, restricciones, reglas de fill/partial/no-fill, latencia, fees, spread/slippage y cualquier coste o límite aplicable al contrato exacto.
3. **Paquete de autoridad de datos/benchmark.** Confirmación de derechos/entitlement para las fuentes realmente usadas, contract master/calendario aplicable, fuente oficial de settlement y sus revisiones/publication timestamps. Si no existe evidencia contemporánea completa, debe declararse el alcance demostrable en vez de fabricar PIT.

No hacen falta preguntas sobre OOS resultante, Shadow, edge, parámetros aprendidos o evidencia futura; eso se produce en la investigación.

## 10. Qué puede continuar y qué queda condicionado

### Puede continuar ya, sin nueva respuesta del cliente

- Corregir **en una futura tarea autorizada** el inventario factual de IMP-03 para incluir el lago EEX; este audit no modifica IMP-03.
- Inventariar por `DEBM/DEBQ/G0BM/G0BQ`, maturity e ISIN la cobertura, resoluciones, duplicados, updates/deletes, missingness y retrieval versions.
- Verificar conversiones Europe/Berlin ↔ UTC y casos DST sobre muestras acotadas.
- Producir temporal manifests que separen event/reference time, publication time cuando exista, policy-consumable time y revision/retrieval.
- Materializar lectores, schemas, validadores fail-closed y adapters que no inventen valores.
- Mantener y ampliar cálculo B/H/V y fixtures sintéticos de IMP-08; no presentarlos como resultado económico.
- Reproducir referencias proxy y coverage reports por fecha, con etiquetas y hashes.
- Preparar reconciliación official-over-proxy y el fixture 0.01; la equivalencia final espera fuente oficial autorizada.
- Documentar con precisión qué histórico es usable para análisis de mercado y qué pretensión PIT no puede sostenerse.

### Requiere información adicional antes de cerrar o ejecutar con validez económica

- IMP-02: campaña/mandato y ownership reales.
- Baseline A0 y candidate A1 sobre datos reales: campaña, calendario, ejecución/costes y vínculo exacto a series.
- IMP-05 final: fuente oficial o autorizada, calendario y reconciliación por campaña/fecha.
- IMP-07/IMP-09: lista de campañas elegibles, overlaps y al menos ocho quarters completos en dos años, si existen.
- IMP-10/IMP-11 y replay económico: obligación, oportunidades, sizing común, ejecución causal y parámetros frozen.
- P6/IMP-12–16 reales: bundle completo, ledgers, benchmark, cobertura, receipts y OOS intacto.
- Cualquier Shadow/Real o compra: governance y autorización humana separada; nada en este audit la concede.

## 11. Dictamen final

La investigación no está bloqueada “por falta de todo”. Ya hay arquitectura, cantidades confirmadas, metodología, datos EEX, tooling de lectura y cálculo/fixtures sintéticos. El siguiente trabajo legítimo es cerrar el **gap factual** entre esos elementos: vincular mandato/campañas reales con los instrumentos y calendarios del lago, auditar temporalidad/derechos y materializar ejecución/costes.

El primer resultado económico real sigue bloqueado. No porque falte rediseñar la SPEC ni porque no existan datos, sino porque todavía no existe un bundle auditable que una obligación real, calendario, ejecución, benchmark, PIT y población OOS. Las cuatro cantidades quedan fuera de futuras preguntas; el dato nuevo crítico es Power Quarterly 20 MW, con contradicción histórica preservada.

