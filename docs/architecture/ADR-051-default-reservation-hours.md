# ADR-051 — Horario por defecto al reservar y Cotizador siempre visible

- **Estado:** **`PROPUESTO`** el 2026-10-18 — **pendiente de aprobación del equipo** (`HB-001` §11–12). Pedido por el
  propietario tras probar una reserva en un lugar real importado (`ADR-043`): decía que no había horarios.
- **Relacionado:** `ADR-040` fases 8–10 (reservas, horario, cotizador), `ADR-043` (lugares importados de OSM).

## 1. Problema

1. Un lugar con reservas activadas pero **sin horario semanal cargado** respondía `slots: []`, así que nadie podía
   reservar. Casi todos los lugares importados están en ese caso (OSM no trae horarios fiables).
2. El Cotizador se **ocultaba** si el lugar no tenía lista de precios, así que parecía que la función no existía.

## 2. Decisión

| Tema | Decisión |
|---|---|
| **Horario por defecto** | Sin horario semanal cargado, `availability` ofrece **todos los días de 10:00 a 21:00, cada 30 min** (`default_hours: true`). Con horario cargado todo sigue igual (cuartos de hora dentro de sus tramos, `default_hours: false`). Los cierres puntuales siguen aplicando. |
| **Honestidad** | La app avisa «Este lugar no publicó su horario…». La reserva sigue siendo una **solicitud** que el lugar confirma o rechaza; crear una reserva sin horario cargado ya no restringía por hora (`ADR-040` fase 9), así que no hay cambio de reglas al enviar. |
| **Cotizador** | La sección se muestra siempre; sin lista de precios dice que el lugar aún no la publicó. Pedir cotización sigue exigiendo que el lugar la cargue. |

## 3. Qué NO hace

- No inventa un horario real: es una propuesta genérica. El lugar puede cargar el suyo desde «Administrar mi negocio».
- No cambia cupos, aforo ni la exigencia de lugar verificado en cotizaciones/reservas donde ya existía.
- Cotizar a un lugar sin lista de precios sigue sin ser posible: depende de que el negocio cargue artículos.

## 4. Verificación

`tests/places/test_place_schedule.py` (44 pruebas): sin horario → 22 horarios de 10:00 a 20:30 con `default_hours: true`;
con horario → `default_hours: false` y cierres puntuales intactos.
