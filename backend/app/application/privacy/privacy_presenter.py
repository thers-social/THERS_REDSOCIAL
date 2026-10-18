# Forma pública de las preferencias de privacidad, devuelta por
# GET/PATCH /api/users/me/privacy (ADR-022-private-accounts.md,
# ADR-023-mentions.md, ADR-024-content-filters-and-privacy-preferences.md).
#
# Endpoint propio y no parte de `PATCH /api/users/me` (ADR-003): ese contrato
# es el del perfil público (nombre, username, teléfono) y tiene reglas que no
# aplican acá (el cooldown de 30 días del username, el 409 por duplicado).
# Mezclarlos obligaría a una whitelist de doce campos con dos juegos de reglas
# de validación en la misma route (ADR-024 §Opciones consideradas).
#
# `muted_keywords` NO viaja acá: es una colección con su propio ciclo de vida
# (se agregan y quitan de a uno), no una preferencia escalar. Vive en
# GET/POST/DELETE /api/users/me/muted-keywords.


def to_privacy_settings(user, pending_follow_requests_count=0):
    return {
        # ADR-022
        "is_private": user.is_private,
        # Cuántas solicitudes esperan respuesta. Va acá y no en `user` porque
        # solo tiene sentido junto al interruptor que las produce -- si la
        # cuenta deja de ser privada, lo que quede pendiente sigue visible
        # desde esta misma pantalla (ADR-022 §Decisión).
        "pending_follow_requests_count": pending_follow_requests_count,
        # ADR-023
        "who_can_mention": user.who_can_mention,
        # ADR-024
        "who_can_message": user.who_can_message,
        "hide_offensive_comments": user.hide_offensive_comments,
        "show_activity_status": user.show_activity_status,
        # ADR-030-content-preferences.md
        "hide_sensitive_content": user.hide_sensitive_content,
        # ADR-041 §7: resumen semanal de actividad por correo.
        "weekly_summary_email": user.weekly_summary_email,
        # Solo el propio dueño ve este endpoint, así que acá `last_seen_at` sí
        # se expone aunque tenga la actividad oculta -- lo que oculta
        # `show_activity_status` es que lo vean LOS DEMÁS (ADR-024 §Seguridad).
        # A diferencia de `edited`/`read`, acá sí viaja el timestamp: es un
        # dato de la propia persona sobre sí misma, no una señal sobre otro.
        "last_seen_at": user.last_seen_at.isoformat() if user.last_seen_at else None,
    }
