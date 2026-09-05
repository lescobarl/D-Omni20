"""Proveedores de respuesta IA del bot (Fase 4).

Re-exporta las implementaciones de :class:`IResponseProvider` y la fábrica DI
para que el resto del subsistema bot use solo estos símbolos (regla CLAUDE: DI).
"""

from app.bot.providers.llm_provider import LlmResponseProvider
from app.bot.providers.local_provider import LocalResponseProvider
from app.bot.providers.router import (
    IBotResponseCache,
    LruBotResponseCache,
    ResponseProviderRouter,
    build_response_provider_router,
)

__all__ = [
    "IBotResponseCache",
    "LlmResponseProvider",
    "LocalResponseProvider",
    "LruBotResponseCache",
    "ResponseProviderRouter",
    "build_response_provider_router",
]
