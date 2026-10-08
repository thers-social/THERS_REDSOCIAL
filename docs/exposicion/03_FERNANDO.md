# Guion — Fernando (9 min): Móvil, Handbook, conexión, servicios y estructura

## 1. App móvil Android (3 min)
- **Pila:** React Native con Expo y TypeScript. Es la cuarta aplicación del monorepo, independiente de las otras.
- **Qué hace:** login con segundo factor, publicaciones, perfil, chat, ajustes y eliminación de cuenta (según lo que esté fusionado).
- **Sesión:** access de 15 minutos y refresh de 30 días con renovación automática (`ADR-017`). Si arranca sin red, muestra la pantalla «Sin conexión».
- **Verificada en un teléfono real** (moto z3, 2026-10-02). Pendiente repetir en el Samsung A16 5G.
- **Demo sugerida:** teléfono conectado: iniciar sesión, publicar y abrir el chat. Tiene la sesión ya iniciada de antemano.
- **Honestidad:** los `.jsx` de la web no se reutilizan (son DOM y Tailwind). Lo que sí se comparte son módulos puros: validadores, textos y formateadores.

## 2. Handbook (1,5 min)
- Es el **THERS Engineering Handbook**: documentación de ingeniería del equipo hecha con React, Vite y MDX.
- No contiene código de producto y no depende del backend.
- Sirve para que cualquiera entienda cómo trabajamos y para incorporar gente nueva.
- Sigue su propia cascada: `ARC-001` → `DS-001` → `WF-001` → `PV-001` → `FAS-001`.

## 3. Cómo el frontend se conecta con el backend (1,5 min)
- Un único cliente HTTP, `Frontend/src/shared/lib/api.js`, basado en Axios.
- La URL del backend sale de la variable `VITE_API_URL` (nunca escrita en el código).
- El contrato de cada endpoint está en `API_CONTRACT.md`; el cliente y el servidor se ponen de acuerdo ahí.
- El token viaja en el encabezado `Authorization: Bearer`.

## 4. Servicios que utilizamos (1 min)
- **Correo:** Resend, con Reply-To a soporte.
- **Dominio y enrutado de correo:** Cloudflare (`thersweb.com`).
- **Base de datos en desarrollo:** PostgreSQL en Docker.
- **Pendiente de contratar o decidir:** hosting y base de datos en la nube (lo explica Cristopher).

## 5. Estructura, escalabilidad y documentación (1,5 min)
- Organización **por dominio** (`features/auth`, `features/feed`…), no por tipo de archivo.
- **Alias de import** (`@features`, `@shared`) para no depender de rutas relativas.
- Tokens de diseño en un solo lugar.
- **Documentación viva:** documentos de arquitectura del backend, de la base de datos, del frontend y de la API, además de un ADR por cada decisión importante.
- Cada área documenta lo implementado y lo pendiente por separado, sin mezclarlos.
- El código lleva comentarios que explican el porqué, no solo el qué.

## 6. Seguridad del cliente (30 s)
- En el móvil, los tokens van en **almacenamiento seguro** (`SecureStore`).
- La única variable del bundle (`EXPO_PUBLIC_API_URL`) **no lleva secretos**, porque queda embebida en la app.
- Honestidad: la web todavía no usa el refresh token, así que su sesión caduca a los 15 minutos.

## Lista de preparación de Fernando
- [ ] Teléfono con la app instalada y la sesión iniciada; cable o Wi-Fi probados.
- [ ] Backend accesible desde el teléfono (misma red).
- [ ] Handbook levantado con `npm run dev` en `handbook/`, o capturas.
- [ ] Captura de la estructura de carpetas para la diapositiva.
- [ ] Cronometrar: máximo 9 minutos.
