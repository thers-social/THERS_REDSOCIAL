# Automatizaciones con n8n (ADR-041 §7, fase 7)

Dos automatizaciones, **apagadas por defecto**:

| Flujo | Disparo | Qué hace |
|---|---|---|
| `workflows/thers-report-resolved.json` | El backend (webhook) al cerrar un reporte | Envía un correo **genérico** a quien reportó |
| `workflows/thers-weekly-summary.json` | Cada lunes 8:00 (y disparo manual) | Pide a Flask el lote, envía el resumen y acusa recibo |

## Principios

- **Flask es la fuente de verdad y el único que decide** quién recibe qué y con qué números. n8n solo transporta y redacta.
- n8n recibe datos mínimos: correo, primer nombre y conteos. Nunca contenido, nombres de otras personas ni notas de moderación.
- Firma HMAC-SHA256 en **los dos sentidos** (`X-THERS-Timestamp`, `X-THERS-Signature` = `sha256=` + HMAC de `<marca>.<cuerpo>`), ventana de 5 min, comparación en tiempo constante. Sin JWT.
- Idempotente: `X-THERS-Idempotency-Key` en el webhook; el acuse del resumen solo marca una vez por semana.
- Si n8n está caído, **nada se rompe**: la resolución del reporte sigue y el resumen se reofrece en la siguiente corrida.

Contrato completo: `docs/architecture/API_CONTRACT.md` §4.38.

## Puesta en marcha

1. Generar el secreto: `python -c "import secrets; print(secrets.token_urlsafe(48))"`.
2. Backend (`backend/.env`): `TERO_AUTOMATIONS_ENABLED=true`, `N8N_BASE_URL=https://<tu-n8n>`, `N8N_WEBHOOK_SECRET=<secreto>`.
3. n8n, variables de entorno (el **mismo** secreto):
   - `N8N_WEBHOOK_SECRET`, `THERS_API_URL` (p. ej. `https://api.tudominio/api`)
   - `RESEND_API_KEY`, `EMAIL_FROM` (remitente verificado en Resend; `RESEND_API_URL` solo para pruebas)
   - `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` y `NODE_FUNCTION_ALLOW_BUILTIN=crypto` (los nodos Code usan `$env` y `crypto`)
4. Importar los dos JSON (Workflows → Import) y **activarlos**.
5. Aplicar la migración: `flask db upgrade` (`d7a3f1c8e254`).
6. En producción, `N8N_BASE_URL` y `THERS_API_URL` deben ser `https`.

## Probado (2026-10-17, n8n 2.x en Docker, Resend simulado)

- Reporte resuelto → un correo genérico, sin contenido, nombres ni nota interna.
- Firma válida 200; repetida (misma clave) 200 sin segundo correo; secreto equivocado, cuerpo alterado y marca vieja → 401 sin correo.
- Resumen semanal: lote pedido a Flask, correo con los conteos, acuse registrado; segunda corrida → 0 correos.
- Pruebas automáticas del backend: `backend/tests/automations/` (60 pruebas, sin n8n real).

## Pendiente antes de producción

- Elegir y verificar el proveedor de correo y el dominio remitente (Resend es la suposición de los flujos).
- Hosting de n8n (ADR-018 sin ratificar) y gestión de secretos.
- El interruptor «Resumen semanal» en Ajustes de la app (hoy solo existe en la API: `PATCH /api/users/me/privacy`).
- Aviso de privacidad: el correo pasa por n8n y el proveedor de correo.
