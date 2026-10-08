# Guion — Cristopher (6 min): DevOps, seguridad de la infraestructura y cierre

## 1. Entorno local (1 min)
- **Docker Compose** levanta PostgreSQL 16 (`docker-compose.yml`, en la raíz).
- Variables de entorno documentadas en `backend/.env.example` y `Frontend/.env.example`. El `.env` real nunca se sube al repositorio.
- Migraciones reproducibles: cualquier integrante levanta la misma base con un solo comando.

## 2. Propuesta de despliegue (1,5 min)
- Está en `docs/architecture/ADR-018-hosting-and-environments.md`. **Es una propuesta; aún no está ratificada.**
- Servicios previstos: Cloudflare (dominio y DNS), Supabase (base de datos), Render (servidor) y Resend (correo).
- Lista de publicación en `docs/LAUNCH_CHECKLIST.md` (Google Play, SEO y huecos de producto).
- **Dilo así:** «Esto es el plan, no algo ya desplegado.»

## 3. Lo que ya está hecho (1 min)
- Dominio `thersweb.com` comprado en Cloudflare.
- Correo con Reply-To a `soporte@thersweb.com`.
- Correos de contacto creados (soporte, privacidad, apelaciones, seguridad y seguridad infantil).
- Envío de correo con Resend, probado de extremo a extremo.

## 4. Seguridad de la infraestructura (1 min)
- Secretos **fuera del repositorio** (`.env` ignorado por git).
- La clave de Resend que se expuso en una conversación **debe rotarse**. **Cristopher: confirma antes de la exposición que ya se rotó** y dilo con confianza o no lo menciones.
- Pendiente de definir: gestión de secretos en producción, SSL y copias de seguridad.

## 5. Lo que falta (1,5 min) — esta es la diapositiva de honestidad
- **Despliegue:** staging y producción.
- **Automatización:** CI/CD y un Cron Job que ejecute la purga de datos de 90 días (`scripts/purge_expired_data.py`).
- **Operación:** monitoreo y copias de seguridad.
- **Moderación:** panel de moderación (hoy se puede reportar y priorizar, pero no hay panel).
- **Legal:** revisión de los textos por un abogado antes de publicar.
- **Producto:** diseño de UI/UX móvil, reporte de contenido en la web y guías de comunidad.

## 6. Cierre (30 s)
«Con esto cerramos. Hoy hay una web y una app que funcionan, un backend probado, y un plan claro de qué falta para publicar. Gracias.»

## Lista de preparación de Cristopher
- [ ] Confirmar que la clave de Resend está rotada.
- [ ] Revisar que `ADR-018` refleje lo que realmente se decidió.
- [ ] Una diapositiva con lo hecho y otra con lo pendiente.
- [ ] Saber la respuesta a «¿cuánto cuesta y cuándo se contrata?». Según lo acordado, nada se paga hasta tener el diseño y el equipo listo.
- [ ] Cronometrar: máximo 6 minutos.
