"""Borra los datos técnicos que superaron su plazo de conservación (90 días).

ADR-037-data-retention.md. Pensado para un trabajo programado diario (por ejemplo,
un Cron Job de Render con `python scripts/purge_expired_data.py`).

Imprime SOLO conteos por tabla: nunca IPs, agentes de usuario ni correos.

Uso (desde `backend/`, con `DATABASE_URL` apuntando a la base):

    python scripts/purge_expired_data.py
"""

import os
import sys

# Permite correr el script desde `backend/` sin instalar el paquete.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import create_app  # noqa: E402
from app.application.retention.purge_use_case import purge_expired_data  # noqa: E402
from app.application.stories.story_use_cases import purge_expired_stories  # noqa: E402
from app.domain.retention.policy import SESSION_RETENTION_DAYS  # noqa: E402
from app.infrastructure.persistence.repositories.retention_repository import (  # noqa: E402
    SQLAlchemyRetentionRepository,
)
from app.infrastructure.persistence.repositories.story_repository import (  # noqa: E402
    SQLAlchemyStoryRepository,
)


def main():
    app = create_app()
    with app.app_context():
        counts = purge_expired_data(SQLAlchemyRetentionRepository())
        # Historias vencidas (ADR-042): filas y archivos. Aparte porque necesita el almacenamiento.
        counts["stories"] = purge_expired_stories(
            SQLAlchemyStoryRepository(), app.extensions["media_storage"],
            private_storage=app.extensions.get("private_storage"),
        )
    print(f"Plazo de conservación: {SESSION_RETENTION_DAYS} días. Filas borradas:")
    for table, count in counts.items():
        print(f"  {table}: {count}")


if __name__ == "__main__":
    main()
