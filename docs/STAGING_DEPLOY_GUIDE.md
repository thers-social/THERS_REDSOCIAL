# Guía de despliegue de staging (prueba privada)

Documento operativo, **no oficial**: aplica `ADR-018-hosting-and-environments.md` (**propuesta sin ratificar**) a un primer entorno de prueba para el equipo y amigos. No es un lanzamiento público: ver §10.

Los precios salen de `ADR-018` y pueden haber cambiado. **Compruébalos en cada proveedor antes de pagar.**

## 0. Qué se despliega y dónde

| Pieza | Servicio | Carpeta / comando |
|---|---|---|
| Web | Cloudflare Pages | `Frontend/` → `npm ci && npm run build` → `dist` |
| API | Render (servicio web) | `backend/` → `gunicorn run:app` |
| Base de datos | Supabase (PostgreSQL) | `flask db upgrade` |
| Imágenes | Supabase Storage (compatible con S3) | `STORAGE_BACKEND=s3` |
| Correo | Resend (ya configurado) | `RESEND_API_KEY`, `EMAIL_FROM` |
| Dominio y DNS | Cloudflare (`thersweb.com`, ya comprado) | `staging.` y `api-staging.` |

Nombres sugeridos: web `https://staging.thersweb.com`, API `https://api-staging.thersweb.com`.

## 1. Antes de empezar (10 minutos)

- [ ] **Rotar la clave de Resend** que se expuso en una conversación y guardar la nueva solo en Render (nunca en el repositorio).
- [ ] Tener `develop` con todo fusionado y las pruebas en verde.
- [ ] Fusionar `feature/cors-allowed-origins`: sin ese PR la API acepta peticiones de cualquier sitio web. Si no está fusionado, **no hagas público el enlace**.
- [ ] Decidir `TERMS_ACCEPTANCE_REQUIRED` (§4). Con los textos legales aún sin revisión de un abogado, recomiendo dejarlo **vacío** en staging.

## 2. Supabase

1. Crear un proyecto nuevo **solo de staging**, con una región cercana a la de Render (ADR-018 §Riesgos 4).
2. Guardar la contraseña de la base en un gestor de contraseñas.
3. En *Project Settings → Database* copiar la cadena de conexión. Para THERS debe empezar con `postgresql+psycopg://` (no `postgresql://`).
4. **Prueba obligatoria** (ADR-018 §Riesgos 1): la conexión directa de Supabase es solo IPv6 y el *pooler en modo transacción* no admite sentencias preparadas. Si Render no conecta con la directa, usa el **pooler en modo sesión**. Se comprueba con el paso 3.6.
5. *Storage → New bucket*: crear `thers-media-staging` y marcarlo **público**.
6. *Storage → S3 connection*: crear las claves de acceso (anota *endpoint* y *región*).

Nota de coste (ADR-018): el plan gratuito de Supabase **se pausa tras una semana sin uso y no hace copias**. Sirve para staging, no para producción.

## 3. Render (API)

1. *New → Web Service* desde el repositorio de GitHub, rama `develop`.
2. Configuración:

| Campo | Valor |
|---|---|
| Root Directory | `backend` |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `gunicorn run:app --bind 0.0.0.0:$PORT --workers 2` |
| Pre-Deploy Command | `flask db upgrade` |
| Health Check Path | **Déjalo vacío.** No existe una ruta de salud (`/api/users/me` devuelve 401 y Render lo contaría como caída). Añadir `GET /api/health` es una mejora pendiente |

3. **Versión de Python:** el proyecto se desarrolla con Python 3.14 (ver comentario en `requirements.txt` sobre `psycopg[binary]`). Define `PYTHON_VERSION` con la que Render ofrezca más cercana y **comprueba que el build pasa**. Si falla, anótalo y avísanos: es un riesgo no verificado.
4. Variables de entorno (*Environment*):

| Variable | Valor | Notas |
|---|---|---|
| `FLASK_APP` | `run.py` | Para `flask db upgrade` |
| `JWT_SECRET_KEY` | cadena larga aleatoria | Generarla con `python -c "import secrets; print(secrets.token_urlsafe(64))"`. **Distinta** a la de local |
| `DATABASE_URL` | cadena de Supabase | Ver §2.3 |
| `STORAGE_BACKEND` | `s3` | **Obligatorio.** El disco de Render se borra en cada despliegue |
| `S3_ENDPOINT_URL`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | de Supabase Storage | |
| `MEDIA_PUBLIC_BASE_URL` | URL pública del bucket | `https://<proyecto>.supabase.co/storage/v1/object/public/thers-media-staging` |
| `RESEND_API_KEY` | la clave **nueva** | |
| `EMAIL_FROM` | el mismo valor que ya usas en tu `backend/.env` | Debe ser del dominio verificado en Resend (`notificaciones.thersweb.com`) |
| `EMAIL_REPLY_TO` | `soporte@thersweb.com` | |
| `FRONTEND_URL` | `https://staging.thersweb.com` | Para los enlaces de los correos |
| `CORS_ORIGINS` | `https://staging.thersweb.com` | Sin barra final |
| `TERMS_VERSION` | opcional | Hasta publicar los términos definitivos |
| `GOOGLE_CLIENT_ID` | opcional | Solo si se va a probar «Continuar con Google» |

**Nunca** definas `ALLOW_INSECURE_JWT_DEV_FALLBACK` en un entorno desplegado (`backend/.env.example` explica por qué).

5. Dominio personalizado: *Settings → Custom Domains* → `api-staging.thersweb.com`. Render indica el registro `CNAME`.
6. **Comprobación:** abrir los *Logs* y confirmar que el *Pre-Deploy* aplicó **las 33 migraciones** y que arrancó sin avisos de `CORS_ORIGINS` ni de `JWT_SECRET_KEY`.

## 4. Términos de uso

`TERMS_ACCEPTANCE_REQUIRED` está **apagada por defecto** a propósito (`ADR-032` §5): activarla deja sin poder registrarse a quien use una versión del cliente que no envía la casilla. Actívala (`1`) solo cuando la web y el móvil desplegados la envíen **y** los textos legales estén revisados.

## 5. Cloudflare Pages (web)

1. *Workers & Pages → Create → Pages → Connect to Git*, rama `develop`.
2. Configuración:

| Campo | Valor |
|---|---|
| Root directory | `Frontend` |
| Build command | `npm ci && npm run build` |
| Build output directory | `dist` |
| `NODE_VERSION` | la misma que usas en local (verificar con `node --version`) |

3. Variables de entorno (se incrustan en el código público, **sin secretos**):

| Variable | Valor |
|---|---|
| `VITE_API_URL` | `https://api-staging.thersweb.com/api` |
| `VITE_GOOGLE_CLIENT_ID` | solo si se prueba Google |
| `VITE_SITE_URL` | **déjala vacía en staging**: sin ella el `robots.txt` no deja indexar nada |

4. Dominio personalizado: `staging.thersweb.com`.

## 5b. «Continuar con Google» en staging (`ADR-012`)

El código ya está en web y API; solo falta configurar. No necesita `GOOGLE_CLIENT_SECRET`.

1. En Google Cloud Console → *APIs y servicios → Credenciales*, abrir el **Client ID de tipo «Aplicación web»** (el mismo que usa el móvil no sirve si es de tipo Android).
2. En **Orígenes autorizados de JavaScript** añadir `https://staging.thersweb.com` (sin barra final ni ruta). No hace falta URI de redirección.
3. Si la pantalla de consentimiento está en modo *Prueba*, añadir como **usuarios de prueba** los correos de quienes van a entrar, o publicarla.
4. Cloudflare Pages: `VITE_GOOGLE_CLIENT_ID` = ese Client ID, y **redesplegar** (Vite lo incrusta al compilar).
5. Render: `GOOGLE_CLIENT_ID` = **el mismo valor** (la API lo exige como `aud`). Reiniciar el servicio.
6. Prueba: en `/login` y `/register` aparece el botón de Google; al elegir cuenta se crea la sesión y, si es cuenta nueva, pasa por `/complete-profile`.

Si el botón no aparece: revisar la consola (`VITE_GOOGLE_CLIENT_ID` vacía) o el error `origin_mismatch` (origen sin autorizar en el paso 2). Si el botón sale pero la API responde 400, los dos Client ID no coinciden.

## 6. Cron de purga de datos (`ADR-037`)

En Render: *New → Cron Job*, mismo repositorio y rama, *Root Directory* `backend`, comando `python scripts/purge_expired_data.py`, una vez al día (por ejemplo `0 6 * * *`). Mismas variables de entorno que la API. Imprime solo conteos.

## 7. Cuentas de moderación

Con `ADR-032`: el rol **solo** se concede por línea de comandos.

1. Cada persona registra su cuenta de moderación en la web de staging (correo dedicado, p. ej. `diego.mod@thersweb.com`), verifica el código y **activa el 2FA** (Ajustes → Seguridad).
2. En Render, abrir **Shell** del servicio web (disponible en servicios de pago: comprobarlo) y ejecutar, por cada persona:
   ```
   flask set-moderator correo@dominio.com
   ```
3. Cada persona entra a `https://staging.thersweb.com/moderation`. Sin el rol ve «No encontramos esta página».

## 8. Pruebas de humo (10 minutos)

- [ ] `https://api-staging.thersweb.com/api/users/me` responde `401` (JSON).
- [ ] Registro con un correo real: llega el código por Resend y se verifica.
- [ ] Iniciar sesión, publicar, comentar y dar «me gusta».
- [ ] Subir una foto de perfil: la imagen aparece y su URL es la del bucket de Supabase.
- [ ] En el navegador no hay errores de CORS en la consola.
- [ ] Reportar una publicación con la segunda cuenta y verla en `/moderation`.
- [ ] Suspender una cuenta de prueba: no puede entrar y ve el motivo.
- [ ] `/child-safety`, `/privacy` y `/terms` cargan (recuerda: los legales son borradores).
- [ ] Eliminar una cuenta de prueba desde `/eliminar-cuenta`.

## 9. Si algo sale mal

| Síntoma | Qué mirar |
|---|---|
| La API no arranca | *Logs* de Render. Falta `JWT_SECRET_KEY` o `DATABASE_URL` |
| `connection failed` a la base | §2.4: probar el pooler en modo sesión |
| Los correos no llegan | `RESEND_API_KEY`, y que `EMAIL_FROM` use el dominio verificado |
| Error de CORS en el navegador | `CORS_ORIGINS` debe ser idéntico al origen de la web, sin barra final |
| Las fotos desaparecen al redesplegar | `STORAGE_BACKEND` no es `s3` |
| Una migración falla | No relances a ciegas. Copia el error; staging se puede recrear |

Para volver atrás: *Deploys* de Render permite redesplegar una versión anterior. **No** reviertas migraciones de base de datos en producción sin copia.

## 10. Esto NO es un lanzamiento público

No lo anuncies, no lo indexes ni lo compartas fuera del grupo de prueba hasta que esté resuelto:

- [ ] Revisión de los textos legales por una persona abogada (`docs/legal/` son borradores).
- [ ] Quién modera y en cuánto tiempo atiende la cola (`ADR-032`, decisión 1). Sin eso, el compromiso de `/child-safety` no se cumple.
- [ ] Exigir 2FA a las cuentas de moderación.
- [ ] Rol ADMIN y registro de la acción exacta tomada en cada reporte (hoy `retirar contenido` y `suspender` quedan ambas como `actioned`).
- [ ] Copias de seguridad probadas (Supabase de pago) y monitoreo.
- [ ] Producción separada de staging, con sus propias claves.
- [ ] Ratificar `ADR-018` en el equipo.
- [ ] Google Play: su revisión tarda días; no se puede depender de ella para «mañana».

## 11. Coste aproximado de staging (verificar)

Según `ADR-018`: Render Starter ≈ 7 USD/mes; Supabase gratis (se pausa y no tiene copias) o Pro ≈ 25 USD/mes; Cloudflare Pages gratis; Resend gratis hasta 100 correos al día. Para staging bastan Render de pago y Supabase gratuito.
