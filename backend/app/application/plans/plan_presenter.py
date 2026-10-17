# Forma pública de un plan (ADR-040 fase 5). Del lugar solo viaja la tarjeta mínima
# (misma que en chat y publicaciones); de las personas, solo id, username, name y avatar.

from app.application.media.media_url import media_url
from app.application.places.place_card import to_place_card
from app.domain.plans import kinds


def _iso(value):
    return value.isoformat() if value is not None else None


def _person(user_id, username, name, avatar_path):
    return {
        "id": str(user_id),
        "username": username,
        "name": name,
        "avatar_url": media_url(avatar_path),
    }


def present_friend(row):
    return _person(row["id"], row["username"], row["name"], row["avatar_path"])


def present_plan(row, members, cards):
    people = [
        {
            **_person(m["user_id"], m["username"], m["name"], m["avatar_path"]),
            "status": m["status"],
        }
        for m in members
    ]
    counts = {kinds.MEMBER_GOING: 0, kinds.MEMBER_INVITED: 0, kinds.MEMBER_DECLINED: 0}
    for person in people:
        counts[person["status"]] += 1
    return {
        "id": str(row["id"]),
        "title": row["title"],
        "note": row["note"],
        "starts_at": _iso(row["starts_at"]),
        "status": row["status"],
        "place": to_place_card(row["place_id"], cards),
        "creator": _person(
            row["creator_id"],
            row["creator_username"],
            row["creator_name"],
            row["creator_avatar_path"],
        ),
        "my_status": row["my_status"],
        "members": people,
        "counts": counts,
        "created_at": _iso(row["created_at"]),
        "updated_at": _iso(row["updated_at"]),
    }
