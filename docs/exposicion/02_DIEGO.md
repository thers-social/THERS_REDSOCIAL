# Guion — Diego Medina (14 min): Backend y seguridad

## Parte 1 — Backend (8 min)

### 1. Arquitectura por capas (1,5 min)
- `domain/`: reglas del negocio, sin dependencias externas.
- `application/`: casos de uso (registrar, iniciar sesión, publicar…).
- `infrastructure/`: base de datos, correo, almacenamiento.
- `interfaces/routes/`: las rutas HTTP de Flask.
- **Por qué:** se puede cambiar la base de datos o el proveedor de correo sin tocar las reglas.

### 2. Flujo de una petición (1,5 min)
Usa el login como ejemplo: ruta → caso de uso → repositorio → PostgreSQL → respuesta JSON.
- Pantalla sugerida: un diagrama de cuatro cajas, o abrir `auth_routes.py` y su caso de uso.

### 3. Base de datos (1,5 min)
- PostgreSQL con SQLAlchemy.
- **Migraciones con Alembic:** cada cambio de esquema es una migración versionada. Siempre hay **un solo `head`**.
- Tablas principales: usuarios, publicaciones, me gusta, comentarios, seguidores, notificaciones, mensajes, sesiones, reportes.

### 4. API (1 min)
- `docs/architecture/API_CONTRACT.md` es la fuente única del contrato HTTP.
- Regla del equipo: cada endpoint nuevo se documenta el mismo día.

### 5. Herramientas (1 min) — **Diego completa esto con su flujo real**
> Cuenta aquí cómo pruebas el backend: Postman y los demás programas que usas, y para qué sirve cada uno. Ejemplos de lo que conviene decir: cómo pruebas un endpoint, cómo ves la base de datos, cómo corres las migraciones.

### 6. Pruebas (1,5 min)
- `pytest` contra **PostgreSQL real**, sin simulaciones (mocks).
- En la rama de integración pasan **854 pruebas** (verificado el 2026-10-02). Verifica la cifra el día de la exposición:
  ```
  cd backend && python -m pytest
  ```
  Tarda unos 33 minutos: córrela el día anterior, no en vivo.

## Parte 2 — Seguridad y protección de las personas (6 min)

### Contraseñas y códigos (1 min)
- Las contraseñas y los códigos de un solo uso se guardan con hash (scrypt), **nunca en texto plano**.

### Sesiones (1 min)
- Access token de **15 minutos** y refresh token rotativo de **30 días** (`ADR-017`).
- Cerrar sesión invalida el token en el servidor.
- El usuario ve sus sesiones activas y puede cerrarlas.

### Acceso (1 min)
- Segundo factor (2FA) y verificación por código de correo.
- Límites de uso por IP y por cuenta contra fuerza bruta y abuso.
- Las respuestas no revelan si un correo existe.

### Privacidad (1,5 min)
- **Solo mayores de 18**, validado en el servidor.
- **Eliminación de cuenta** con confirmación por correo y por escrito; borra publicaciones, mensajes y sesiones.
- **Retención de datos:** los datos de sesión se purgan a los 90 días.
- Cuenta privada, bloqueos, restricciones y exportación de datos.

### Seguridad infantil (1 min)
- Categoría de reporte «Explotación o abuso de menores» con **prioridad crítica**, que decide el servidor (el cliente no puede bajarla).
- Página pública de estándares de seguridad infantil.

### Honestidad (0,5 min)
- «Hoy se puede reportar y priorizar. El **panel de moderación todavía no existe**.»
- La verificación de edad es declarativa (fecha de nacimiento), no documental.
- Los textos legales son borradores pendientes de revisión por un abogado.

**Importante:** presenta como «implementado» solo lo que esté fusionado en `develop` el día de la exposición. Reportes, seguridad infantil, eliminación de cuenta, mínimo de 18 años y retención de datos están en ramas con PR abiertos (ver `docs/BRANCH_AND_PR_PLAN.md`).

## Lista de preparación de Diego
- [ ] Diagrama de capas y de flujo de una petición.
- [ ] Postman con una colección lista (login, publicar, ver perfil).
- [ ] Suite de pruebas corrida el día anterior, con captura del resultado.
- [ ] Confirmar qué ramas están fusionadas para no afirmar de más.
- [ ] Cronometrar: máximo 14 minutos.
