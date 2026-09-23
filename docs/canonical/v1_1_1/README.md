# Energy Markets — documentación actualizada

**22 de septiembre de 2026 · revisión documental 1.1.1**

## Qué cambió

| Producto | Mission | Cantidad confirmada | Unidad | Fuente actual |
|---|---|---:|---|---|
| Gas | Monthly | 10 | MW | Confirmación de Bru, 2026-09-22 |
| Power | Monthly | 10 | MW | Confirmación de Bru, 2026-09-22 |
| Gas | Quarterly | 60 | MW | Confirmación de Bru, 2026-09-22 |
| Power | Quarterly | 20 | MW | Confirmación de Bru, 2026-09-22 |

Las cuatro cantidades se incorporaron a la SPEC. «10 Energy» queda como antecedente histórico contradictorio, no como cantidad vigente de Power Quarterly. El lago `/srv/hot-data/EEX` se registra como dato existente según el audit: no se confunde su ubicación fuera del workspace con ausencia de datos. Contrato/campaña, calendario, delivery, ownership, residual, ejecución, costes y validaciones pendientes siguen identificados; no se finge un desbloqueo económico.

## Archivos de uso

- [PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1_1.md](PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1_1.md): SPEC completa actualizada; el implementation plan permanece en §25.
- [PROCUREMENT_RESEARCH_CANONICAL_CONSOLIDATION_REPORT_v1_1_1.md](PROCUREMENT_RESEARCH_CANONICAL_CONSOLIDATION_REPORT_v1_1_1.md): informe completo, coherente con la SPEC actualizada.
- [PROCUREMENT_RESEARCH_v1_1_to_v1_1_1_PATCH_REPORT.md](PROCUREMENT_RESEARCH_v1_1_to_v1_1_1_PATCH_REPORT.md): cambios, fuentes, hashes, verificaciones y límite de integración.

`sources/` conserva el audit recibido; `baselines/` las versiones originales; `changes/` los diffs. `SHA256SUMS` permite comprobar la integridad del paquete. No hay otro plan ni un nuevo ticket de arquitectura.

## Qué quedó publicado y qué no

**Paperclip:** descripción de LAT-91 actualizada y comprobada mediante lectura independiente (acción `office-admin-7da9d984ae124fb78165`).

**Archivos canónicos de Mac/BruNode:** no reemplazados desde esta conversación. Los documentos 1.1.1 están en este paquete; la referencia activa v1.1 del servidor no se cambió. No se concedió DATA_READY, research PASS, aceptación de IMP ni autorización real.
