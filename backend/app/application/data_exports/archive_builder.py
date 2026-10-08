# Arma el ZIP de la exportación (ADR-028-data-export.md). Solo biblioteca
# estándar: recibe el dict que produce `DataExportRepository.collect_user_data`
# y devuelve bytes. Cada sección es un `.json` legible por una persona, más un
# LEEME.txt que explica qué hay y qué se dejó fuera a propósito.

import io
import json
import zipfile

_README = """\
Copia de tus datos de THERS
===========================

Generada el {generated_at} para @{username}.

Contenido (un archivo JSON por sección):
  profile.json         Tu cuenta, tus preferencias de privacidad y seguridad.
  posts.json           Tus publicaciones.
  comments.json        Tus comentarios.
  likes.json           Publicaciones a las que diste like.
  following.json       Cuentas que seguís, con el estado de cada solicitud.
  followers.json       Cuentas que te siguen, con el estado de cada solicitud.
  messages.json        Mensajes directos que enviaste y recibiste.
  notifications.json   Notificaciones que recibiste.
  muted_keywords.json  Palabras que silenciaste.
  muted_topics.json    Temas que silenciaste.
  restrictions.json    Cuentas que bloqueaste o restringiste.
  sessions.json        Dispositivos desde los que iniciaste sesión.
  saved_places.json    Lugares que guardaste.
  place_reports.json   Reportes de datos incorrectos de lugares que hiciste.

Qué NO incluye, a propósito:
  - Tu contraseña (ni su hash) ni el secreto de tu autenticación en dos pasos.
  - Los identificadores internos de tus sesiones.
  - Las publicaciones de otras personas, salvo lo que ya figura en tus
    mensajes y notificaciones.

Este archivo no está cifrado: guardalo en un lugar seguro. El enlace de
descarga caduca a los {ttl_days} días.
"""


def _dump(value):
    return json.dumps(value, ensure_ascii=False, indent=2).encode("utf-8")


def build_archive(data, generated_at, ttl_days):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            "LEEME.txt",
            _README.format(
                generated_at=generated_at.strftime("%d/%m/%Y %H:%M UTC"),
                username=data["profile"]["username"],
                ttl_days=ttl_days,
            ).encode("utf-8"),
        )
        for section, value in data.items():
            archive.writestr(f"{section}.json", _dump(value))
    return buffer.getvalue()
