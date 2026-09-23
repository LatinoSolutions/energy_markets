# IMP-04 · Decisión del owner P-005 — derecho de uso de datos EEX

Fuente: pizarrón de la Oficina, `/srv/hot-data/oficina-data/pizarron.json`,
registro `P-005` (tarea IMP-04, work `energy-markets-IMP-04-20260923-100941-openrouter`),
`estado: resuelta`, `accion: responder`, `resuelta: 2026-09-23T13:22:22.031Z`.
Se copia literal; no se añade ni se presume ningún documento contractual.

## Pregunta

> ¿Qué documentación acredita el derecho de uso de los datos EEX y cuál es la
> fuente oficial de settlement autorizada para IMP-05?

## Respuesta de Bru (literal)

> DECISIÓN DE BRU — IMP-04 / EEX RIGHTS
>
> Sí: los datos EEX disponibles para Energy Markets están autorizados para este
> uso dentro del proyecto. Tratar el human gate de derecho de uso como RESUELTO
> y continuar con la ingeniería de IMP-04/IMP-05.
>
> Importante:
> - Esta respuesta confirma la autorización de uso; NO inventar ni asumir un
>   documento contractual específico que Bru no haya indicado.
> - La fuente oficial concreta de settlement no fue especificada por Bru en esta
>   decisión. Debe determinarse primero desde SPEC, implementation plan, audits,
>   receipts, configuración y fuentes canónicas accesibles.
> - Todo lo demás que quede en IMP-04 (inspección de schemas/capabilities,
>   top-of-book, cálculo de medias/proxy, decisión reuse/extend/build y tests)
>   es trabajo técnico y debe resolverse entre agentes sin volver a poner a Bru
>   en medio.
> - Si, después de agotar las fuentes canónicas y la escalación técnica
>   interna, sigue faltando exclusivamente un hecho externo que sólo Bru/cliente
>   pueda aportar —por ejemplo, el nombre exacto de una fuente settlement
>   autorizada que no esté documentada— entonces crear UNA pregunta humana
>   concreta por ese único dato.
>
> Aplicar además la política ya establecida: un atasco técnico no es por sí
> mismo un human gate.

## Alcance aplicado en IMP-04

- Autoriza el uso, dentro del proyecto, de los datos EEX disponibles: el lago
  `/srv/hot-data/EEX` (raíces `eex_derivative_trade` y
  `eex_derivative_top_of_book`, SPEC v1.1.1 §6.5). `usageRights.status` pasa a
  `permitted` para el lector EEX y su entorno de lectura, con este archivo como
  evidencia.
- No acredita una fuente oficial de settlement: el lago no contiene settlement
  (sólo esas dos tablas) y ninguna fuente canónica la nombra (búsqueda en
  `operations/audit/IMP-04/DEP-10-real-tooling-assessment.md`, sección
  «Fuente oficial de settlement»).
- No acredita DATA_READY, PIT, calendario contractual ni vínculo al mandato
  (§6.5: «La presencia de archivos no acredita derechos/entitlements,
  calendario contractual ni compras del cliente»; esos puntos siguen en
  DEP-06/07).
