"""Router de proveedores de respuesta IA (plan §5.1 y §7.1).

Construye la cadena de proveedores a partir de :class:`CompanyContextBundle`
(habilitados y ordenados por ``order``), consulta una caché tenant-aware y, si el
proveedor primario falla (timeout, 401, quota, …), hace *fallback* al siguiente
registrando ``bot.provider.fallback``. Nunca propaga excepciones de proveedor:
ante un fallo total escala a atención humana (fail-safe, plan §7.1).
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
import uuid
from abc import ABC, abstractmethod
from collections import OrderedDict
from collections.abc import Sequence
from typing import Any

from app.bot.context_bundle import CompanyContextBundle
from app.bot.interfaces import (
    BotResponse,
    ConversationContext,
    IResponseProvider,
    ProviderConfig,
)
from app.bot.providers.llm_provider import LlmResponseProvider
from app.bot.providers.local_provider import LocalResponseProvider
from app.core.logging import ILogger

_NO_PROVIDERS_MESSAGE = (
    "Lo siento, el bot no tiene proveedores de respuesta configurados para esta "
    "empresa. Un asesor te atenderá en breve."
)

_ALL_FAILED_MESSAGE = (
    "Lo siento, no pude generar una respuesta en este momento. "
    "Un asesor te atenderá en breve."
)


class IBotResponseCache(ABC):
    """Puerto de caché de respuestas del bot (tenant-aware por clave)."""

    @abstractmethod
    def get(self, key: str) -> BotResponse | None:
        """Devuelve la respuesta en caché o ``None`` si no existe / caducó."""

    @abstractmethod
    def set(self, key: str, value: BotResponse, *, ttl_seconds: float | None = None) -> None:
        """Guarda una respuesta con TTL opcional (``None`` = sin expiración)."""


class LruBotResponseCache(IBotResponseCache):
    """Caché LRU thread-safe con expiración por TTL (``time.monotonic``).

    Espejo de :class:`LruAiResponseCache` tipado a :class:`BotResponse` para que
    la caché del bot sea independiente de la de generación de landings.
    """

    def __init__(self, *, max_entries: int = 512) -> None:
        if max_entries < 1:
            raise ValueError("max_entries debe ser >= 1")
        self._max_entries = max_entries
        self._store: OrderedDict[str, tuple[float, BotResponse]] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: str) -> BotResponse | None:
        """Devuelve la respuesta en caché o ``None`` si no existe / caducó."""
        with self._lock:
            item = self._store.get(key)
            if item is None:
                return None
            expires_at, value = item
            if expires_at <= time.monotonic():
                del self._store[key]
                return None
            self._store.move_to_end(key)
            return value

    def set(self, key: str, value: BotResponse, *, ttl_seconds: float | None = None) -> None:
        """Guarda una respuesta con TTL opcional (``None`` = sin expiración)."""
        with self._lock:
            if key in self._store:
                del self._store[key]
            if ttl_seconds is None:
                expires_at = float("inf")
            else:
                expires_at = time.monotonic() + ttl_seconds
            self._store[key] = (expires_at, value)
            while len(self._store) > self._max_entries:
                self._store.popitem(last=False)


class ResponseProviderRouter(IResponseProvider):
    """Router de proveedores: selección por empresa + fallback + caché."""

    def __init__(
        self,
        bundle: CompanyContextBundle,
        *,
        base_url: str,
        timeout_seconds: float,
        default_model: str,
        cache: IBotResponseCache | None = None,
        cache_ttl_seconds: float = 3600.0,
        logger: ILogger | None = None,
    ) -> None:
        self._bundle = bundle
        self._base_url = base_url.rstrip("/")
        self._timeout_seconds = timeout_seconds
        self._default_model = default_model
        self._cache = cache
        self._cache_ttl_seconds = cache_ttl_seconds
        self._logger = logger
        self._chain = self._build_chain()

    @property
    def kind(self) -> str:
        return "router"

    @property
    def name(self) -> str:
        return "router"

    def _build_chain(self) -> tuple[tuple[ProviderConfig, IResponseProvider], ...]:
        """Construye la cadena de proveedores habilitados y ordenados por ``order``."""
        chain: list[tuple[ProviderConfig, IResponseProvider]] = []
        ordered = sorted(
            (cfg for cfg in self._bundle.providers if cfg.enabled),
            key=lambda cfg: cfg.order,
        )
        for cfg in ordered:
            provider = self._build_provider(cfg)
            if provider is not None:
                chain.append((cfg, provider))
        return tuple(chain)

    def _build_provider(self, cfg: ProviderConfig) -> IResponseProvider | None:
        """Crea el proveedor para la config o ``None`` si el tipo no está soportado."""
        if cfg.provider_kind == "llm":
            return LlmResponseProvider(
                base_url=self._base_url,
                model=cfg.model or self._default_model,
                temperature=cfg.temperature,
                prompt_base=cfg.prompt_base or self._bundle.prompt_base,
                api_key=cfg.api_key,
                content_items=self._bundle.content_items,
                catalog_items=self._bundle.catalog_items,
                timeout_seconds=self._timeout_seconds,
                logger=self._logger,
            )
        if cfg.provider_kind == "local":
            return LocalResponseProvider(
                content_items=self._bundle.content_items,
                catalog_items=self._bundle.catalog_items,
                prompt_base=cfg.prompt_base or self._bundle.prompt_base,
                logger=self._logger,
            )
        self._log(
            "warning",
            "bot.provider.unsupported_kind",
            "Tipo de proveedor no soportado; se omite de la cadena",
            provider_kind=cfg.provider_kind,
            provider_id=str(cfg.provider_id),
        )
        return None

    def _providers_signature(self) -> str:
        """Firma estable de la cadena para invalidar la caché ante cambios."""
        return "|".join(
            f"{cfg.provider_id}:{cfg.provider_kind}:{cfg.model or ''}:{cfg.prompt_base}"
            for cfg, _ in self._chain
        )

    def respond(
        self,
        *,
        user_message: str,
        conversation_context: ConversationContext,
    ) -> BotResponse:
        """Selecciona el proveedor primario y hace fallback ante errores."""
        if not self._chain:
            self._log(
                "warning",
                "bot.provider.no_providers",
                "No hay proveedores habilitados para la empresa",
            )
            return self._no_providers_response()

        key = _cache_key(
            tenant_id=conversation_context.tenant_id,
            providers_signature=self._providers_signature(),
            user_message=user_message,
            history=conversation_context.history,
        )
        if self._cache is not None:
            cached = self._cache.get(key)
            if cached is not None:
                self._log(
                    "info",
                    "bot.provider.cache_hit",
                    "Respuesta servida desde la caché",
                )
                return cached

        last_error: str | None = None
        for cfg, provider in self._chain:
            self._log(
                "info",
                "bot.provider.selected",
                "Proveedor seleccionado",
                provider_kind=cfg.provider_kind,
                provider_used=provider.name,
                order=cfg.order,
            )
            try:
                response = provider.respond(
                    user_message=user_message,
                    conversation_context=conversation_context,
                )
            except Exception as exc:
                last_error = f"{type(exc).__name__}: {exc}"
                self._log(
                    "warning",
                    "bot.provider.fallback",
                    "Fallo del proveedor; se prueba el siguiente",
                    provider_kind=cfg.provider_kind,
                    provider_used=provider.name,
                    error=last_error,
                )
                continue
            if not response.needs_human and self._cache is not None:
                self._cache.set(key, response, ttl_seconds=self._cache_ttl_seconds)
            return response

        self._log(
            "error",
            "bot.provider.failed",
            "Todos los proveedores fallaron; se escala a atención humana",
            last_error=last_error,
        )
        return self._all_failed_response(last_error)

    @staticmethod
    def _no_providers_response() -> BotResponse:
        return BotResponse(
            content=_NO_PROVIDERS_MESSAGE,
            provider_kind="router",
            provider_used="router",
            needs_human=True,
            metadata={"reason": "no_providers"},
        )

    @staticmethod
    def _all_failed_response(last_error: str | None) -> BotResponse:
        return BotResponse(
            content=_ALL_FAILED_MESSAGE,
            provider_kind="router",
            provider_used="router",
            needs_human=True,
            metadata={"reason": "all_providers_failed", "last_error": last_error},
        )

    def close(self) -> None:
        """Cierra los recursos de los proveedores de la cadena (regla CLAUDE: DI)."""
        for _, provider in self._chain:
            closer = getattr(provider, "close", None)
            if callable(closer):
                closer()

    def _log(self, level: str, event: str, message: str, **fields: Any) -> None:
        if self._logger is None:
            return
        getattr(self._logger, level)(event, message, **fields)


def _cache_key(
    *,
    tenant_id: uuid.UUID,
    providers_signature: str,
    user_message: str,
    history: Sequence[dict[str, str]],
) -> str:
    """Clave estable tenant-aware de una respuesta (sha256)."""
    history_serialized = json.dumps(
        list(history),
        sort_keys=True,
        ensure_ascii=True,
        separators=(",", ":"),
    )
    raw = (
        f"{tenant_id}|{providers_signature}|{history_serialized}|{user_message}"
        .strip()
        .lower()
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def build_response_provider_router(
    bundle: CompanyContextBundle,
    *,
    base_url: str,
    timeout_seconds: float,
    default_model: str,
    cache_ttl_seconds: float = 3600.0,
    cache: IBotResponseCache | None = None,
    logger: ILogger | None = None,
) -> ResponseProviderRouter:
    """Fábrica DI del router de proveedores (regla CLAUDE: sin ``new`` en el dominio)."""
    return ResponseProviderRouter(
        bundle,
        base_url=base_url,
        timeout_seconds=timeout_seconds,
        default_model=default_model,
        cache=cache,
        cache_ttl_seconds=cache_ttl_seconds,
        logger=logger,
    )
