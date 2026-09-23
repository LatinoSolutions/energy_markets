# ST-28.1 — etapa 2: changes_requested

Command / Tech Lead, revisión independiente de ejecución. Se leyeron el packet completo, executionPolicy/executionState, checkpoint y las tres rondas de stage 1. Stage 1 está aprobado; stage 2 sigue sujeto a esta decisión.

## Hallazgo bloqueante CMD-1 — reutilización de identidad evaluada

`src/role-evaluation/registry.mjs:330` compara `newVersion` sólo con la versión vigente. No detecta una identidad ya presente en el historial. Probe independiente, fixtures sintéticas:

1. Registrar componente/rol/protocolo en v1 y registrar REJECT.
2. Crear v2 y registrar HOLD.
3. Crear de nuevo v1, con el mismo protocolId y protocolVersion.
4. Readiness y ADMIT vuelven a aceptarse; `evaluateIntegration().eligible` es true.

Se reproduce tanto con semver como con content-hash. El historial conserva REJECT y ADMIT con la misma identidad completa; preservar el registro antiguo no impide la readmisión de esa identidad. No se ejecutó integración ni se concedió autoridad productiva.

Incumple criterios 1 y 5 del packet y §25.2.1: una nueva versión/experimento no puede ser la misma identidad evaluada vuelta a habilitar. No es una contradicción de SPEC.

Reproducir: `/opt/node/bin/node operations/audit/IMP-28/command-version-reuse-probe.mjs`. Resultado actual: exit 1, dos casos fallan. Expected: ambas reutilizaciones rechazadas sin alterar current/history/outcomes ni elegibilidad; identidades nuevas legítimas continúan funcionando.

## Decisión de Command ante la tercera devolución

Escalada atendida aquí por Command. Corrección técnica acotada en el mismo packet y los mismos allowed_paths: comprobar la identidad componente/rol/version/protocolo contra todo el historial antes de registrar una nueva evaluación; cubrir semver y content-hash, no sólo la versión vigente. Conservar todos los outcomes/evidencias anteriores. Añadir regresión, ejecutar suites exigidas y probe, actualizar receipt/checkpoint/manifiesto y adjuntar entregables actualizados. Autor: returnAssignee nativo `2f30b8dd-306b-4735-a135-f8d3127c8c0e`. Conservar la política de review Opus → Tech Lead y usar exclusivamente sus transiciones nativas para la remediación. Esta decisión resuelve la escalada del límite de rondas; no es una aprobación ni un reinicio informal de la review.

R3-E (congelación de objetos del llamante) conserva su clasificación no bloqueante: no es causa de esta devolución ni una nueva tarea obligatoria. No se reabren las correcciones R1/R2 ya verificadas.

## Verificación propia

- Host/cwd: brunode, /srv/hot-data/energy-markets/app.
- SPEC, receipt IMP-01 y baseline: hashes exactos del packet.
- Role evaluation: 36/36, exit 0; contratos aceptados: 67/67, exit 0.
- Receipt y linkage: ok=true, exit 0.
- Manifiesto del autor: 30/30 hashes coinciden. Todos los hashes de evidencia del IMP-01 aceptado coinciden.
- Probe CMD-1: exit 1, fallo reproducido en ambos tipos de versión.
- Verificación limitada al snapshot y evidencia disponible; un manifiesto limitado al write set no demuestra por sí solo ausencia histórica de cualquier escritura externa en workspace compartido.

Sólo se escribieron evidencia/probe de review en operations/audit/IMP-28 y documentos/artefactos de este issue. Código de producción, recibos previos, SPEC y superficies compartidas preservados.

## Alcance

No ST accepted; no IMP_RECEIPT ni aceptación de IMP-28. DEP-28 factual y admisiones reales siguen abiertos. El padre [LAT-113](/LAT/issues/LAT-113) queda sujeto a su gate nativo separado. La siguiente acción pertenece al autor mediante returnAssignee, no a una sesión de supervisión de Command.
