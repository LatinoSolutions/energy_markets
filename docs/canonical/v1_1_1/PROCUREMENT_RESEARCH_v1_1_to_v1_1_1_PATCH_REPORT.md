# PROCUREMENT RESEARCH — Actualización documental v1.1 → v1.1.1

**Fecha:** 2026-09-22. **Autoridad:** Bru confirma las cantidades y solicita actualizar la documentación. **Alcance:** cantidades, conocimiento factual de inputs y corrección del alcance de ausencia de datos. No se cambia arquitectura, metodología ni el grafo canónico.

## 1. Resultado

Las dos versiones completas están editadas y verificadas documentalmente. Los documentos de base y las dos piezas de U-AUDIT se conservan byte a byte en este paquete. La información factual también se incorporó a la descripción del issue raíz **LAT-91** con lectura independiente posterior. No se modificaron los Markdown originales de Mac/BruNode ni el path/hash de SPEC que tiene vinculado Paperclip.

| Entregable nuevo | SHA-256 |
|---|---|
| `PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1_1.md` | `666a9735d9daf62764582f017056171acae52070d18499b26c5c6e426cff3ef3` |
| `PROCUREMENT_RESEARCH_CANONICAL_CONSOLIDATION_REPORT_v1_1_1.md` | `ae9f8217071770402e4a2249bfccf6cffe397c861d05bfb2373c9c8af5eb9792` |

## 2. Fuentes y baselines

| Copia preservada | SHA-256 |
|---|---|
| `baselines/PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1.md` | `86c4bd4eeb5f9d0ebad94763128b221eb64525a2b7fff1007dab0af88b39cb6c` |
| `baselines/PROCUREMENT_RESEARCH_CANONICAL_CONSOLIDATION_REPORT_v1_1.md` | `7c2d952949aee5d5bad11da1cf5122bb078ebaafa980b0083d8146ca9ff2e862` |
| `sources/AUDIT_INPUTS_ENERGY_MARKETS.md` | `96e0b76356f901acdaf4fed9634908818ecd4d78627955d7217792367143710f` |
| `sources/AUDIT_INPUTS_ENERGY_MARKETS.csv` | `9470e789fef1389204a76b27bf2849009c5c65d3dfac06167de58a8ccc005f04` |

Los hashes identifican las copias de los adjuntos de esta conversación. No son hashes calculados de nuevo en las rutas del Mac/BruNode que cita el audit. El CSV fuente se conserva como evidencia sin cambiar sus 36 requisitos, estados ni recomendaciones históricas. El audit describe su momento de corte; no se reescribe para fingir que ya incluía esta edición.

## 3. Cambios exactos

| Documento / sección | Cambio |
|---|---|
| SPEC §0 | Nueva versión/fecha/archivo, referencias de informe, alcance histórico de D00–D18 y §0.5 con fuente/autoridad/límite de publicación |
| SPEC §4.1 | Tabla 10 MW Gas Monthly, 10 MW Power Monthly, 60 MW Gas Quarterly y 20 MW Power Quarterly; fuente owner; no repetir pregunta; sin MWh ni campaña inventada |
| SPEC §6.5 | Cuatro raíces EEX, fechas/recuentos reportados, corrección de alcance app/reference, límites PIT/derechos y separación de tooling/proxy/benchmark |
| SPEC §21 | Sólo filas de Procurement Contract, scoring, PIT y Data Sufficiency Matrix, más nota de alcance; aceptación sintética de IMP-08 atribuida al audit |
| SPEC §22 | CCR-08 conserva «10 Energy» y registra 20 MW actual; CCR-13 registra las coberturas parciales reportadas |
| SPEC §24 | Campos factuales de DEP-01/06/07/08/10; sin cierre de DEP ni alteración de los consumidores |
| SPEC §25.3 | Aplicación de los hechos a los IMPs existentes, con el resto de §25 conservado |
| Consolidation Report | Versión, fuentes históricas, CCR/DEP coherentes y §9 con estado factual/pending; sin otra arquitectura |

Power Quarterly 20 MW se incorpora por confirmación explícita de Bru, **no** por convertir «10 Energy» ni inferir su unidad. El antecedente contradictorio continúa visible. Faltan el vínculo a campaña, vigencia y delivery; la corrección no acredita cantidades históricas uniformes.

## 4. Comprobaciones realizadas

- Hashes de ambas baselines comparados con v1.1: coinciden.
- Copias de baselines, Patch Report histórico y audit MD/CSV idénticas byte a byte a sus adjuntos.
- Las secciones principales modificadas de SPEC son exactamente: 0, 4, 6, 21, 22, 24, 25.
- Las restantes **20 secciones principales** permanecen literalmente iguales.
- Texto completo de **§25.1 y §25.2**, incluidos objetivos, matrices y gates internos, idéntico a v1.1.
- **29 filas IMP** de objetivos y **29 filas IMP** de dependencias conservadas exactamente.
- **21 filas SUP** preservadas; sin reapertura de P1–P7 ni D1–D5.
- Tablas de cantidades e inventario idénticas en SPEC e informe; CCR-08/13 y actualizaciones DEP coinciden.
- Encabezados principales 0–26 preservados; fences Markdown balanceados; UTF-8 válido.
- Diffs exactos de ambos documentos incluidos en `changes/`.

Son verificaciones de edición/integridad, no tests del producto, auditoría nueva de filas EEX ni aceptación independiente del sistema.

## 5. Escritura documental en Paperclip

| Campo | Resultado observado |
|---|---|
| Acción | `office_issue_update` |
| Issue | LAT-91, ID `9a134853-ded2-4aa9-8b48-fa19cd2eafd3` |
| Action ID | `office-admin-7da9d984ae124fb78165` |
| Resultado | `accepted=true`, `status=succeeded` |
| Fecha del issue tras escritura | `2026-09-22T15:46:03.282Z` |
| Verificación | `office_issue_get` posterior devolvió la nota y el mismo updatedAt |
| Único campo enviado para edición | `description` |
| Contexto anterior | Conservado tras la nota fechada; path/hash v1.1 instalado intactos |
| Estados/asignación/dependencias | No se solicitaron cambios; backlog y sin assignee permanecieron en el read-back |

La escritura no crea un nuevo ticket, no despierta explícitamente agentes, no acepta trabajo y no migra la SPEC del servidor. El paquete descargable y la descripción del proyecto son superficies diferentes.

## 6. Integración pendiente de los archivos canónicos

La herramienta Office de esta conversación ofrece edición de descripciones, pero no escritura arbitraria de archivos ni despliegue de la SPEC. Por tanto, esta entrega no afirma haber reemplazado `/Users/brunillo/Documents/energy_markets/canonical engineering documents/` o `/srv/hot-data/energy-markets/app/docs/canonical/`.

Al integrar los archivos mediante un operador con acceso al sistema, comparar primero los hashes actuales con las baselines de este paquete y reconciliar cualquier edición concurrente. Conservar los receipts y hashes anteriores. No hacer un reemplazo masivo de hashes, borrar resultados, reabrir IMPs aceptados ni alterar gates sólo por el número 1.1.1. La información factual ya publicada en LAT-91 puede consultarse sin simular un despliegue inexistente.
