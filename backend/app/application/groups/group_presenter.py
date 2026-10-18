# Forma pública de los chats grupales (ADR-048).

from app.application.auth.user_presenter import to_author_summary


def to_public_member(membership):
    return {**to_author_summary(membership.user), "role": membership.role}


def to_public_group(group, members, my_membership):
    return {
        "id": str(group.id),
        "name": group.name,
        "created_at": group.created_at.isoformat(),
        "my_role": my_membership.role,
        "members": [to_public_member(m) for m in members],
    }


def to_public_group_summary(row, my_role_by_group=None):
    """Una fila de la lista de grupos: el último mensaje se resume igual que en la lista de chats
    directos (qué clase de contenido lleva, sin su texto completo ni sus adjuntos)."""
    group = row["group"]
    last = row["last_message"]
    return {
        "id": str(group.id),
        "name": group.name,
        "member_count": row["member_count"],
        "unread_count": row["unread_count"],
        "last_message": (
            {
                "content": last.content,
                "has_image": bool(last.images),
                "has_audio": last.audio is not None,
                "has_video": last.video is not None,
                "has_place": last.place_id is not None,
                "has_post": last.post_id is not None,
                "sender_id": str(last.sender_id),
                "sender_name": last.sender.name,
                "created_at": last.created_at.isoformat(),
            }
            if last is not None
            else None
        ),
        "created_at": group.created_at.isoformat(),
    }
