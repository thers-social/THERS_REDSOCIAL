# ADR-044 — Respaldo del proveedor de rutas

- **Estado:** **`PROPUESTO`** el 2026-10-17 — pendiente de aprobación del equipo (`HB-001` §11–12). Pedido por el
  propietario tras una caída de OpenRouteService; está **apagado salvo que se configure** `ROUTING_FALLBACK_PROVIDER`.
- **Relacionado:** `ADR-040-thers-places.md` §29–30 (rutas y navegación), D2 (privacidad del origen), `API_CONTRACT.md`.

## Contexto

«Cómo llegar» dependía solo de OpenRouteService (ORS). El 2026-10-17 sus cálculos de ruta se quedaron sin
responder (a pie, en bici y, a ratos, en carro) aunque la clave era válida, y la app mostraba «Las rutas no
están disponibles ahora». Cambiar la clave no lo arregló: era del servicio.

## Decisión

1. Se añade un **proveedor de respaldo** con el enrutador público de OpenStreetMap de FOSSGIS
   (`routing.openstreetmap.de`, OSRM; `routed-foot`, `routed-bike` y `routed-car`). No necesita clave.
2. Se activa con `ROUTING_FALLBACK_PROVIDER=osrm`. `FallbackProvider` usa el principal y, si lanza
   `RoutingUnavailableError`, el respaldo. «No hay ruta» no se oculta (es una respuesta válida).
3. Tras un fallo, el principal descansa **120 s**: mientras esté caído nadie espera su tiempo de espera completo
   (8 s) en cada ruta. Si el respaldo también falla durante el descanso, se le da un último intento al principal.
4. OSRM no entrega el texto de las indicaciones: se escribe en `infrastructure/routing/osrm.py` (español e inglés) con
   los tipos de maniobra de ORS, de modo que web y app no distinguen el origen. Si las indicaciones no cuadran con la
   línea, se devuelven vacías y la ruta sigue valiendo.
5. Sin clave de ORS pero con respaldo configurado, «Cómo llegar» funciona solo con el respaldo.

## Privacidad

El origen **redondeado** (~110 m, o ~11 m en la navegación en vivo) también llega al enrutador de FOSSGIS cuando
se usa el respaldo; no se guarda ni se registra. El aviso de la pantalla de ruta lo dice («o, si este no responde, al
enrutador público de OpenStreetMap») y la atribución nombra ambos orígenes. **Hay que añadirlo a la política de
privacidad** (pendiente, igual que el de ORS en `ADR-040` §29).

## Riesgos

1. Es un servicio **gratuito y sin garantías**, con política de uso razonable: no sustituye a un plan contratado ni a
   un enrutador propio. El tope diario (`ROUTING_DAILY_BUDGET`) y la caché de 1 h también lo protegen.
2. Las rutas de los dos proveedores pueden diferir (distinto tiempo estimado a pie, otras calles).
3. El respaldo no se prueba contra el servicio real en la suite automática (usa respuestas simuladas); se verificó a
   mano contra el servidor público el 2026-10-17.
