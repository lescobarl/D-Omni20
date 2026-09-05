"""Proveedor local determinista: replica el comportamiento actual de OmniBot_IA.

Selecciona el mejor ``content_item`` por puntuación frente al mensaje del
usuario (reglas + ``content_items``), con claves tolerantes (``title``/``question``
y ``content``/``answer``) y normalización sin acentos. Si no hay coincidencia,
responde con necesidad de atención humana (escalamiento) listando el catálogo.
"""

from __future__ import annotations

import unicodedata
from collections.abc import Sequence
from decimal import Decimal, InvalidOperation
from typing import Any

from app.bot.interfaces import BotResponse, ConversationContext, IResponseProvider
from app.core.logging import ILogger

_GREETING_WORDS = frozenset(
    {
        "hola",
        "buenas",
        "buenos dias",
        "buenas tardes",
        "buenas noches",
        "saludos",
        "que tal",
    }
)

_MENU_KEYWORDS = frozenset(
    {
        "menu",
        "catalogo",
        "productos",
        "servicios",
        "precios",
        "precio",
        "informacion",
    }
)

_MENU_KINDS = frozenset({"menu", "help", "catalogo", "productos", "servicios"})

_FALLBACK_KINDS = frozenset({"fallback", "default"})

_MAX_CATALOG_ITEMS_IN_ESCALATION = 5


def _normalize(value: str) -> str:
    """Normaliza texto: sin acentos, en minúsculas y con espacios colapsados."""
    decomposed = unicodedata.normalize("NFD", value.lower())
    stripped = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    return " ".join(stripped.split())


def _item_title(item: dict[str, Any]) -> str:
    return str(item.get("title") or item.get("question") or "").strip()


def _item_content(item: dict[str, Any]) -> str:
    return str(item.get("content") or item.get("answer") or "").strip()


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


def _score_item(
    item: dict[str, Any],
    message: str,
    message_words: frozenset[str],
) -> int:
    """Puntúa la relevancia de un ``content_item`` frente al mensaje normalizado."""
    title = _normalize(_item_title(item))
    kind = _normalize(str(item.get("kind") or ""))
    tags = frozenset(
        _normalize(tag) for tag in (item.get("tags") or []) if str(tag).strip()
    )

    score = 0
    if title and title == message:
        score += 10
    if title and title in message:
        score += 5
    if title and len(title) >= 3 and message in title:
        score += 4
    score += 3 * len(message_words & tags)
    if kind == "greeting" and message_words & _GREETING_WORDS:
        score += 8
    if kind in _MENU_KINDS and message_words & _MENU_KEYWORDS:
        score += 6
    return score


def _build_escalation_message(catalog_items: Sequence[dict[str, Any]]) -> str:
    """Mensaje de escalamiento humano con un extracto del catálogo disponible."""
    catalog_lines: list[str] = []
    for item in catalog_items:
        if len(catalog_lines) >= _MAX_CATALOG_ITEMS_IN_ESCALATION:
            break
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        sku = str(item.get("sku") or "").strip()
        price = _format_price(item.get("price"), str(item.get("currency") or "MXN"))
        suffix = f" ({sku})" if sku else ""
        price_part = f" — {price}" if price else ""
        catalog_lines.append(f"• {name}{suffix}{price_part}")

    lines = ["Lo siento, no pude resolver tu consulta. Un asesor te atenderá en breve."]
    if catalog_lines:
        lines.append("Mientras tanto, esto es parte de nuestro catálogo:")
        lines.extend(catalog_lines)
    return "\n".join(lines)


class LocalResponseProvider(IResponseProvider):
    """Proveedor determinista basado en reglas y ``content_items`` (OmniBot_IA)."""

    def __init__(
        self,
        *,
        content_items: Sequence[dict[str, Any]] = (),
        catalog_items: Sequence[dict[str, Any]] = (),
        prompt_base: str = "",
        logger: ILogger | None = None,
    ) -> None:
        self._content_items = tuple(content_items)
        self._catalog_items = tuple(catalog_items)
        self._prompt_base = prompt_base
        self._logger = logger

    @property
    def kind(self) -> str:
        return "local"

    @property
    def name(self) -> str:
        return "local"

    def respond(
        self,
        *,
        user_message: str,
        conversation_context: ConversationContext,
    ) -> BotResponse:
        """Devuelve la mejor coincidencia local o escala a atención humana."""
        best_item: dict[str, Any] | None = None
        best_score = 0
        message = _normalize(user_message)
        message_words = frozenset(message.split())

        for item in self._content_items:
            kind = _normalize(str(item.get("kind") or ""))
            if kind in _FALLBACK_KINDS:
                continue
            score = _score_item(item, message, message_words)
            if score > best_score:
                best_score = score
                best_item = item

        if best_item is not None and best_score > 0:
            content = _item_content(best_item) or _item_title(best_item)
            self._log(
                "info",
                "bot.provider.local.match",
                "Coincidencia local encontrada",
                score=best_score,
                title=_item_title(best_item),
            )
            return BotResponse(
                content=content,
                provider_kind=self.kind,
                provider_used=self.name,
                metadata={"matched": "content", "score": best_score},
            )

        fallback_item = next(
            (
                item
                for item in self._content_items
                if _normalize(str(item.get("kind") or "")) in _FALLBACK_KINDS
            ),
            None,
        )
        if fallback_item is not None:
            content = _item_content(fallback_item) or _item_title(fallback_item)
            self._log(
                "info",
                "bot.provider.local.fallback",
                "Sin coincidencia, se usa el contenido de respaldo",
            )
            return BotResponse(
                content=content,
                provider_kind=self.kind,
                provider_used=self.name,
                metadata={"matched": "fallback"},
            )

        self._log(
            "info",
            "bot.provider.local.escalation",
            "Sin coincidencia, se escala a atención humana",
        )
        return BotResponse(
            content=_build_escalation_message(self._catalog_items),
            provider_kind=self.kind,
            provider_used=self.name,
            needs_human=True,
            metadata={"matched": "none"},
        )

    def _log(self, level: str, event: str, message: str, **fields: Any) -> None:
        if self._logger is None:
            return
        getattr(self._logger, level)(event, message, **fields)
