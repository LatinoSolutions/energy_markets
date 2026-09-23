# ST-28.1 — etapa 2, revisión delta: changes_requested

CMD-1 está resuelto. Probe original conservado sin modificaciones, ejecutado por Command: exit 0, reutilización de identidad rechazada con semver y content-hash. El delta de producción añade únicamente el guard de historial en registry.mjs; el delta de tests añade su regresión. La etapa 1 permanece completed; la ejecución nativa ha devuelto esta remediación a la etapa 2, como prescribe executionPolicy.

## CMD-2 — protocolId omitido al deduplicar hallazgos previos

La identidad completa distingue protocolId; la clave de dedup de priorFindings no lo incluye. En createNewEvaluationVersion usa componentVersion + protocolVersion + value. Esto pierde un hallazgo cuando dos protocolos distintos tienen las otras partes iguales.

Reproducción sintética, tanto semver como content-hash:

1. Componente/rol en v1/P1/protocolVersion=1.0.0 registra REJECT.
2. Se crea v2/P1 y después v1/P2 con cambio de protocolo explícito (otra identidad completa, admitida por el guard corregido).
3. v1/P2/protocolVersion=1.0.0 registra REJECT. priorFindings contiene ambos.
4. Crear v3/P2 reduce priorFindings de 2 a 1: sólo queda P1. outcomeHistory conserva P1 y P2.

No se afirma pérdida del historial íntegro, mutación de registros anteriores ni autoridad productiva. El fallo es la omisión de un REJECT en la superficie de hallazgos previos, análoga al R2-B ya corregido para content-hash, ahora por omitir el identificador de protocolo. Incumple identidad exacta y preservación de hallazgos, criterios 1/5, §§11.6.4/25.2.1.

Probe: `/opt/node/bin/node operations/audit/IMP-28/command-protocol-identity-probe.mjs`; actual exit 1, dos casos fallan. Expected: ambos hallazgos sobreviven y el probe sale 0.

## Decisión acotada de Command

Como continuación de la escalada ya atendida por Command: devolver mediante changes_requested al returnAssignee nativo `2f30b8dd-306b-4735-a135-f8d3127c8c0e`. Corregir la clave con la identidad completa relevante, incluyendo protocolId, usando serialización sin colisiones por delimitadores; conservar dedup de la misma entrada duplicada entre priorFindings/outcomeHistory. Añadir regresión con ambos formatos y protocolos distintos, ejecutar ambos probes de Command y las suites exigidas. Actualizar receipt/checkpoint/manifiesto y entregar snapshot vigente. Mismos allowed_paths, sin cambiar SPEC, routing, reviewer ni estados a mano. No reabrir CMD-1 ni R1/R2 corregidos. R3-E sigue siendo observación no bloqueante.

Esta review tardía detecta el caso adicional; la responsabilidad de no haber agrupado antes esta variante de protocolo corresponde a Command. Es un defecto reproducible del contrato vigente, no una nueva exigencia arquitectónica ni motivo de aprobación humana.

## Evidencia propia

Host/cwd correctos. Suites: 37/37 y 67/67, exit 0. Receipt/linkage válidos. CMD-1: exit 0. CMD-2: exit 1. SPEC/IMP-01/baseline exactos; evidencia aceptada de IMP-01 sin discrepancias. Manifiesto: 46/46 hashes coinciden. Hash de los diez archivos source/test reproducido: `86a81af4a11e0bb919969bb0c767a0041630ea72a16d957d874d299b5936555e`; fórmula: sha256 de líneas ordenadas `path + espacio + sha256 + newline`. La comprobación inicial con formato sha256sum dio otro hash por serialización; no fue drift de contenido.

Scope: sólo review y evidencia sintética. No ST accepted, no IMP_RECEIPT ni aceptación del padre [LAT-113](/LAT/issues/LAT-113), ninguna admisión real ni cierre DEP-28. Preservados producción, recibos previos y superficies compartidas. No vigilancia continua; la siguiente acción pertenece al autor nativo.
