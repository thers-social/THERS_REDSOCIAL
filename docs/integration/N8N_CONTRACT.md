# Contrato de integración con n8n (ADR-044 §2.8)

**Estado:** PROPUESTO, sin ratificar. n8n **no está contratado**: nada de esto envía ni recibe nada
hasta que alguien configure `N8N_*` (apagado por defecto). No hay URL, cuenta ni secreto en el código.

**Regla de oro:** n8n **avisa y escala**. Flask y PostgreSQL deciden. No existe ningún evento ni ruta
para aprobar, rechazar, sancionar, leer contenido ni escribir un estado de moderación, y hay pruebas
que lo fijan (`tests/content_moderation/test_n8n_automation.py`).

## Flask -> n8n (eventos)

Tabla `domain_events` (outbox, misma transacción que el hecho). `flask n8n-dispatch` envía lotes con
reintentos (espera creciente; tras 8 intentos queda `dead`). Un fallo de n8n **no toca** la moderación.

`POST <N8N_WEBHOOK_URL>` (solo HTTPS, o HTTP hacia localhost; sin redirecciones; 5 s):

```
Content-Type: application/json
X-Thers-Signature: t=<unix>,v1=<hex HMAC-SHA256 de "<t>." + cuerpo>   (secreto: N8N_OUTBOUND_SECRET)
{"id": "<uuid>", "type": "<tipo>", "data": { ... }}        # JSON compacto, claves ordenadas
```

n8n debe **verificar la firma** y rechazar marcas de tiempo con más de 300 s de diferencia.
Solo viajan identificadores, categorías y conteos (esquema cerrado en `domain/automation/events.py`):

| `type` | `data` |
|---|---|
| `moderation.critical_held` | `subject_type`, `subject_id`, `priority`, `reason` |
| `moderation.job_dead` | `job_id`, `subject_type`, `attempts` |
| `moderation.appeal_opened` | `appeal_id`, `subject_type` |
| `report.critical_created` | `report_id`, `target_type`, `reason` |
| `moderation.appeal_overdue`, `moderation.backlog` | conteos (los emite un barrido, aún no programado) |

## n8n -> Flask (rutas internas)

Firma con `N8N_INBOUND_SECRET` (distinto del de salida), mismo formato de encabezado, sobre el cuerpo
exacto. Firma mala, vieja o ausente = `404`. Con `N8N_ENABLED` apagado no existen.

| Ruta | Qué hace |
|---|---|
| `GET /api/internal/moderation/summary` | Solo conteos: retenidos, pendientes, críticos, trabajos fallidos/muertos, apelaciones abiertas/vencidas |
| `POST /api/internal/notices` `{"kind": "backlog"\|"appeal_overdue"\|"job_dead"}` | Envía un correo de aviso al equipo (máx. 20 por hora en total) |

## Aviso directo, sin n8n (decisión 6)

Un reporte crítico (`child_safety`) y un contenido retenido como crítico se avisan **desde Flask por
Resend** a `MODERATION_ALERT_EMAIL`, con enlace al panel (`MODERATION_PANEL_URL`) y **sin contenido ni
nombres**. Si n8n está caído o apagado, el aviso sale igual. Un fallo del correo nunca rompe el reporte.

## Flujos sugeridos para cuando se contrate n8n

1. Webhook `report.critical_created` / `moderation.critical_held` -> mensaje al canal del equipo.
2. Cron cada hora -> `GET summary` -> si `critical_held` > 0 o `held` supera el umbral -> `POST notices backlog`.
3. Cron diario -> `GET summary` -> si `appeals_overdue` > 0 -> `POST notices appeal_overdue`.
4. Webhook `moderation.job_dead` -> aviso con el identificador (el detalle se ve en el panel).

Las **tareas periódicas pesadas** (barridos, purga) corren en el Cron de la plataforma de hosting, no en
n8n, para no gastar ejecuciones.

## Variables

`N8N_ENABLED`, `N8N_WEBHOOK_URL`, `N8N_OUTBOUND_SECRET`, `N8N_INBOUND_SECRET`, `N8N_TIMEOUT_SECONDS`,
`MODERATION_ALERT_EMAIL`, `MODERATION_PANEL_URL`. Los secretos nunca van al repositorio.
