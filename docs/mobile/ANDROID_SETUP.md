# ANDROID_SETUP — Entorno de desarrollo Android para THERS (Windows / PowerShell)

> Estado: **entorno operativo** (build nativa e instalación en un teléfono verificadas el 2026-10-02).
> Este documento registra lo que está verificado en la máquina de desarrollo y lo que falta, con los
> comandos reales. Todo lo marcado como `VERIFICADO` se ejecutó y se comprobó el 2026-10-01/02; lo
> demás está explícitamente pendiente. Las trampas reales de esta máquina están en §9.
>
> Contexto: `ADR-016-mobile-stack.md` (ratificado) · evidencia en `docs/mobile/READINESS.md`.
> DevOps no tiene documentación oficial en `/docs` (`CLAUDE.md` §5) — este archivo cubre
> exclusivamente el entorno local de desarrollo Android, no despliegue.

---

## 1. Versiones objetivo (consultadas al registro npm, 2026-10-01)

La app móvil se fija al **template oficial de Expo SDK 57**, no a las últimas versiones sueltas de
cada paquete:

| Pieza | Versión | Nota |
|---|---|---|
| `expo` | `~57.0.26` | SDK estable |
| `react` | `19.2.3` | misma línea que `Frontend/` (`^19.2.4`) |
| `react-native` | `0.86.3` | **no 0.87.x**, aunque exista: el template de SDK 57 pinea 0.86.3 |
| `typescript` | `~6.0.3` | decidido en `ADR-016` §4 |
| Gradle | 9.3.1 | lo trae el wrapper del proyecto, no se instala a mano |
| Kotlin | 2.1.20 | idem |
| `minSdk` / `compileSdk` / `targetSdk` | 24 / 36 / 36 | — |
| NDK | 27.1.12297006 | exigido por la cadena de build de RN 0.86.3 |

Regla: **no combinar versiones independientes de React, React Native y Expo.** Si hay duda, manda
el template del SDK, no el `latest` de npm.

## 2. Estado de las herramientas en la máquina de desarrollo

| Herramienta | Estado | Detalle |
|---|---|---|
| Node | **VERIFICADO** | v24.14.0 (≥ 20, suficiente) |
| npm | **VERIFICADO** | 11.12.0 |
| Android Studio | **VERIFICADO** | instalado |
| Android SDK | **VERIFICADO** | `%LOCALAPPDATA%\Android\Sdk` |
| platform-tools / adb | **VERIFICADO** | adb 1.0.41 (37.0.1) funcionando |
| build-tools | **VERIFICADO** | 36.0.0 y 37.0.0 |
| `platforms/android-36` | **INSTALADO Y VERIFICADO** | faltaba; solo había `android-37.0`. Confirmado en disco y en `android sdk list` |
| `ndk/27.1.12297006` | **INSTALADO Y VERIFICADO** | faltaba por completo. 2.1 GB en disco, confirmado en `android sdk list` |
| Android CLI (`android.exe`) | **VERIFICADO** | 1.0.16486076, términos aceptados |
| **JDK 17** | **VERIFICADO (2026-10-02)** | Temurin 17.0.20.1 en `C:\Program Files\Eclipse Adoptium\jdk-17.0.20.101-hotspot` |
| `JAVA_HOME` | **VERIFICADO** | definido a nivel máquina. Una sesión abierta *antes* de instalar el JDK sigue viendo el JDK 8 en el PATH: abrir terminal nueva |
| `ANDROID_HOME` | **VERIFICADO** | `%LOCALAPPDATA%\Android\Sdk`, definido en el entorno de usuario |
| Dispositivo | **VERIFICADO** | `adb devices` → `device`. Probado con un **Motorola moto z3**; el Samsung A16 5G sigue sin probarse |
| Regla de firewall para el puerto 5000 | **VERIFICADO** | `THERS backend dev 5000`, TCP, perfiles Privado y Público (ver §5 y §9) |
| Build-Tools 35.0.0 y CMake 3.22.1 | **INSTALADOS por Gradle** | los pide el proyecto además de 36/37; se descargan solos la primera vez |
| Espacio en disco | **vigilar** | 49 GB libres antes de esta sesión → **41 GB** después de SDK 36 + NDK. Falta por instalar: `node_modules` de `mobile/` (~1,5 GB) y las cachés de Gradle (~3–5 GB) |

## 3. JDK — pasos que necesitan tu shell con permisos

`winget` instala en `Program Files` y necesita elevación, que un shell no interactivo no puede
pedir. Ejecutar manualmente:

```powershell
winget install --id EclipseAdoptium.Temurin.17.JDK --accept-package-agreements --accept-source-agreements
```

Después, variables de usuario (no requieren admin, pero sí una terminal nueva para verlas):

```powershell
setx JAVA_HOME "C:\Program Files\Eclipse Adoptium\jdk-17.0.16.8-hotspot"
setx ANDROID_HOME "$env:LOCALAPPDATA\Android\Sdk"
setx PATH "$env:JAVA_HOME\bin;$env:LOCALAPPDATA\Android\Sdk\platform-tools;$env:PATH"
```

Ajustar la ruta exacta de `jdk-17...` a la que haya quedado instalada (`Get-ChildItem
"C:\Program Files\Eclipse Adoptium"`).

### 3.1 Por qué JDK 17 y no el JBR 25 de Android Studio

Android Studio trae `jbr` con **OpenJDK 25.0.2**, y Gradle 9.3.1 lo soporta en principio, así que
tentaría usarlo y ahorrarse la instalación. Dos razones para no hacerlo:

1. React Native documenta **JDK 17** para su cadena de build; 25 con Kotlin 2.1.20 no está
   verificado en este proyecto.
2. **Problema real encontrado el 2026-10-01:** el `keytool` del JBR 25 con locale español **falla**
   con `java.util.MissingFormatArgumentException: Format specifier '%2$s'`. Se puede sortear con
   `-J-Duser.language=en -J-Duser.country=US`, pero es una señal de que esa combinación no es la
   ruta probada.

Mientras el JDK 17 no esté instalado, el JBR sirve para tareas puntuales:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
```

## 4. Paquetes del SDK — cuidado con la sintaxis

`sdkmanager` está **deprecado** y reenvía al nuevo `android.exe`. El shim **no respeta los nombres
de paquete con `;`**: `sdkmanager "platforms;android-36"` termina en `Package platforms not found`
y, pese a ello, **sale con código 0** — un fallo silencioso fácil de confundir con un éxito.

Sintaxis correcta (nombres con `/`, no con `;`):

```powershell
$android = "$env:LOCALAPPDATA\Android\Sdk\cmdline-tools\latest\bin\android.exe"
& $android sdk list                               # instalados
& $android sdk list --all                         # disponibles
& $android sdk install "platforms/android-36" "ndk/27.1.12297006"
```

Notas de su primera ejecución:
- Pide **aceptar los términos de forma interactiva**. En un shell no interactivo se le puede pasar
  `"y"` por stdin: `"y" | & $android --version`.
- Descomprime un bundle en `%USERPROFILE%\.android\cli\bundles`. Si una ejecución se interrumpe,
  deja un directorio `*.extract` y un `lock` que hacen fallar la siguiente con
  `Acceso denegado (os error 5)`. Se resuelve borrando esos residuos:

```powershell
Remove-Item "$env:USERPROFILE\.android\cli\bundles\*.extract" -Recurse -Force
Remove-Item "$env:USERPROFILE\.android\cli\bundles\lock" -Force -ErrorAction SilentlyContinue
```

**Verificar siempre en disco**, no por el código de salida:

```powershell
Get-ChildItem "$env:LOCALAPPDATA\Android\Sdk\platforms", "$env:LOCALAPPDATA\Android\Sdk\ndk"
```

## 5. Conectividad entre el teléfono y el backend

- `backend/run.py` ya escucha en **`0.0.0.0:5000`** — VERIFICADO. No hace falta tocar nada ahí para
  que un teléfono de la misma red alcance la API.
- IP LAN del equipo de desarrollo (Wi-Fi): **`192.168.1.69`** — reverificar, cambia con la red.
  Hay además una `192.168.112.1` del adaptador vEthernet de WSL: **no es la que debe usar el
  teléfono.**
- **No hay regla de firewall para el puerto 5000** (VERIFICADO: ninguna). Sin ella, el teléfono no
  conecta. Crearla acotada, en una terminal con permisos de administrador:

```powershell
New-NetFirewallRule -DisplayName "THERS backend dev 5000" -Direction Inbound `
  -LocalPort 5000 -Protocol TCP -Action Allow -Profile Private
```

`-Profile Private` a propósito: solo en redes marcadas como privadas, nunca en redes públicas.
**Ojo:** el Wi-Fi de esta máquina (`CLARO1_837513`) está clasificado como **Público**, así que una
regla solo-Privada no se aplicaría. Dos salidas: cambiar la red a Privada (preferible), o crear la
regla con `-Profile Private,Public` (es la que se creó el 2026-10-02; abre el puerto en redes públicas).

- Para la app móvil, la URL de la API será `http://192.168.1.69:5000/api` (variable
  `EXPO_PUBLIC_API_URL`). **`localhost` en el teléfono apunta al teléfono**, no al equipo.
- El emulador estándar de Android usa `10.0.2.2` para alcanzar el host — distinto valor que el del
  dispositivo físico.
- Distinguir siempre tres URLs: la de **Metro**, la de la **API** y la del **servicio de llamadas**.
- Las peticiones nativas de React Native **no pasan por CORS**. Si algo falla en el teléfono, no se
  toca `CORS(app)`: se revisa firewall, IP, TLS y el header `Authorization`.

## 6. Google Sign-In en Android

El backend ya verifica ID Tokens (`ADR-012`) y acepta **una sola audiencia**: el Web client ID de
`GOOGLE_CLIENT_ID`. Credential Manager en Android pide el ID Token usando ese **mismo Web client ID
como `serverClientId`**, así que la `aud` sigue siendo la que el backend espera y, previsiblemente,
**no hace falta cambiar el backend**. Hipótesis fundamentada, **no verificada** — se confirma con la
primera prueba real en dispositivo.

Falta registrar un **cliente OAuth de tipo Android** en Google Cloud Console, con el nombre de
paquete de la app y el SHA-1 de cada keystore. Obtener el SHA-1 de la keystore de debug:

```powershell
& "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" `
  "-J-Duser.language=en" "-J-Duser.country=US" `
  -list -v -keystore "$env:USERPROFILE\.android\debug.keystore" `
  -alias androiddebugkey -storepass android -keypass android
```

(El `-J-Duser.language=en` es el workaround del bug de locale de §3.1. La keystore de debug y su
contraseña `android` son públicas por diseño de Android — no son un secreto. La keystore de
**release** sí lo es: nunca entra al repositorio, `HB-001` §20.)

El SHA-1 de debug es **por máquina**: cada integrante del equipo debe registrar el suyo, y además
hará falta el de la keystore de release cuando llegue la etapa de publicación.

### 6.1 Implementación en la app (2026-10-18)

«Continuar con Google» ya está en el login y el registro móviles. Usa
`@react-native-google-signin/google-signin` (16.x, con su *config plugin* en `app.json`), que obtiene
el ID Token con el Web client ID como `webClientId` y lo manda a `POST /api/auth/google`. **No hubo
cambios en el backend ni en `API_CONTRACT.md`.** Código: `src/features/auth/lib/googleSignIn.ts`,
`loginWithGoogle()` en `AuthContext.tsx`, `GoogleSignInButton.tsx`, y `app/complete-profile.tsx` para las
cuentas nuevas (teléfono, país, fecha de nacimiento y usuario, igual que `CompleteProfile` en la web).

Para que funcione hacen falta **tres cosas fuera del código**:

1. **`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`** en `mobile/.env`, con el mismo valor que `GOOGLE_CLIENT_ID` del
   backend (identificador público, no un secreto). Sin la variable el botón no se dibuja.
2. **Un cliente OAuth de tipo Android** en Google Cloud Console, **en el mismo proyecto** que ese Web
   client ID (no en el de Firebase si son distintos), con el paquete `com.thers.app` y el SHA-1 de la
   keystore con la que se firma la compilación. Sin él Google responde `DEVELOPER_ERROR` y la app muestra
   «Google no está configurado para esta versión de la app».
3. **Recompilar** la app: es un módulo nativo nuevo; con Metro solo no basta.

SHA-1 de la keystore de debug que genera la plantilla de Expo (`android/app/debug.keystore`, la misma en
todas las máquinas; es pública por diseño): `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`.
La de release hay que registrarla aparte cuando exista.

Tampoco hace falta `google-services.json` para Google: el de Firebase (push, `ADR-053`) es otra cosa y su
`oauth_client` puede estar vacío.

**Verificado en un teléfono real (moto z3, 2026-10-18):** con el cliente Android creado, «Continuar con
Google» abre el selector de Google, el servidor responde `200` a `POST /api/auth/google` y la app entra al
Inicio con la cuenta de THERS que ya tenía ese correo (vinculada por correo verificado, `ADR-012`). Esto
confirma la hipótesis de arriba: el `aud` del token es el Web client ID y el backend no necesita cambios.
**No se probó todavía** el alta de una cuenta nueva con Google ni la pantalla `complete-profile` en el
teléfono: el único correo de Google del teléfono ya tenía cuenta de THERS.

## 7. Comandos del día a día (cuando `mobile/` exista)

`mobile/` existe desde 2026-10-01. Desde una terminal nueva (JDK 17 y `ANDROID_HOME` ya definidos) y,
en esta máquina, desde `M:\mobile` (ver §9):

```powershell
cd mobile
npm run start            # Metro
npm run android          # compila e instala la development build en el dispositivo
npx tsc --noEmit         # chequeo de tipos
npx expo-doctor          # coherencia de versiones del SDK y dependencias
```

Distinguir los tres tipos de build (`THERS_PROMPT_CLAUDE_ANDROID.md` §10):
- **development** — depende de Metro para servir el JavaScript.
- **preview / APK interna** — lleva el bundle incluido, abre sin Metro, **pero sigue necesitando el
  backend** para los datos.
- **production / AAB** — firma de distribución, etapa de publicación. Un AAB no se instala como APK.

`eas build --local` **no tiene soporte oficial en Windows**: en esta máquina se compila con Expo
CLI + Android Studio/Gradle. EAS Cloud es opcional y no hace falta contratarlo para empezar.

## 9. Trampas reales de esta máquina (2026-10-02)

**Rutas de más de 260 caracteres (Windows).** La primera build falló en la fase C++ con
`ninja: error: Stat(...rngesturehandler_codegen...): Filename longer than 260 characters`: el `ninja`
de CMake 3.22.1 no usa rutas largas, y `node_modules/react-native-gesture-handler/...` embebido en el
nombre del objeto rebasa el límite. Solución usada, sin mover nada: una unidad virtual a **la raíz del
repo** y compilar desde `M:\mobile`:

```powershell
subst M: C:\Users\Escalante\Desktop\THERS_REDSOCIAL_2026   # NO a la carpeta mobile/ directamente
cd M:\mobile; npm run android
```

- Mapear `M:` directamente a `mobile/` **falla**: el autolinking de Expo busca `package.json`
  subiendo carpetas y nunca revisa la raíz de la unidad (`Couldn't find "package.json" up from path`).
- `subst` no sobrevive a un reinicio; se recrea con el mismo comando.
- Aparecen avisos Kotlin «this and base files have different roots» (rutas `M:` y `C:` mezcladas).
  No impiden compilar. `git status --ignored` también avisa «Filename too long» sobre
  `mobile/android/app/.cxx/`: es ruido de caché ignorada.
- Habilitar `LongPathsEnabled` en el registro no se probó y podría no bastar con ese `ninja`.

**Metro y el teléfono.** `expo run:android` deja Metro en el 8081 y hace `adb reverse tcp:8081`, así que
Metro llega por USB sin regla de firewall. **Si Metro se cierra, la development build instalada no
puede volver a cargar su JavaScript**: arrancar con `npm start` (desde `M:\mobile`) sin recompilar.

**Una build larga puede ser detenida** por el límite de tiempo en segundo plano de Claude Code (30 min
por defecto) o por poca memoria. No es un fallo de Gradle: relanzar retoma desde la caché.

**Expo reescribe `mobile/tsconfig.json`** (`include`) al arrancar. Revisar el diff antes de commitear.

**`expo export --platform android` ≠ ejecutar en el teléfono.** El primero solo produce el bundle JS y
prueba que Metro resuelve los alias; no compila código nativo ni instala nada. Detalle en
`VALIDATION.md` §1.3.

## 8. Lo que falta para poder probar en el teléfono

Los puntos 1–4 originales (JDK 17 + `JAVA_HOME`, `ANDROID_HOME`, firewall del 5000, dispositivo con
depuración USB) **están cumplidos desde 2026-10-02**; ver la tabla de §2. Siguen abiertos:

1. Probar en el **Samsung A16 5G** (hasta ahora solo un moto z3).
2. Cliente OAuth de Android registrado con el SHA-1 de debug (§6) — solo para probar Google.
