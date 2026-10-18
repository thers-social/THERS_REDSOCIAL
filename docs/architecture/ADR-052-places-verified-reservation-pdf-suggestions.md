# ADR-052 — Lugares importados como verificados, PDF de la reserva y panel de sugerencias

- **Estado:** **`PROPUESTO`** el 2026-10-18 — **pendiente de aprobación del equipo** (`HB-001` §11–12). Pedido por el
  propietario.
- **Relacionado:** `ADR-040` (THERS Places), `ADR-043` (importación de OpenStreetMap), `ADR-051` (horario por defecto),
  `ADR-049`/`ADR-050` (perfil, seguidores).

## 1. Decisión

| Tema | Decisión |
|---|---|
| **Lugares verificados** | Los lugares importados de OpenStreetMap entran como `verified` (antes `unverified`, con la etiqueta «Sin verificar») y los ya importados se pasaron a `verified` en la base de desarrollo. El importador solo actualiza un lugar `osm` mientras ninguna persona lo haya verificado (`verified_by_user_id IS NULL`). |
| **PDF de la reserva** | `GET /api/reservations/<id>/pdf`: comprobante (lugar, a nombre de, día, hora, personas, estado, notas) de una reserva **propia**; cualquier otra persona, incluida quien gestiona el lugar, recibe `404`. Una reserva no tiene importes, así que no es una cotización con precios: dice explícitamente que no es factura ni cobro. Mismo generador de PDF sin dependencias que la cotización. |
| **Sugerencias en el perfil** | El ícono de «agregar persona» del perfil abre una barra horizontal de cuentas sugeridas (foto, nombre, Seguir, ✕ para descartar, toque para ver el perfil). `GET /api/users/suggestions` gana `avatar_url` y un `limit` opcional (1–20). |

## 2. Riesgos y qué NO hace

- **«Verificado» ya no distingue nada.** Ahora una ficha importada y sin revisar luce igual que una revisada por el
  equipo; los datos de OpenStreetMap pueden estar desactualizados (cerrado, mal ubicado). Además `verified` es lo que
  habilita reservas y cotizaciones, que antes exigían revisión. Si más adelante se quiere distinguir, haría falta un
  estado o una marca nueva (el valor `unverified` y su etiqueta siguen existiendo en el código).
- Solo se cambió la base de desarrollo; en otro entorno hay que repetir el `UPDATE` o volver a ejecutar el importador.
- El PDF de la reserva no incluye precios ni la cotización del lugar; un descarte de sugerencia no se guarda en el servidor.

## 3. Verificación

`tests/places/test_place_reservations.py` (37, incluida la del PDF y su `404` a terceros) y
`tests/test_content_preferences.py` (33, forma de la sugerencia con `avatar_url` y `limit`).
