# Ajustes de la moderación de contenido ya leídos de la configuración. application/ no importa
# Flask: quien llama (la route, el comando del worker) arma esto desde `current_app.config`.

from app.domain.content_moderation.policy import Thresholds


class ModerationSettings:
    __slots__ = ("enabled", "thresholds", "max_attempts", "backoff_base", "lease_seconds")

    def __init__(self, enabled=False, thresholds=None, max_attempts=5, backoff_base=30,
                 lease_seconds=300):
        self.enabled = enabled
        self.thresholds = thresholds or Thresholds()
        self.max_attempts = max_attempts
        self.backoff_base = backoff_base
        self.lease_seconds = lease_seconds


def settings_from_config(config):
    return ModerationSettings(
        enabled=bool(config.get("MODERATION_ENABLED")),
        thresholds=Thresholds(
            doubt=config.get("MODERATION_DOUBT_THRESHOLD", 0.40),
            severe=config.get("MODERATION_SEVERE_THRESHOLD", 0.85),
            new_account_doubt=config.get("MODERATION_NEW_ACCOUNT_DOUBT_THRESHOLD", 0.10),
            new_account_days=config.get("MODERATION_NEW_ACCOUNT_DAYS", 7),
            hold_all_new=bool(config.get("MODERATION_HOLD_ALL_NEW_ACCOUNTS")),
        ),
        max_attempts=config.get("MODERATION_MAX_ATTEMPTS", 5),
        backoff_base=config.get("MODERATION_BACKOFF_SECONDS", 30),
        lease_seconds=config.get("MODERATION_LEASE_SECONDS", 300),
    )
