"""Proveedor LLM OpenAI-compatible (openrouter/deepseek) para el bot.

Construye un prompt de sistema con ``prompt_base`` + contenido + catálogo
(grounding) y delega la respuesta a ``/chat/completions``. La falta de API key,
los errores HTTP, de parseo o de forma lanzan :class:`DependencyError` con
etapa, para que el router haga *fallback* al siguiente proveedor (plan §7.1).
"""

from __future__ import annotations

from collections.abc import Sequence
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx

from app.bot.interfaces import BotResponse, ConversationContext, IResponseProvider
from app.core.errors import DependencyError
from app.core.logging import ILogger

_DEFAULT_SYSTEM_PROMPT = (
    "Eres el asistente virtual de esta empresa. Responde de forma breve, "
    "cordial y en español, usando solo la información proporcionada."
)

_MAX_HISTORY = 10


def _format_price(price: Any, currency: str = "MXN") -> str:
    """Formatea un precio de forma tolerante (Decimal -> 2 decimales + moneda)."""
    if price is None:
        return ""
    try:
        amount = Decimal(str(price))
    except (InvalidOperation, TypeError, ValueError):
        return ""
    currency = currency.strip().upper() if currency else ""
    formatted = f"{amount:.2f}"
    return f"{formatted} {currency}".strip()


class LlmResponseProvider(IResponseProvider):
    """Proveedor LLM compatible OpenAI (openrouter/deepseek) por empresa."""

    def __init__(
        self,
        *,
        base_url: str,
        model: str,
        temperature: Decimal | None,
        prompt_base: str,
        api_key: str,
        content_items: Sequence[dict[str, Any]] = (),
        catalog_items: Sequence[dict[str, Any]] = (),
        timeout_seconds: float = 30.0,
        logger: ILogger | None = None,
        client: httpx.Client | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._model = model
        self._temperature = temperature
        self._prompt_base = prompt_base
        self._api_key = api_key
        self._content_items = tuple(content_items)
        self._catalog_items = tuple(catalog_items)
        self._timeout_seconds = timeout_seconds
        self._logger = logger
        self._client = client
        self._owns_client = client is None

    @property
    def kind(self) -> str:
        return "llm"

    @property
    def name(self) -> str:
        return self._model

    def _get_client(self) -> httpx.Client:
        """Devuelve el cliente HTTP, creándolo de forma perezosa si hace falta."""
        if self._client is None:
            self._client = httpx.Client(timeout=httpx.Timeout(self._timeout_seconds))
        return self._client

    def close(self) -> None:
        """Cierra el cliente solo si la instancia lo posee (regla CLAUDE: DI)."""
        if self._owns_client and self._client is not None:
            self._client.close()

    def _build_system_prompt(self) -> str:
        """Compone el prompt de sistema: base + contenido + catálogo (grounding)."""
        parts = [self._prompt_base.strip() or _DEFAULT_SYSTEM_PROMPT]

        content_lines: list[str] = []
        for item in self._content_items:
            title = str(item.get("title") or item.get("question") or "").strip()
            content = str(item.get("content") or item.get("answer") or "").strip()
            if title and content:
                content_lines.append(f"- {title}: {content}")
        if content_lines:
            parts.append("Información de la empresa (última actualización):")
            parts.extend(content_lines)

        catalog_lines: list[str] = []
        for item in self._catalog_items:
            name = str(item.get("name") or "").strip()
            if not name:
                continue
            sku = str(item.get("sku") or "").strip()
            price = _format_price(item.get("price"), str(item.get("currency") or "MXN"))
            suffix = f" ({sku})" if sku else ""
            price_part = f" — {price}" if price else ""
            catalog_lines.append(f"- {name}{suffix}{price_part}")
        if catalog_lines:
            parts.append("Catálogo disponible:")
            parts.extend(catalog_lines)

        return "\n".join(parts)

    def respond(
        self,
        *,
        user_message: str,
        conversation_context: ConversationContext,
    ) -> BotResponse:
        """Genera la respuesta vía el LLM con grounding de la empresa."""
        if not self._api_key.strip():
            raise DependencyError(
                "Falta API key para el proveedor LLM",
                operation="bot.provider.respond",
                context={"reason": "api_key_missing", "provider": self.name},
            )

        messages: list[dict[str, str]] = [
            {"role": "system", "content": self._build_system_prompt()}
        ]
        for turn in conversation_context.history[-_MAX_HISTORY:]:
            role = str(turn.get("role") or "")
            content = str(turn.get("content") or "").strip()
            if role not in {"user", "assistant"} or not content:
                continue
            messages.append({"role": role, "content": content})
        messages.append({"role": "user", "content": user_message})

        payload: dict[str, Any] = {"model": self._model, "messages": messages}
        if self._temperature is not None:
            payload["temperature"] = float(self._temperature)

        url = f"{self._base_url}/chat/completions"
        try:
            response = self._get_client().post(
                url,
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise DependencyError(
                f"Fallo al llamar al LLM ({self._model}): {exc}",
                operation="bot.provider.respond",
                context={
                    "stage": "http",
                    "provider": self.name,
                    "status_code": getattr(
                        getattr(exc, "response", None), "status_code", None
                    ),
                },
                cause=exc,
            ) from exc

        try:
            data = response.json()
        except ValueError as exc:
            raise DependencyError(
                f"El LLM ({self._model}) devolvió una respuesta no JSON",
                operation="bot.provider.respond",
                context={"stage": "parse", "provider": self.name},
                cause=exc,
            ) from exc

        try:
            content = data["choices"][0]["message"]["content"]
            usage = data.get("usage") or {}
            prompt_tokens = int(usage.get("prompt_tokens", 0))
            completion_tokens = int(usage.get("completion_tokens", 0))
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise DependencyError(
                f"El LLM ({self._model}) devolvió una estructura inesperada",
                operation="bot.provider.respond",
                context={"stage": "shape", "provider": self.name},
                cause=exc,
            ) from exc

        self._log(
            "info",
            "bot.provider.llm.responded",
            "Respuesta LLM generada",
            model=self._model,
            tokens_used=completion_tokens,
        )
        return BotResponse(
            content=str(content),
            provider_kind=self.kind,
            provider_used=self.name,
            tokens_used=completion_tokens,
            metadata={
                "model": self._model,
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
            },
        )

    def _log(self, level: str, event: str, message: str, **fields: Any) -> None:
        if self._logger is None:
            return
        getattr(self._logger, level)(event, message, **fields)
