# Forma pública de la tarjeta de un lugar adjunto a un mensaje (fase 4c) o a una
# publicación (fase 4d). Nunca lleva coordenadas, teléfono ni estado de verificación.


def to_place_card(place_id, cards):
    """Tarjeta del lugar `place_id`, o None si el contenido no lleva lugar. Un lugar que ya
    no es público se muestra como no disponible: solo su id, nunca nombre ni ubicación (la
    ficha pudo retirarse por una razón de moderación)."""
    if place_id is None:
        return None
    card = (cards or {}).get(str(place_id))
    if card is None:
        return {"id": str(place_id), "available": False}
    return {
        "id": str(card["id"]),
        "available": True,
        "name": card["name"],
        "category": {"slug": card["category_slug"], "name": card["category_name"]},
        "municipality": card["municipality"],
        "department": card["department"],
    }
