# PR — Integrar Historias (ADR-042) sobre `develop`, con flag apagado

> Borrador del Pull Request. **No se ha hecho `push` ni se ha abierto el PR.** Rama:
> `feature/stories-integration` → `develop`. Título propuesto con el prefijo de commit de `HB-001`:
> `feat: integrate 24-hour Stories on develop behind STORIES_ENABLED (off by default)`.

## Qué resuelve

Historias (ADR-042) estaba en tres ramas encadenadas (`feature/stories`, `-web`, `-mobile`) que ya no
se podían fusionar limpiamente: `develop` incorporó Tero (PR #99) y chocaban tres archivos y las
migraciones de Alembic. Este PR las integra **sin reescribir sus commits** y añade un interruptor
para que no queden activas por accidente.

## Cambios

- **Integración** de las tres ramas, en orden, con tres conflictos resueltos conservando ambos lados:
  `models.py`, `tests/conftest.py` y `API_CONTRACT.md` (Historias pasa a **v0.60, §4.38**, porque Tero ya
  usaba 0.57–0.59 y §4.37).
- **Migración de unión** `c8dcd63b24d4` (vacía). Cabeza única. No se editó ninguna migración existente.
- **Flag `STORIES_ENABLED`, apagado por defecto** (código y `backend/.env.example`). Apagado, las seis
  rutas responden `404 {"msg": "Recurso no encontrado"}` con o sin sesión, antes de autenticar.
- Web y móvil **ocultan la tira** cuando el servidor responde ese 404.
- Documentación: `API_CONTRACT.md` v0.60, `DATABASE_ARCHITECTURE.md` v0.43, `ADR-042-stories.md` §11 y
  `docs/mobile/STORIES_LOCAL_TESTING.md`.
- Corrección de lint: el helper `portrait` quedó sin uso al reemplazar la fila de ejemplo.

**No se modificó ningún archivo de Tero.**

## Verificación ejecutada (2026-10-17/18)

| Prueba | Resultado |
|---|---|
| Backend completo (PostgreSQL 16 real, base desechable) | **2032 pasaron, 0 fallaron, 0 omitidas** |
| Historias (incluye 5 del flag encendido/apagado) | 35 pasaron |
| Web: `npm test`, `npm run build` | 120 pasaron; build correcto |
| Móvil: `typecheck`, `npm test` | sin errores; 236 pasaron |
| Alembic: base vacía, estado de `develop`, estado de Historias | llegan a `c8dcd63b24d4` |
| Alembic: `downgrade` con destino explícito | sin pérdida de tablas; ver límites en ADR-042 §11 |
| Funcional en vivo (backend real, 58 comprobaciones) | 58 de 58 |
| Web en un navegador real (login, subir, visor) | correcto, sin errores de JavaScript |

## Pendiente (NO aprobado)

- [ ] **Pruebas manuales en Android (Samsung A16 5G y moto z3): PENDIENTES.** El teléfono está ocupado.
      No están canceladas ni aprobadas. La app exige **recompilar** (`expo-image-picker` es nativo).
- [ ] CI de GitHub: no consultado (sin `gh`).
- [ ] Revisión humana distinta del autor (`HB-001`).
- [ ] Lint web: 1 error **que ya existe en `develop`** (`tests/moderation.test.mjs`, regla `no-control-regex`).
- [ ] `expo-doctor` 20/21: 5 paquetes Expo con parche más nuevo; ya ocurría en `develop`.

## Riesgos conocidos (por eso el flag sigue apagado)

1. **Bucket público:** quien tenga la URL de la imagen la abre sin sesión, también de una cuenta
   privada y también vencida hasta que la purga borre el archivo (hasta 6 h más).
2. **Sin `moderation_status`:** lo publicado se ve sin revisión previa (ver `ADR-044`).
3. **Sin reporte de tipo `story`** (`ADR-032`).
4. **Sin solución de seguridad infantil** evaluada (D3 de `ADR-043`).
5. Una cuenta **restringida** sigue viendo historias; solo el bloqueo las oculta (decisión pendiente).

## Reversión

Apagar `STORIES_ENABLED` (sin despliegue) o revertir el merge. No se baja el esquema: las tablas son
aditivas y Alembic no permite bajar solo Historias sin bajar Tero (ver ADR-042 §11).

## Checklist para quien revisa

- [ ] `flask db heads` devuelve una sola cabeza (`c8dcd63b24d4`).
- [ ] `git diff origin/develop` no muestra cambios en `application/tero`, `domain/tero`,
      `infrastructure/ai`, `tero_routes.py` ni `mobile/src/features/tero`.
- [ ] `STORIES_ENABLED` vale `false` en `config.py` y en `.env.example`.
- [ ] Sin secretos, `console.log` ni `print` olvidados.
- [ ] `API_CONTRACT.md` en v0.60 sin colisión de secciones.
- [ ] Probar en Android antes de **activar** el flag en cualquier entorno.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
