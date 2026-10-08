# Guion — Oscar Piche (13 min): Apertura y web funcional

## Parte 1 — Apertura (4 min)

**Qué decir**
1. «Somos THERS, un equipo autogestionado de 4 personas que construye una red social.»
2. **Pila tecnológica:** React, Vite y Tailwind en el cliente; Flask y PostgreSQL en el servidor; JWT para las sesiones.
3. **Qué hay hoy:** una web, una app Android, un backend y el Handbook de ingeniería.
4. **Cómo trabajamos:** ramas por tarea, Pull Request con al menos una aprobación humana (nadie aprueba lo suyo) y decisiones importantes registradas como ADR (`HB-001`).
5. **Anuncia el orden:** «Ahora les muestro lo que se puede hacer en la web. Después Diego explica el backend y cómo protegemos los datos, Fernando la app móvil, el Handbook y cómo se conecta todo, y Cristopher la infraestructura y lo que sigue.»

**Pantalla:** diapositiva de mapa: web · móvil · backend · Handbook · docs.

## Parte 2 — Demo en vivo (9 min)

Usa **cuentas de prueba ya creadas** (una principal y una segunda en otro navegador o ventana privada). No uses cuentas reales.

| Min | Paso | Qué hacer | Qué decir |
|---|---|---|---|
| 0:00 | **Registro** | Abrir `/register`, crear una cuenta, mostrar el código de verificación recibido por correo, completar perfil | «El registro exige verificar el correo con un código. Después se completa el perfil.» |
| 1:00 | **Login con 2FA** | Cerrar sesión, entrar de nuevo con una cuenta que tenga 2FA activado | «Si la cuenta tiene segundo factor, se pide el código antes de entrar.» (Dos opciones: login normal y Google, si está configurado en el entorno) |
| 2:00 | **Publicar** | En Inicio, escribir una publicación y publicarla | «Esto va contra el backend real, no es una maqueta.» |
| 2:45 | **Me gusta y comentarios** | Dar «me gusta», comentar, mencionar a la segunda cuenta | «Las menciones generan notificación.» |
| 3:45 | **Perfil** | Ir a `/profile`, abrir editar perfil: bio, foto y portada | «Foto, portada y bio se guardan en el servidor.» |
| 4:30 | **Seguir** | Con la segunda cuenta, seguir a la primera | «En una cuenta privada, el seguimiento pasa por solicitud.» |
| 5:15 | **Búsqueda** | `/search`, buscar la cuenta de prueba | «Busca personas y contenido.» |
| 5:45 | **Mensajes** | `/messages`, mandar un mensaje entre las dos cuentas; mostrar «escribiendo» y borrar uno | «Es chat directo. Se actualiza por consulta periódica, no es en tiempo real todavía.» |
| 6:45 | **Notificaciones** | `/notifications`, mostrar las de menciones y seguidores, marcar como leída | — |
| 7:15 | **Privacidad y seguridad** | `/settings`: cuenta privada, quién te menciona y quién te escribe, bloquear, silenciar palabras, sesiones activas, 2FA, exportar datos | «La persona decide quién la ve y quién le escribe. Puede cerrar sesiones abiertas y exportar sus datos.» |
| 8:30 | **Idioma** | Cambiar entre español e inglés | — |
| 8:50 | **Cierre del turno** | Pasar la palabra | «Ahora Diego les explica cómo funciona todo esto por dentro.» |

## Lo que NO debe presentarse como funcional
Si alguien lo abre o pregunta, se responde con honestidad: «está en desarrollo».
- **Momentos, barra «Pulse» y página Descubrir:** son datos de ejemplo (en pantalla dice «ejemplo»).
- **Cápsulas, Radar y Videos:** módulos pendientes.
- **Blog, Popular, Ubicaciones, Importar contactos:** «próximamente».
- **Suscripción, facturación y verificación de creador (Ajustes):** es maqueta. No habrá pagos en la primera versión. **Decidir antes de la demo si se oculta esa sección.**
- **Eliminar cuenta, aceptación de términos, reportes y página de seguridad infantil:** solo mostrarlos si sus ramas ya están fusionadas en `develop`.

## Lista de preparación de Oscar
- [ ] Backend y base de datos levantados; `Frontend` apuntando a ellos (`VITE_API_URL`).
- [ ] Dos cuentas de prueba verificadas; una con 2FA activado.
- [ ] Una publicación y una conversación de ejemplo ya cargadas, por si falla algo en vivo.
- [ ] Bandeja de correo de pruebas abierta en otra pestaña (para el código de registro).
- [ ] Probar el inicio con Google antes. Si no está configurado en esa máquina, omitirlo.
- [ ] Capturas de cada paso como plan B.
- [ ] Cronometrar el turno: máximo 13 minutos.
