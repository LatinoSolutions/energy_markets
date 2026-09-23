# Continuity checkpoint — LAT-224 / IMP-03 / ST-03.3 (EEX THE temporal, provenance, permissions)

- **Packet id:** `WP-IMP-03-ST-3-v1.1`
- **Subtask / Parent / Native root:** `ST-03.3` / `IMP-03` / `LAT-91`
- **Project:** Energy Markets `96bbd5b1-94da-4781-8c2b-455fdfb28d1a`
- **Instance:** `EEX THE trade and top-of-book factual audit 20260921`, instanceVersion `1`
- **SPEC:** v1.1, SHA256 `86c4bd4eeb5f9d0ebad94763128b221eb64525a2b7fff1007dab0af88b39cb6c`
- **Worker route:** DeepSeek V4.1 Flash via OpenRouter, adapter opencode_local, agent `2f30b8dd-306b-4735-a135-f8d3127c8c0e`, run `056cd012-4784-4fd3-8886-0fd0eced0af5` (manual bounded product continuation after Go provider-region rejection)
- **Updated:** 2026-09-22

## Criterios de aceptación originales
1. Cada conclusión positiva/negativa registra scope inspeccionado, locator/command y evidencia observada; census vs sample distinguidos; auditoría aceptada previa intacta; sin cobertura global no soportada.
2. Contribución a la matriz con los ocho campos §6.3 por requisito; IDs existentes; sin campaña/mandato inventado ni DATA_READY con crítico faltante; readiness final requiere reconciliación de ambas contribuciones.
3. Manifest temporal distingue las cuatro semánticas, lineage/revisiones, timezone/DST y límites de evidencia. Ausencia de disponibilidad contemporánea permanece unavailable para replay. Derechos desconocidos sin evidencia.
4. ST_RECEIPT de quince campos §20.2.8 con instancia nueva, ruta worker/modelo/run real, baseline, hashes, inputs, artefactos, resultado, tests/resultados, evidencia, supuestos, desviaciones, dependencias, fallos/reintentos, recomendación in_review; hashes aceptados inalterados.
5. Review nativa independiente Sol HIGH (`0af74a08-…`), not_creator, máximo 3 rondas; evidencia inspeccionable sin secretos ni bulk data.

## Estado actual
Trabajo de autor **completo y corregido** tras la ronda 1 de review. Pendiente revisión independiente. `recommendedStatus = in_review`.

## Acciones completadas
- Verificado hostname `brunode`, cwd `/srv/hot-data/energy-markets/app`, rama `main`, proyecto y SPEC.
- Re-hasheado entrada: SPEC `86c4bd4e…`, IMP-01 receipt `78d92de8…`, IMP-03 receipt previo `e203580b…`, matriz ST-03.1 `5e94b60b…`, manifest temporal previo `6b630e9e…`, doc de referencia `dfa9cfc8…` — todos coinciden.
- Enumeradas particiones (solo listado) y leída una muestra determinista acotada de las dos tablas, solo `cmdty=NATGAS/area=THE`, más las fechas sonda de DST.
- Distinguidas las cuatro semánticas §6.1 para R-01…R-17; observado occurred/reference (`Tm` UTC Z, `TrdDate`), ausente publicación/policy-consumable, revision/version parcial.
- Capturadas summaries acotadas no-raw de `Px/BidPx/AskPx`, unidades e instrumentos por fichero (locator + sha256) en `provenance.sampleEvidenceDigest`.
- Buscada evidencia de permisos solo en documentación suministrada y metadata no secreta; conclusión `UNKNOWN` con ausencia acotada.
- Verificados los metadatos de extracción (`_scripts/extract-eex.sh`, `_logs/{extract-status.tsv,extract.complete,final-size.txt}`) como prueba de posesión presente, no de disponibilidad histórica.

### Correcciones de la ronda 1
- **R-04:** deja de declararse `AVAILABLE NOW`; ahora `UNAVAILABLE` con evidencia parcial observada (el requisito completo exige contrato Quarterly exacto y fronteras de decisión elegibles; la muestra mezcla buckets/madureces). Movida a `partialEvidence`; `criticalMissing` la incluye.
- **Evidencia positiva capturada:** el generador lee y resume `Px/BidPx/AskPx`, `UOM/Currency`, ISIN/Maturity/ShortCode/DisplayName y buckets por fichero, atado a locator+sha256; el verificador falla si esos campos/valores desaparecen, y `--check` re-lee la lake y compara.
- **Baseline Git corregido:** es un repo Git en `main` con HEAD no nacido (sin commits, sin remote); se conserva el baseline content-hash y se registra el estado real.
- **Inputs:** ST-03.2 se retira de `inputsUsed`; queda solo como locator de reconciliación futura en `dependencyFindings`.

## Ficheros cambiados (todos dentro de allowed_paths)
`operations/audit/IMP-03/EEX-THE-20260921/ST-03.3/`:
`audit_eex_the_temporal.py`, `temporal-manifest.json`, `provenance-permissions.json`, `matrix-contribution.json`, `audit-report.md`, `verify-eex-the-temporal.mjs`, `verification-output.txt`, `continuity-checkpoint.md`, `ST_RECEIPT.json`, `SHA256SUMS`.

## Comandos y tests ejecutados (con resultado)
- `/srv/hot-data/alexandria/venvs/data/bin/python3 audit_eex_the_temporal.py` → exit 0; trade 1464 particiones (2020-11-02..2026-07-28), top-of-book 257 (2025-07-25..2026-07-28); escritos los tres JSON.
- `/srv/hot-data/alexandria/venvs/data/bin/python3 audit_eex_the_temporal.py --check` → exit 0; `errors: []` (incluye summaries de precio/unidad/instrumento).
- `node verify-eex-the-temporal.mjs` → exit 0; PASS (ver `verification-output.txt`).
Salida real en `verification-output.txt`.

## Resumen del diff
Instancia nueva bajo `ST-03.3/`; no se tocó la lake, el reader app, la SPEC, receipts/matrices aceptados, ni el write set de ST-03.2. No hay commits, branches ni worktrees. Ronda 1: R-04, evidencia capturada, baseline Git, inputs.

## Pendientes
- Review independiente Sol HIGH (agente `0af74a08-cb39-4cf5-a94f-117b242ea08c`), not_creator.
- Reconciliación Command de las contribuciones ST-03.2 + ST-03.3 con la matriz ST-03.1 aceptada.

## Blocker
Ninguno técnico. No hay `no_guess` abierta ni contradicción de SPEC.

## Siguiente acción exacta
Independent Reviewer revisa `operations/audit/IMP-03/EEX-THE-20260921/ST-03.3/**` y devuelve approve o changes_requested. Si approve, Command reconcilia con ST-03.2 y ST-03.1.

## Supuestos
- El venv de datos de Alexandria es lector admisible en solo lectura; no se instaló nada.
- El muestreo por índices fijos es representativo para los hechos temporales/provenance observados, siempre etiquetados sample-only.
- El reader app es auxiliar y no autoritativo para semántica de vendor ni timezone.

## ¿Requiere decisión de arquitectura?
No.

## Estado de la revisión
Ronda 1: `changes_requested`, atendida. Reenviado a review.
