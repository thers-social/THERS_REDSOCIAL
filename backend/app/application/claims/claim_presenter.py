# Forma pública de un reclamo (ADR-040 fase 6). Nunca viaja la clave del documento: quien
# modera recibe una URL firmada por separado.


def _iso(value):
    return value.isoformat() if value is not None else None


def present_claim(row, place_card):
    return {
        "id": str(row["id"]),
        "place": place_card,
        "business_name": row["business_name"],
        "contact_phone": row["contact_phone"],
        "message": row["message"],
        "status": row["status"],
        "review_note": row["review_note"],
        "created_at": _iso(row["created_at"]),
        "reviewed_at": _iso(row["reviewed_at"]),
    }


def present_for_review(row):
    base = {
        "id": str(row["id"]),
        "place_id": str(row["place_id"]),
        "place_name": row.get("place_name"),
        "municipality": row.get("municipality"),
        "claimant": {
            "id": str(row["claimant_id"]),
            "username": row.get("claimant_username"),
            "name": row.get("claimant_name"),
        },
        "business_name": row["business_name"],
        "contact_phone": row["contact_phone"],
        "message": row["message"],
        "status": row["status"],
        "has_document": bool(row["document_key"]),
        "document_content_type": row["document_content_type"],
        "review_note": row["review_note"],
        "created_at": _iso(row["created_at"]),
        "reviewed_at": _iso(row["reviewed_at"]),
    }
    return base
