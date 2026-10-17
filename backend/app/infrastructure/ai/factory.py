# Fábrica del proveedor de IA de Tero (ADR-041 §3). Un solo punto decide cuál se usa, igual que
# `infrastructure/routing/factory.py`. El estado vive en `app.extensions`: cada aplicación (y cada
# prueba) tiene el suyo, y las pruebas inyectan un proveedor simulado.

from app.infrastructure.ai.anthropic_provider import AnthropicProvider

_KEY = "thers_tero"


def create_provider(config):
    """`None` si no hay clave: la IA queda sin proveedor en vez de fallar al arrancar."""
    api_key = config.get("ANTHROPIC_API_KEY")
    if not api_key:
        return None
    return AnthropicProvider(
        api_key, config.get("TERO_MODEL"), config.get("TERO_AI_TIMEOUT_SECONDS")
    )


def tero_provider(app):
    state = app.extensions.get(_KEY)
    if state is None:
        state = {"provider": create_provider(app.config)}
        app.extensions[_KEY] = state
    return state["provider"]
