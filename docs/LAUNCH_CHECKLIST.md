# LAUNCH_CHECKLIST — Qué falta para publicar THERS (web, Play Store, SEO)

> Estado: **lista de verificación viva, no un documento oficial ratificado.** Redactada el 2026-10-02.
> Las políticas de Google Play y de buscadores **cambian**: cada punto marcado «verificar» debe
> contrastarse con la consola de Play y la documentación oficial al momento de enviar. Esto no es
> asesoría legal.
>
> Marcas: ✅ comprobado en el repositorio · ❌ comprobado que **falta** · ⚠️ por verificar.
> Hosting y dominio: `ADR-018-hosting-and-environments.md` (propuesto).

---

## 1. Huecos de producto que bloquean la publicación

| Requisito | Estado | Evidencia |
|---|---|---|
| **Borrado de cuenta** (en la app y con un enlace web). Play lo exige a las apps con registro de cuentas | ❌ | No existe ninguna ruta de borrado. **`ADR-031` (propuesto)** define un flujo por código al correo, público y sin sesión. Las 22 claves foráneas a `users` ya son `CASCADE`, pero los archivos de avatar y portada no se borran solos |
| **Bloquear** usuarios | ✅ | `ADR-029`: aplicado en el servidor, simétrico, sin revelárselo al bloqueado |
| **Reportar** contenido y usuarios (apps con contenido de usuarios) | ❌ | No existe ruta ni tabla de reportes. **`ADR-032` (propuesto)** |
| **Moderación** y términos de uso aplicables | ❌ | No existe ningún rol de moderador, y el registro enlaza a `/terms` pero **el backend no guarda la aceptación**. **`ADR-032` (propuesto)**. Además hay que tener **quién atienda la cola** y revisar que `Terms.jsx` defina el contenido censurable |
| **Política de privacidad pública** con URL estable | ⚠️ | Hay página legal en la web; confirmar que cubre email, teléfono y fecha de nacimiento, y que la URL es pública |
| Edad mínima declarada y coherente con `MIN_AGE_YEARS` | ⚠️ | Existe en el backend (`ADR-002`); declararla en el cuestionario de Play |
| Sesión estable en el móvil | ❌ | `ADR-017` sin implementar: hoy la sesión muere a los 15 min |

## 2. Google Play

| Requisito | Estado | Nota |
|---|---|---|
| Cuenta de Google Play Developer, verificación de identidad | ⚠️ | Empezar ya: puede tardar días. Una cuenta de **organización** exige número D-U-N-S |
| Pruebas cerradas previas a producción | ⚠️ | Para cuentas personales nuevas, Google suele exigir un número mínimo de testadores durante un periodo mínimo. Verificar las cifras vigentes en la consola |
| **AAB firmado** con Play App Signing | ❌ | Hoy solo existe el APK debug. En Windows `eas build --local` no está soportado (`ANDROID_SETUP.md` §7): usar EAS Build en la nube |
| Nivel de API objetivo | ✅/⚠️ | `targetSdk` 36 en el proyecto; comparar con el requisito vigente al subir |
| 64 bits | ✅ | La build es `arm64-v8a` |
| API en **HTTPS** | ❌ | Hoy la app apunta a `http://192.168.1.69:5000`; en producción debe ser `https://api.<dominio>` |
| Formulario «Seguridad de los datos» | ❌ | Declarar email, teléfono, fecha de nacimiento, identificadores y contenido de usuario |
| Cuestionario de clasificación de contenido y público objetivo | ❌ | — |
| Ficha: icono, capturas, descripción, categoría | ❌ | — |
| Google Sign-In en producción | ⚠️ | Cliente OAuth de tipo Android con el **SHA-1 de la clave de firma de Play**, no el de debug; pantalla de consentimiento verificada |
| Permisos y declaraciones sensibles | ✅ | La app actual no pide permisos especiales; revisar al añadir cámara, notificaciones o llamadas |
| Notificaciones push (FCM) y llamadas | — | No existen todavía; no se necesitan para el primer envío |

## 3. Web y SEO

| Tema | Estado | Nota |
|---|---|---|
| Dominio propio con HTTPS | ❌ | Prerrequisito de todo lo demás |
| Páginas **públicas** indexables: landing, legales y, si se quiere, perfiles públicos | ❌ | Una SPA de React es difícil de indexar; usar **prerenderizado o SSR** solo para esas páginas |
| `title` y `description` únicos por página, Open Graph, `canonical` | ⚠️ | `title`/`description`/`robots`/`canonical` por ruta hechos (`ADR-033`, propuesto); falta `og:image` (sin asset de marca) y que se defina `VITE_SITE_URL` |
| `sitemap.xml` y `robots.txt` | ✅ | Generados en el build (`ADR-033`); sin `VITE_SITE_URL` bloquean todo. El feed y lo privado no se indexan |
| Rendimiento (Core Web Vitals): imágenes optimizadas, carga diferida | ⚠️ | Carga diferida por ruta hecha (bundle inicial ~348 kB, antes ~600 kB). Falta optimizar imágenes y medir con Lighthouse en staging |
| Google Search Console con el dominio verificado | ❌ | Tras comprar el dominio |
| Datos estructurados (`Organization`, `WebSite`) en la landing | ✅ | JSON-LD en la home, solo con `VITE_SITE_URL` definida (`RouteSeo.jsx`) |

## 4. Infraestructura (resumen; detalle en `ADR-018`)

| Tema | Estado |
|---|---|
| Dominio en `Cloudflare Registrar` o `Porkbun`, a nombre del proyecto, con 2FA | ❌ |
| Dominio verificado en Resend (SPF/DKIM) | ❌ — hoy el correo solo llega al dueño de la cuenta de Resend |
| Staging con base de datos gestionada, backend, almacenamiento S3 y web | ❌ |
| Copias de seguridad con **restauración probada** | ❌ |
| CORS limitado a dominios reales y secretos solo en variables de entorno | ⚠️ |
| Monitoreo, alertas y registro de errores | ⚠️ `GET /api/health` y Sentry opcional (`SENTRY_DSN`) listos; falta crear el proyecto en Sentry y un monitor de uptime que llame a `/api/health` |
| Cabeceras de seguridad (API y web) | ⚠️ API: listas. Web: `Frontend/public/_headers` con CSP en modo *report-only*; pasar a bloqueante tras revisar staging |
| Auditoría de dependencias y escaneo de secretos en CI | ✅ job `security` en `ci.yml` (`npm audit`, `pip-audit`, gitleaks) |

## 5. Orden recomendado

1. Dominio y cuenta de Play (plazos largos) + aprobación de `ADR-018`.
2. Staging mínimo con HTTPS y dominio en Resend.
3. `ADR-017` (refresh token) — sin sesión estable, las pruebas cerradas no sirven.
4. Borrado de cuenta (`ADR-031`), reportar y moderar con aceptación de términos (`ADR-032`), y política de privacidad: **ADR propuestos, pendientes de aprobación del equipo**; cambian contrato y esquema.
5. AAB firmado, ficha de Play y pruebas cerradas.
6. SEO de las páginas públicas y Search Console.
7. Producción.
