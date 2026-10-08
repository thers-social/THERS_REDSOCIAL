# Serialización de lugares (ADR-040-thers-places.md §4.3). Solo se exponen campos
# respaldados por datos reales: no hay `rating`, `reviews_count` ni `is_open` hasta que
# existan reseñas y horarios. `is_saved` existe desde la fase 2 (guardados): es `false`
# para quien no ha iniciado sesión, que es la verdad (no ha guardado nada).


def _category(row):
    return {
        "id": str(row["category_id"]),
        "slug": row["category_slug"],
        "name": row["category_name"],
    }


def _iso(value):
    return value.isoformat() if value else None


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
