# Owner Patch: modo TRADES, zonas de evidencia y alcance Gas + Power

- Patch ID: `EM-SPEC-OWNER-PATCH-2026-09-25-03`
- Fecha: 2026-09-25
- Autoridad: Bru (strategist del proyecto)
- Baseline: `PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1_1.md`, `EM-SPEC-OWNER-PATCH-2026-09-24-02`.
- Estado: CANONICAL / ACTIVE. Donde contradiga a la SPEC, al patch 02 o al paquete del cliente, manda este patch.
- Momento del cambio: escrito ANTES de inspeccionar cualquier resultado de estrategia en modo TRADES. Ningún run TRADES existe a esta fecha.

## 0. Por qué existe

La SPEC (§5.7, §13.3, §13.7, §13.8) y el patch 02 §4 se escribieron sin conocer la cobertura real de la data:

- Top of book (TOB) con serie intradía usable existe solo desde 2025-08-12 (patch 02 §4); entre 2025-07-25 y 2025-08-11 hay 1 archivo y entre 8 y 14 filas por día, insuficiente para slots.
- El cliente confirma el 25-sep: "We don't have any top of book data before July 2025. Only trades. The exchange limits the history lookback." Sustituye la afirmación de `02_execution_costs/execution_and_costs.md:44` del paquete del cliente (TOB histórico disponible).
- Trades existen desde 2020-11-02 (particiones del lago `/srv/hot-data/EEX/table=eex_derivative_trade`, NATGAS/THE y POWER/DE).
- Medición preliminar del 25-sep (hecha fuera del repo; TR-01 la reproduce como artefacto): Gas Quarterly front sin ningún trade el 58 % de los días en 2021, 32 % en 2022, 16 % en 2023, 10,5 % en 2024, 4,7 % en 2025; Power DE con <= 3,3 % de días sin trades en Q y M hasta 3 meses de distancia desde 2021; filas duplicadas entre pulls: 21 % gas, 32 % power.

La reserva OOS "cuando el cliente entregue top-of-book histórico" (patch 02 §4) no se puede cumplir: ese TOB no existe. Este patch redefine la metodología con la data real. La disciplina anti-ilusión (PIT, fills causales, costes, separación in-sample/OOS) no se relaja.

## 1. Sustituciones explícitas

| Norma sustituida | Nueva regla |
|---|---|
| SPEC §13.8 (8 Gas Q, >= 2 años, "menos de 8 = HOLD"), §13.7 (estándar de PASS de 8 quarters) y §5.7 (24 meses OOS Monthly) | OOS histórico de §4 de este patch (4 Gas Q + campaigns de otras misiones dentro del mismo intervalo). Consecuencia declarada: con este OOS no se puede emitir el research PASS de P3; el OOS histórico es un filtro. El PASS requiere además el forward (§4) con el estándar de n que se fije al abrirlo. |
| SPEC §13.3 (población: exclusivamente Gas Quarterly; Monthly y Power no entran) | Entran las 4 misiones. Cada misión se evalúa por separado; nunca se mezclan misiones ni mercados para completar mínimos (SPEC línea 1464 y DEP-12 siguen vigentes). |
| Reserva IMP-09 (`operations/audit/IMP-09/eex-quarterly-register-eval.json`, HOLD, 3 elegibles, cutoff 2026-07-28) y `src/oos-reservation/reservation.mjs:34-35` (8 campaigns, 2 años, solo Quarterly) | La reserva IMP-09 y su HOLD quedan intactas como registro histórico. Se autoriza una función de reserva nueva y versionada en `src/oos-reservation/` para las zonas de §4 y las 4 misiones, sin modificar `reserveSealedOos`. El registro de accesos reutiliza `recordOosAccess` (`reservation.mjs:478`) con propósitos de acceso propios de TRADES. |
| Paquete del cliente, backtest start Q1 2021 / Dec 2020 (`campaign_rules.csv`) | Development empieza en la primera campaign con ventana completa dentro de la data. Gas Q y Power Q: `2021Q2` (`2021Q1` abre el 2020-09-01, antes del primer trade). Monthly no cambia: entrega dic-2020, ventana desde el 2020-11-02, ya dentro de la data. Desde ahí entran TODAS las campaigns, sin seleccionar por densidad; la baja cobertura queda visible como estado de data, no como exclusión. |
| Contrato de ejecución IMP-07 ("latest top-of-book best ask", `src/execution-contract/execution-contract.mjs:106`) y SPEC §13.6 regla 1 | Para el modo TRADES se crea una versión nueva del contrato de ejecución (§3). El contrato TOB vigente no cambia. |
| Patch 02 §4 "Power entra cuando se audite su data" | Power entra en este programa (§6). |

## 2. Dos modos del mismo backtest

| Modo | Observación de precio | Fill | Ask disponible |
|---|---|---|---|
| `TOB` (control = release exploratorio v2, `operations/exploratory/v2/`) | best ask vigente <= slot, antigüedad <= 15 min | ask + 0,15 EUR/MWh | 2025-08-12 .. 2026-07-28 |
| `TRADES` | último trade elegible conocido en el instante de decisión | según contrato TRADES (§3) | no aplica; trades desde 2020-11-02 |

- El control TOB es el release v2 (el que sirve la UI hoy, `BT02_CURRENT_RELEASE = "v2"`). Sus artefactos no se reescriben ni se re-corren.
- El motor TRADES vive en una ruta versionada nueva. `src/exploratory/backtest.mjs` y `comparison.mjs` no se editan: sus hashes están fijados en los manifests que la UI verifica (`src/ui/canonical-inputs.mjs:70-83`).
- La identidad de cada run lleva `market`, `mission`, `source_mode`, `observation_rule` y `zone`.
- El precio de un trade nunca se presenta como ask. El volumen negociado no es profundidad: el fill model `DEPTH` no existe en TRADES.

## 3. Reglas de TRADES-v1

### 3.1 Trade elegible (point-in-time)
- `Simple Instrument`, `TrdType = 'Exchange'` (Trade Registration solo como variante declarada), `Px` no vacío, `VolumeOnly <> 'true'`.
- `FromBrokenSpread`: en una muestra de 1 día (2025-11-20, NATGAS/THE, 244 trades elegibles) el 64 % son `true` y todos los trades sin `AgrsrAct` (44 %) son de broken spread. La regla de inclusión decide la mayor parte de la muestra: se fija en TR-01 con medición completa y se congela en TR-04, antes de cualquier run.
- Disponibilidad = `Tm` (supuesto declarado: sin retraso de publicación).
- Un trade con `Delete` posterior deja de ser elegible solo desde el momento del Delete, nunca antes (excluirlo antes sería look-ahead). TR-01 verifica si la fila Delete lleva la hora del borrado o la del trade original; si no se puede saber, la regla se declara como supuesto.
- Deduplicación entre pulls con clave declarada en TR-01.

### 3.2 Observación (decisión de Bru, 25-sep)
- `LAST_TRADE` (principal): último trade elegible con `Tm` <= instante de decisión. Es el cierre de la vela.
- `SLOT_VWAP` (hipótesis secundaria): VWAP de los trades elegibles del slot que termina en el instante de decisión. Riesgo declarado: suma una hipótesis más sobre un OOS chico (pruebas múltiples) y en slots sin trades queda vacío.
- DIP10 conserva su lógica exacta: compara la observación de hoy con la media de las últimas 10 observaciones del episodio, con fallback a A0 si hay menos de 5 (`src/exploratory/backtest.mjs:83-91`). Declarado: con trades escasos esas 10 observaciones pueden abarcar semanas.

### 3.3 Fill
- trade observado + penalización trade->ask + 0,15 EUR/MWh de slippage, sin omitir ni contar dos veces el 0,15.
- La penalización se mide en el puente condicionada al estado de la señal (momentos en que DIP10 compraría) y al lado agresor, porque un trade "bajo" suele ser un golpe al bid (sesgo señal-fill). Los trades sin agresor forman su propio grupo con regla explícita; nunca se asignan a un lado por suposición.
- Por mercado y misión; la de Gas no se hereda a Power.

### 3.4 Calendario y data ausente
- La ventana de cada campaign sale del calendario de la misión y del calendario de negociación del mercado (gas y power por separado), nunca de la presencia de trades.
- Día de decisión sin trade elegible dentro del límite de frescura = sin observación (no se arrastra un precio indefinidamente).
- Si la obligación no puede completarse por falta de trades, la campaign queda `DATA_INCOMPLETE`, distinta del hard-reject por forcing del cliente, que sigue aplicando a la estrategia.

## 4. Zonas de evidencia

Una sola frontera temporal para todas las misiones.

| Zona | Periodo | Fuentes | Rol |
|---|---|---|---|
| Development | desde la primera ventana completa por misión (§1) hasta 2024-05-31 | TRADES | ajuste y comparación de hipótesis, walk-forward cronológico |
| OOS histórico | ventanas dentro de 2024-06-01 .. 2025-05-31 | TRADES | examen sellado; una sola apertura con la versión congelada |
| Embargo | 2025-06-01 .. 2025-08-11 | ninguna | campaigns que cruzan fronteras: purge |
| Puente | 2025-08-12 .. 2026-07-28 | TOB + TRADES | contraste TOB vs TRADES y calibración del fill; EXPLORATORY |
| Post-puente | 2026-07-29 .. freeze de TRADES-v1 | TRADES (archivo del cliente hasta 2026-09-11; TR-01 dice si trae TOB) | sin uso antes del freeze; se evalúa junto al forward con la versión congelada |
| Forward | desde el freeze de TRADES-v1 | data viva | validación en shadow, sin dinero |

- Reglas de ventana (paquete del cliente `01_shared_campaign_rules.md`): Quarterly 3-1-3 (se compra en los meses 4, 3 y 2 antes del inicio de entrega; el mes previo es hueco); Monthly 1-0-1 (mes anterior a la entrega, sin el día anterior al inicio). Aplican a Gas y Power.
- OOS Gas Quarterly: `GAS-Q-2024Q4`, `GAS-Q-2025Q1`, `GAS-Q-2025Q2`, `GAS-Q-2025Q3` (ventanas contiguas jun-2024 a may-2025). Monthly OOS: entregas 2024-07 a 2025-06 (12 campaigns por mercado). Power Q: mismas entregas que Gas Q.
- Purge declarado: `GAS-Q-2025Q4` (ventana jun-ago 2025) y las Monthly con entrega 2025-07, 2025-08 y 2025-09 (ventana 2025-08-01 a 08-28, cruza embargo y puente); lo mismo para Power.
- Fuera del puente por data: `GAS-Q-2026Q4` (ventana jun-ago 2026) y Monthly 2026-08 (ventana julio; la data del lago acaba el 2026-07-28) quedan en post-puente; lo mismo para Power.
- Cada misión se evalúa por separado en todas las zonas.
- IDs en formato canónico (`GAS-Q-2026Q1`, `src/procurement-contract/campaign-contract.mjs:183-188`), no el del runner exploratorio.
- Los episodios ya vistos por el backtest TOB exploratorio pertenecen al puente; nunca se presentan como OOS.
- Cada lectura del OOS queda en un registro de acceso append-only; un run_id nuevo sobre el OOS es una nueva apertura y se cuenta.
- La unidad de scoring sigue siendo la campaign (SPEC §5.6). Las métricas por día-decisión son diagnóstico del contraste; la incertidumbre respeta la dependencia temporal.

## 5. Riesgos de modelo declarados

1. La penalización se calibra en el puente (2025-2026) y se aplica a años anteriores: el OOS histórico evalúa la estrategia BAJO ese modelo de ejecución y no es un OOS temporal íntegro del sistema. Mitigación: grilla de sensibilidad predeclarada.
2. El puente, al servir para calibrar, no es validación independiente. Los resultados TOB del puente ya fueron vistos; el gate del puente se predeclara sabiéndolo y tiene poca potencia (3 Gas Q con TOB).
3. 4 campaigns Gas Q es un n chico.
4. El brazo HOUR elige hora por leave-one-out entre episodios (`operations/exploratory/v2/run-exploratory-backtest.mjs`, mismo bloque que la raíz `:97-118`), que usa episodios futuros. En TRADES se sustituye por walk-forward: la hora de cada episodio se elige solo con episodios de Development anteriores a él; nunca ve OOS ni puente.

## 6. Alcance: las 4 misiones

- Gas Quarterly, Gas Monthly, Power Quarterly y Power Monthly entran completas (Bru, 25-sep: "no hagamos el trabajo a la mitad"). Cada tarea TR-* cubre las 4.
- Power: producto base (`DEBQ`, `DEBM`) salvo decisión distinta de Bru; calendario de negociación de Power DE propio.
- Volúmenes: patch 02 §1 (Gas Q 60 MW, Power Q 10 MW, Gas M 10 MW, Power M 10 MW).

## 7. Lo que este patch NO cambia

- A0 (11:00 Europe/Berlin, price-blind) sigue siendo el baseline de la práctica del cliente.
- Fees siguen UNKNOWN/excluded, nunca cero. `BENCHMARK_PROVISIONAL` sigue explícito.
- El forward con TOB vivo sigue usando el contrato TOB; TRADES en forward corre en paralelo solo como registro shadow.
- La unificación DIP10 / `computeS1Features` no se abre aquí.
