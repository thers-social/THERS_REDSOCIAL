# Pruebas locales de Historias (web y móvil)

- **Estado:** guía operativa para probar Historias (`ADR-042`) **solo en una máquina de desarrollo**.
  No es una guía de despliegue y **no activa Historias en ningún entorno público**
  (`STORIES_ENABLED` sigue apagado por defecto en el código y en `backend/.env.example`).
- **Fecha:** 2026-10-18. Rama: `feature/stories-integration`.
- **Qué es local y desechable:** todo lo de este documento usa una base de datos, un directorio de
  fotos y un contenedor **propios**, distintos de `thers_dev` y de cualquier bucket. Las
  contraseñas y claves se generan al momento y **no** se guardan en el repositorio.

## 1. Entorno local aislado

| Pieza | Valor |
|---|---|
| Base de datos | Contenedor **nuevo** `thers_stories_dev_pg` (PostGIS 16), base `thers_stories_dev`, publicado solo en `127.0.0.1:5545`, volumen propio `thers_stories_dev_data` |
| Almacenamiento de fotos | `STORAGE_BACKEND=local`, `UPLOAD_DIR` en una carpeta fuera del repositorio. **Ningún bucket S3/Supabase.** |
| Backend | `python run.py` en `0.0.0.0:5000` |
| Web | `npm run dev` (Vite) en `127.0.0.1:5173`, con `VITE_API_URL=http://127.0.0.1:5000/api` |

Variables del backend (solo en el entorno de la terminal, nunca en un archivo versionado):

```
DATABASE_URL=postgresql+psycopg://<usuario>:<clave>@127.0.0.1:5545/thers_stories_dev
JWT_SECRET_KEY=<cadena aleatoria larga>
STORAGE_BACKEND=local
UPLOAD_DIR=<carpeta local fuera del repo>
MEDIA_PUBLIC_BASE_URL=http://<IP de tu PC en la red>:5000/api/media
STORIES_ENABLED=true            # SOLO en este entorno local
TERO_ENABLED=true
TERO_AI_ENABLED=false           # sin ANTHROPIC_API_KEY: Tero responde un texto fijo
JWT_ACCESS_TOKEN_EXPIRES_SECONDS=14400   # solo local: la web no renueva el token
```

Antes de migrar, **verifica a qué base apuntas** (host `127.0.0.1`, puerto `5545`, base
`thers_stories_dev`; nunca el `5433` ni `thers_dev`) y recién entonces ejecuta
`python -m flask db upgrade`. Cabeza esperada: `c8dcd63b24d4`.

`MEDIA_PUBLIC_BASE_URL` debe usar la **IP de la red**, no `127.0.0.1`: es la URL que el teléfono
usa para descargar las fotos.

## 2. Probar en la web

1. Abre `http://127.0.0.1:5173` e inicia sesión con un usuario de prueba.
2. En **Inicio → Momentos Activos** pulsa **Tu momento**, elige una imagen, escribe un texto
   (opcional, máximo 200 caracteres) y pulsa **Publicar historia**.
3. Aparece la tarjeta **Tu historia**. Púlsala para abrir el visor (barra de progreso, **Vistas** y
   papelera para borrar).
4. Con otra cuenta que **siga** a la primera, la historia aparece en su tira; al abrirla se registra
   la vista, que la autora ve en **Vistas**.

## 3. Probar en el móvil (Samsung A16 5G y moto z3)

### 3.1 ¿Hace falta recompilar? **Sí.**

`expo-image-picker` es un módulo **nativo** nuevo (`package.json` `~57.0.20` y el plugin en
`app.json`). La *development build* que ya tengas instalada **no lo incluye** (no figura en su
autolinking), así que **abrir Historias con ella fallará al elegir una foto**. Hay que compilar e
instalar de nuevo. El JavaScript solo (Metro) no basta.

Comprobado sin compilar: `expo prebuild --platform android` termina bien, el autolinking de Expo
resuelve `expo-image-picker` y `expo export --platform android` genera el bundle.

### 3.2 Requisitos

- Teléfono con **depuración USB** activa y `adb devices` mostrándolo como `device`.
- El teléfono y el PC en la **misma red Wi-Fi** (sin «aislamiento de clientes» en el router).
- Regla de firewall de Windows para el puerto **5000** (ya existe: `THERS backend dev 5000`, perfiles
  Privado y Público). Si no la tienes, créala como administrador.
- `mobile/.env` local (ignorado por git) con `EXPO_PUBLIC_API_URL=http://<IP de tu PC>:5000/api` y,
  para probar Tero, `EXPO_PUBLIC_TERO_ENABLED=true`. **Nunca** pongas un secreto ahí: se embebe en
  el APK.

### 3.3 Compilar e instalar (Windows, ruta corta)

Sigue `ANDROID_SETUP.md` §9: las rutas largas rompen el `ninja` de CMake, así que se compila desde
una unidad virtual a la **raíz del repositorio** (no a `mobile/`):

```powershell
subst N: C:\t_int                       # raíz del worktree de la rama
cd N:\mobile
npx expo prebuild --platform android --no-install   # genera mobile\android (ignorada por git)
cd N:\mobile\android
.\gradlew app:assembleDebug -PreactNativeArchitectures=arm64-v8a
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

- La primera compilación completa tarda **unos 20 minutos o más**. Solo arm64 (ambos teléfonos lo son).
- Si falla con «this and base files have different roots», es el *autolinking* mezclando `N:` y
  `C:`; ver la nota en `ANDROID_SETUP.md` y reescribir las rutas `C:\t_int` a `N:` en
  `mobile\android\build\generated\autolinking\autolinking.json`.
- Con **dos teléfonos**, repite `adb install -r` con `adb -s <serial>` en cada uno.

### 3.4 Usar la app

```powershell
cd N:\mobile
adb reverse tcp:8081 tcp:8081           # Metro por USB, sin regla de firewall
npm start                               # expo start --dev-client; déjalo abierto
```

Abre **THERS** en el teléfono (si Metro se cierra, la app no puede volver a cargar su JavaScript).
Inicia sesión con un usuario de prueba. En **Inicio**: **Tu historia** → **+** → elige una foto →
escribe un texto → publica. Toca la tira para ver y la papelera para borrar.

En Android 13 o superior el selector de fotos del sistema **no pide permisos** (el módulo devuelve
«concedido» sin pedirlos); en el moto z3 (Android más antiguo) sí pedirá acceso a las fotos.

## 4. Lista de comprobaciones en el teléfono

1. Iniciar sesión y ver la tira de historias (sin errores).
2. Publicar una foto con y sin texto; ver «Tu historia».
3. Con otra cuenta que siga a la primera: ver la historia, la barra de progreso y el paso al
   siguiente; comprobar que la autora ve la vista.
4. Borrar una historia propia.
5. Cuenta que **no** sigue a la autora: no ve nada.
6. Bloquear y desbloquear (recuerda que **bloquear elimina el follow en ambos sentidos**: hay que
   volver a seguir).
7. Tero: abrir el chat y comprobar que responde (sin clave de IA responde un texto fijo).
8. Rotar la pantalla, mandar la app a segundo plano y volver, perder la red un momento.

## 5. Qué falta para habilitar Historias públicamente

No se habilita hasta resolver, como mínimo (`ADR-042` §4 y §11, `ADR-044`):

1. **Bucket público:** quien tenga la URL abre la imagen sin sesión, también de una cuenta privada y
   también ya vencida hasta que la purga borre el archivo (hasta 6 h más).
2. **Sin `moderation_status`:** lo publicado se ve sin revisión previa.
3. **Sin reporte `story`** (`ADR-032`).
4. **Material de abuso sexual infantil:** sin solución evaluada; protocolo legal pendiente.
5. **Supabase Pro** (Storage y copias) y el hosting (`ADR-018`) sin ratificar.
6. **Pruebas en los dos teléfonos físicos** y la revisión del equipo (`HB-001` §11–12).
7. Decidir si una cuenta **restringida** debe ver historias: hoy **solo el bloqueo** las oculta.
