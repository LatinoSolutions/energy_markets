# Owner Patch: volúmenes, hora de compra y fase exploratoria

- Patch ID: `EM-SPEC-OWNER-PATCH-2026-09-24-02`
- Fecha: 2026-09-24
- Autoridad: Bru (strategist del proyecto)
- Baseline: `PROCUREMENT_RESEARCH_CANONICAL_ENGINEERING_SPEC_v1_1_1.md` y su Consolidation Report.
- Estado: CANONICAL / ACTIVE. Donde contradiga a la SPEC, manda este patch.

## 1. Volúmenes por misión (sustituye §4.1, U-BRU 2026-09-22, CCR-08 y DEP-01 en lo que toca a cantidades)

| Misión | Gas | Power |
|---|---|---|
| Quarterly | 60 MW | 10 MW |
| Monthly | 10 MW | 10 MW |

- Power Quarterly es **10 MW**. El valor 20 MW registrado el 2026-09-22 queda superado.
- Fuente: Bru, 2026-09-24. No se vuelve a preguntar.

## 2. Hora de compra: data-driven, no las 11:00

- Las 11:00 son la práctica histórica del cliente, no una regla de la estrategia. El cliente no justificó esa hora.
- La hora y las ventanas de ejecución son una variable de investigación desde el primer experimento.
  Sustituye la exclusión "optimización de hora intradía" de §3 (tabla de alcance, "Fuera del primer experimento")
  y adelanta a la fase exploratoria lo que IMP-21/Q07 reservaba a un protocolo posterior.
- Las 11:00 Europe/Berlin se conservan solo como **baseline de la práctica del cliente** (brazo A0), para medir
  si una estrategia compra más barato que él.
- Cualquier hora elegida tiene que salir de la data (perfil de precio/liquidez por hora, repetible entre episodios),
  con la ejecución causal: fill solo contra un ask real existente en ese momento.

## 3. Objetivo

Comprar el volumen de cada misión al precio más bajo posible, medido contra la práctica del cliente y contra el
benchmark. "Buy the dip" con disciplina de fill conservadora: sin fills fantasma, sin look-ahead, pagando el ask.

## 4. Fase exploratoria de backtest (mientras llega la data histórica del cliente)

- Se autoriza correr backtests sobre la data de best ask existente en el lago EEX (2025-08-12 a 2026-07-28):
  Gas Quarterly con entrega 2026-01, 2026-04 y 2026-07 (completos) y Gas Monthly con entrega 2025-10 a 2026-07 (completos).
- Los resultados se etiquetan **EXPLORATORY**: sirven para validar el approach y la UI, no son evidencia final.
- La reserva OOS de §13.8 (últimas 8 Gas Quarterly) no se sella con esta población. Cuando el cliente entregue
  top-of-book histórico, la reserva formal se aplica sobre la población completa antes de cualquier resultado final.
  Los episodios usados en la fase exploratoria quedan registrados para que no se presenten después como OOS limpio.
- Monthly entra al alcance exploratorio. Power entra cuando se audite su data (POWER/DE existe en el lago).

## 5. Estado de la SPEC

La SPEC v1.1.1 se escribió en fase de hipótesis. Donde una regla suya impida resolver el problema de comprar
más barato, se decide con el owner y se registra como patch; la disciplina anti-ilusión (PIT, fills causales,
costes, separación in-sample/OOS) no se relaja.
