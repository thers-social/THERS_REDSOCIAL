# Plan de Pull Requests — pila de moderación, Historias, n8n y Reels

Estado: borrador (2026-10-18). Todas las ramas están **solo en local**; este plan no se ha ejecutado.
Cada PR se abre contra `develop` en el orden de la tabla; los que van apilados se abren contra la
rama anterior mientras la anterior no esté fusionada, y se re-apuntan a `develop` al fusionar.
Todo el código nuevo queda detrás de flags apagados por defecto (`.env.example`). Ningún ADR de este
plan está ratificado por el Comité Técnico (`HB-001` §11–12): los PR llevan el aviso.

| Orden | Rama | Base | Commits | Contenido |
|---|---|---|---|---|
| 1 | `feature/stories-integration` | `develop` | 15 | Historias (ADR-042) detrás de `STORIES_ENABLED` |
| 2 | `feature/moderation-core` | `develop` | 1 | Motor de moderación, estados, trabajos y auditoría (ADR-044) |
| 3 | `feature/moderation-panel` | rama 2 | +2 | Panel, apelaciones y roles |
| 4 | `feature/moderation-ai-text` | rama 3 | +2 | Clasificación de texto vía `AiProvider` (ADR-045) |
| 5 | `feature/stories-moderation` | ramas 1 y 4 | +merge | Historias moderadas y archivos privados |
| 6 | `feature/n8n-automation` | rama 5 | +1 | Capa n8n (outbox), apagada |
| 7 | `feature/reels-mux` | rama 6 | +1 | Reels sobre Mux (ADR-043-A), subida pública bloqueada |
| — | `docs/moderation-ratification-pack` | `develop` | docs | Paquete de ratificación ADR-044/045 |
| — | `chore/stage8-verification` | rama 7 | +1 | Arreglo de lint en un test y este plan |

## Verificación (Etapa 8, sobre la rama 7)
Backend 878 pruebas pasadas (PostgreSQL 16 real); web 159 pruebas, lint 0 errores, build correcto;
móvil typecheck limpio y 251 pruebas; migraciones desde cero a un único head `e1f7c3b9a526`, con
downgrade y upgrade de las dos últimas revisiones, en una base desechable.

## Cada descripción debe incluir
- «Closes #N» del Issue que corresponda y el prefijo del título (`feat:`).
- Flag que lo gobierna y su valor por defecto (apagado).
- Aviso: ADR en estado «propuesto, no ratificado».
- Qué NO se probó: Mux real, `expo-video` en teléfono, clasificador de imágenes.
- Revisor humano distinto del autor (`HB-001` §9).
