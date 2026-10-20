# Token de acceso a LiveKit. Es un JWT HS256 firmado con el API secret del proyecto de LiveKit Cloud;
# no hace falta el SDK de LiveKit, solo PyJWT (ya instalado como dependencia de Flask-JWT-Extended).
# El API secret vive solo en el servidor: al cliente solo llega este token, de una sola sala y con
# caducidad corta.

import time

import jwt

TOKEN_TTL_SECONDS = 2 * 60 * 60


def build_room_token(api_key, api_secret, room, identity, name):
    now = int(time.time())
    claims = {
        "iss": api_key,
        "sub": identity,
        "name": name,
        "nbf": now,
        "exp": now + TOKEN_TTL_SECONDS,
        "video": {
            "roomJoin": True,
            "room": room,
            "canPublish": True,
            "canSubscribe": True,
            "canPublishData": True,
        },
    }
    return jwt.encode(claims, api_secret, algorithm="HS256")
