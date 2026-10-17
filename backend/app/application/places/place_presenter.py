# Serialización de lugares (ADR-040-thers-places.md §4.3). Solo se exponen campos
# respaldados por datos reales: `rating_average`/`reviews_count` salen de las reseñas
# (fase 4a; `null`/0 sin reseñas, nunca un valor inventado) y no hay `is_open` hasta que
# existan horarios. `is_saved` existe desde la fase 2 (guardados): es `false`
# para quien no ha iniciado sesión, que es la verdad (no ha guardado nada).


from app.application.media.media_url import media_url


def _category(row):
    return {
        "id": str(row["category_id"]),
        "slug": row["category_slug"],
        "name": row["category_name"],
    }


def _iso(value):
    return value.isoformat() if value else None


def _average(value):
    return None if value is None else float(value)


def present_category(row):
    return {"id": str(row["id"]), "slug": row["slug"], "name": row["name"]}


def present_summary(row):
    data = {
        "id": str(row["id"]),
        "name": row["name"],
        "slug": row["slug"],
        "category": _category(row),
        "latitude": row["latitude"],
        "longitude": row["longitude"],
        "verification_status": row["verification_status"],
        "address": row["address"],
        # Todavía no hay fotos de lugares (fase 4).
        "cover_image_url": None,
        "is_saved": bool(row["is_saved"]),
        "rating_average": _average(row["rating_average"]),
        "reviews_count": int(row["reviews_count"]),
    }
    if "distance_meters" in row:
        data["distance_meters"] = round(row["distance_meters"])
    return data


def present_detail(row):
    data = present_summary(row)
    data.update(
        {
            "description": row["description"],
            "municipality": row["municipality"],
            "department": row["department"],
            "phone": row["phone"],
            "website": row["website"],
            "source": row["source"],
            "coordinate_source": row["coordinate_source"],
            "last_verified_at": _iso(row["last_verified_at"]),
            # Fase 6: si el lugar ya tiene gestor y si lo eres tú.
            "is_claimed": bool(row.get("is_claimed", False)),
            "managed_by_me": bool(row.get("managed_by_me", False)),
            # Fase 8: el lugar acepta solicitudes de reserva.
            "accepts_reservations": bool(row.get("accepts_reservations", False)),
        }
    )
    return data


def present_admin(row):
    """Vista de moderación: el detalle más el estado interno. Nunca incluye datos de
    contacto de quien creó o verificó, solo sus ids."""
    row = {**row, "is_saved": False}
    data = present_detail(row)
    del data["is_saved"]
    data.update(
        {
            "is_active": row["is_active"],
            "created_by_user_id": str(row["created_by_user_id"]) if row["created_by_user_id"] else None,
            "verified_by_user_id": str(row["verified_by_user_id"]) if row["verified_by_user_id"] else None,
            "created_at": _iso(row["created_at"]),
            "updated_at": _iso(row["updated_at"]),
        }
    )
    return data


def present_own_report(row):
    """Lo que ve quien reportó: confirmación, sin datos internos."""
    return {
        "id": str(row["id"]),
        "place_id": str(row["place_id"]),
        "reason": row["reason"],
        "status": row["status"],
        "created_at": _iso(row["created_at"]),
    }


def present_moderation_report(row):
    """Vista de moderación de un reporte. No expone quién reportó."""
    return {
        "id": str(row["id"]),
        "place": {
            "id": str(row["place_id"]),
            "name": row["place_name"],
            "slug": row["place_slug"],
            "verification_status": row["place_status"],
            "is_active": row["place_is_active"],
        },
        "reason": row["reason"],
        "details": row["details"],
        "status": row["status"],
        "created_at": _iso(row["created_at"]),
        "resolved_at": _iso(row["resolved_at"]),
        "resolution_note": row["resolution_note"],
    }


def present_resolved_report(row):
    return {
        "id": str(row["id"]),
        "place_id": str(row["place_id"]),
        "reason": row["reason"],
        "status": row["status"],
        "resolved_at": _iso(row["resolved_at"]),
        "resolution_note": row["resolution_note"],
    }


def present_images(images):
    """Fotos públicas: URL, dimensiones e id (para que su dueño pueda quitarlas). Nunca la
    clave interna ni quién la subió."""
    return [
        {"id": str(i["id"]), "url": media_url(i["storage_key"]), "width": i["width"], "height": i["height"]}
        for i in (images or [])
    ]


def present_review(row):
    """Una reseña con su autor (campos públicos). `hidden` solo aparece en la propia: es
    la forma de avisar a su autor de que la moderación la ocultó."""
    data = {
        "id": str(row["id"]),
        "rating": row["rating"],
        "body": row["body"],
        "created_at": _iso(row["created_at"]),
        "updated_at": _iso(row["updated_at"]),
        "is_mine": bool(row["is_mine"]),
        "images": present_images(row.get("images")),
        # Respuesta pública del negocio (fase 7), o None.
        "reply": (
            {
                "body": row["reply_body"],
                "created_at": _iso(row["reply_created_at"]),
                "updated_at": _iso(row["reply_updated_at"]),
            }
            if row.get("reply_body") is not None
            else None
        ),
        "author": {
            "id": str(row["author_id"]),
            "username": row["author_username"],
            "name": row["author_name"],
            "avatar_url": media_url(row["author_avatar_path"]),
        },
    }
    if row["is_mine"]:
        data["hidden"] = bool(row["is_hidden"])
    return data


def present_own_review(row, images=None):
    """Respuesta al escribir: la reseña recién guardada, sin autor (es la propia)."""
    return {
        "id": str(row["id"]),
        "place_id": str(row["place_id"]),
        "rating": row["rating"],
        "body": row["body"],
        "created_at": _iso(row["created_at"]),
        "updated_at": _iso(row["updated_at"]),
        "images": present_images(images),
    }
