"""Pruebas de los proveedores de respuesta IA del bot (Fase 4).

Cubre el proveedor local determinista (reglas + ``content_items``), el proveedor
LLM OpenAI-compatible (grounding + etapas de error) y el router (selección por
empresa, fallback, caché tenant-aware y escalamiento a atención humana).
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Sequence
from decimal import Decimal
from typing import Any

import httpx
import pytest
from app.bot.context_bundle import CompanyContextBundle
from app.bot.interfaces import BotResponse, ConversationContext, ProviderConfig
from app.bot.providers import (
    LlmResponseProvider,
    LocalResponseProvider,
    LruBotResponseCache,
    ResponseProviderRouter,
    build_response_provider_router,
)
from app.bot.providers.router import _cache_key
from app.core.errors import DependencyError
from app.core.logging import ILogger

_FAKE_LLM_PAYLOAD: dict[str, Any] = {
    "choices": [{"message": {"content": "Hola, ¿en qué puedo ayudarte?"}}],
    "usage": {"prompt_tokens": 25, "completion_tokens": 12},
}


class _RecordingLogger(ILogger):
    """Logger en memoria que acumula eventos ``(event, message, fields)``."""

    def __init__(self) -> None:
        self.events: list[tuple[str, str, dict[str, Any]]] = []

    def _record(self, event: str, message: str, fields: dict[str, Any]) -> None:
        self.events.append((event, message, fields))

    def debug(self, event: str, message: str = "", **fields: Any) -> None:
        self._record(event, message, fields)

    def info(self, event: str, message: str = "", **fields: Any) -> None:
        self._record(event, message, fields)

    def warning(self, event: str, message: str = "", **fields: Any) -> None:
        self._record(event, message, fields)

    def error(self, event: str, message: str = "", **fields: Any) -> None:
        self._record(event, message, fields)

    def critical(self, event: str, message: str = "", **fields: Any) -> None:
        self._record(event, message, fields)

    def exception(self, event: str, message: str = "", **fields: Any) -> None:
        self._record(event, message, fields)


class _FakeResponse:
    """Respuesta HTTP falsa con la superficie que usa el proveedor LLM (httpx)."""

    def __init__(
        self,
        payload: Any,
        status_code: int = 200,
        *,
        json_error: Exception | None = None,
    ) -> None:
        self._payload = payload
        self._status_code = status_code
        self._json_error = json_error

    def raise_for_status(self) -> None:
        return None

    def json(self) -> Any:
        if self._json_error is not None:
            raise self._json_error
        return self._payload


class _FakeClient:
    """Cliente httpx falso que registra llamadas y devuelve una respuesta dada."""

    def __init__(
        self,
        response: _FakeResponse | None = None,
        *,
        error: Exception | None = None,
    ) -> None:
        self._response = response
        self._error = error
        self.calls: list[dict[str, Any]] = []

    def post(
        self,
        url: str,
        *,
        headers: dict[str, str],
        json: dict[str, Any],
    ) -> _FakeResponse:
        self.calls.append({"url": url, "headers": headers, "json": json})
        if self._error is not None:
            raise self._error
        assert self._response is not None
        return self._response

    def close(self) -> None:
        return None


class _TrackingClient(_FakeClient):
    """Cliente falso con flag de cierre para verificar la propiedad del cliente."""

    def __init__(
        self,
        response: _FakeResponse | None = None,
        *,
        error: Exception | None = None,
    ) -> None:
        super().__init__(response, error=error)
        self.closed = False

    def close(self) -> None:
        self.closed = True


def _provider_config(
    *,
    provider_kind: str = "local",
    order: int = 1,
    enabled: bool = True,
    model: str | None = None,
    temperature: Decimal | None = None,
    prompt_base: str = "",
    api_key: str = "",
    provider_id: uuid.UUID | None = None,
) -> ProviderConfig:
    return ProviderConfig(
        provider_id=provider_id or uuid.uuid4(),
        provider_kind=provider_kind,
        order=order,
        enabled=enabled,
        model=model,
        temperature=temperature,
        prompt_base=prompt_base,
        api_key=api_key,
    )


def _bundle(
    *,
    providers: Sequence[ProviderConfig] = (),
    content_items: Sequence[dict[str, Any]] = (),
    catalog_items: Sequence[dict[str, Any]] = (),
    prompt_base: str = "",
    tenant_id: uuid.UUID | None = None,
    channel_id: uuid.UUID | None = None,
) -> CompanyContextBundle:
    return CompanyContextBundle(
        tenant_id=tenant_id or uuid.uuid4(),
        channel_id=channel_id or uuid.uuid4(),
        channel_type="whatsapp",
        prompt_base=prompt_base,
        providers=tuple(providers),
        content_items=tuple(content_items),
        catalog_items=tuple(catalog_items),
    )


def _context(
    *,
    tenant_id: uuid.UUID | None = None,
    provider: ProviderConfig | None = None,
    history: Sequence[dict[str, str]] = (),
) -> ConversationContext:
    return ConversationContext(
        tenant_id=tenant_id or uuid.uuid4(),
        conversation_id=uuid.uuid4(),
        channel_id=uuid.uuid4(),
        external_contact_id="contact-1",
        provider=provider or _provider_config(),
        history=tuple(history),
    )


def _make_llm(
    *,
    api_key: str = "test-key",
    model: str = "deepseek-chat",
    temperature: Decimal | None = Decimal("0.7"),
    prompt_base: str = "Eres el asistente de Mi Empresa.",
    content_items: Sequence[dict[str, Any]] = (),
    catalog_items: Sequence[dict[str, Any]] = (),
    client: _FakeClient | None = None,
    logger: ILogger | None = None,
) -> LlmResponseProvider:
    return LlmResponseProvider(
        base_url="https://api.example.com/v1",
        model=model,
        temperature=temperature,
        prompt_base=prompt_base,
        api_key=api_key,
        content_items=content_items,
        catalog_items=catalog_items,
        logger=logger,
        client=client,
    )


def _make_router(
    *,
    providers: Sequence[ProviderConfig],
    content_items: Sequence[dict[str, Any]] = (),
    catalog_items: Sequence[dict[str, Any]] = (),
    cache: LruBotResponseCache | None = None,
    cache_ttl_seconds: float = 3600.0,
    logger: ILogger | None = None,
) -> ResponseProviderRouter:
    bundle = _bundle(
        providers=providers,
        content_items=content_items,
        catalog_items=catalog_items,
    )
    return build_response_provider_router(
        bundle,
        base_url="https://api.example.com/v1",
        timeout_seconds=30.0,
        default_model="deepseek-chat",
        cache=cache,
        cache_ttl_seconds=cache_ttl_seconds,
        logger=logger,
    )


def _patch_llm_client(monkeypatch: pytest.MonkeyPatch, client: _FakeClient) -> None:
    """Sustituye ``httpx.Client`` por un falso para los clientes propietarios."""
    monkeypatch.setattr(httpx, "Client", lambda **kwargs: client)


# ---------------------------------------------------------------------------
# Caché LRU + TTL (LruBotResponseCache)
# ---------------------------------------------------------------------------


def test_bot_cache_set_get_roundtrip() -> None:
    cache = LruBotResponseCache(max_entries=8)
    response = BotResponse(content="Hola", provider_kind="local")
    cache.set("a", response)
    assert cache.get("a") == response


def test_bot_cache_get_missing_returns_none() -> None:
    cache = LruBotResponseCache(max_entries=8)
    assert cache.get("missing") is None


def test_bot_cache_ttl_expires_entries() -> None:
    cache = LruBotResponseCache(max_entries=8)
    cache.set("a", BotResponse(content="Hola"), ttl_seconds=0.01)
    time.sleep(0.02)
    assert cache.get("a") is None


def test_bot_cache_lru_evicts_least_recently_used() -> None:
    cache = LruBotResponseCache(max_entries=2)
    cache.set("a", BotResponse(content="A"))
    cache.set("b", BotResponse(content="B"))
    cache.set("c", BotResponse(content="C"))
    assert cache.get("a") is None
    assert cache.get("b") == BotResponse(content="B")
    assert cache.get("c") == BotResponse(content="C")


def test_bot_cache_rejects_invalid_max_entries() -> None:
    with pytest.raises(ValueError):
        LruBotResponseCache(max_entries=0)


# ---------------------------------------------------------------------------
# Clave de caché tenant-aware
# ---------------------------------------------------------------------------


def test_cache_key_is_tenant_aware() -> None:
    key_a = _cache_key(
        tenant_id=uuid.uuid4(),
        providers_signature="sig",
        user_message="hola",
        history=(),
    )
    key_b = _cache_key(
        tenant_id=uuid.uuid4(),
        providers_signature="sig",
        user_message="hola",
        history=(),
    )
    assert key_a != key_b


def test_cache_key_is_stable_and_signature_aware() -> None:
    tenant = uuid.uuid4()
    history = ({"role": "user", "content": "hola"},)
    first = _cache_key(
        tenant_id=tenant, providers_signature="sig", user_message="hola", history=history
    )
    again = _cache_key(
        tenant_id=tenant, providers_signature="sig", user_message="hola", history=history
    )
    other_sig = _cache_key(
        tenant_id=tenant,
        providers_signature="sig2",
        user_message="hola",
        history=history,
    )
    other_msg = _cache_key(
        tenant_id=tenant,
        providers_signature="sig",
        user_message="adios",
        history=history,
    )
    assert first == again
    assert first != other_sig
    assert first != other_msg


# ---------------------------------------------------------------------------
# Proveedor local determinista
# ---------------------------------------------------------------------------


def test_local_exact_title_match() -> None:
    provider = LocalResponseProvider(
        content_items=[{"kind": "faq", "title": "Horario", "content": "Atendemos de 9 a 18."}]
    )
    response = provider.respond(user_message="horario", conversation_context=_context())
    assert response.provider_kind == "local"
    assert response.metadata["matched"] == "content"
    assert "9 a 18" in response.content


def test_local_canonical_question_answer_keys() -> None:
    provider = LocalResponseProvider(
        content_items=[{"kind": "faq", "question": "Horario", "answer": "Atendemos de 9 a 18."}]
    )
    response = provider.respond(user_message="horario", conversation_context=_context())
    assert response.metadata["matched"] == "content"
    assert "9 a 18" in response.content


def test_local_tag_and_greeting_scoring() -> None:
    provider = LocalResponseProvider(
        content_items=[
            {"kind": "greeting", "title": "Saludo", "content": "Bienvenido, ¿en qué puedo ayudarte?"},
            {"kind": "faq", "title": "Horario", "content": "Atendemos de 9 a 18.", "tags": ["hola"]},
        ]
    )
    response = provider.respond(user_message="hola", conversation_context=_context())
    assert "Bienvenido" in response.content


def test_local_fallback_kind_used_when_no_match() -> None:
    provider = LocalResponseProvider(
        content_items=[{"kind": "fallback", "title": "No entendí", "content": "No entendí tu consulta, intenta de nuevo."}]
    )
    response = provider.respond(user_message="xyzabc", conversation_context=_context())
    assert response.metadata["matched"] == "fallback"
    assert response.needs_human is False
    assert "No entendí" in response.content


def test_local_no_match_escalates_with_catalog() -> None:
    provider = LocalResponseProvider(
        catalog_items=[{"name": "Plan Básico", "price": "199.50", "currency": "MXN", "sku": "PB-1"}]
    )
    response = provider.respond(user_message="xyzabc", conversation_context=_context())
    assert response.needs_human is True
    assert response.metadata["matched"] == "none"
    assert "Plan Básico" in response.content
    assert "199.50 MXN" in response.content


# ---------------------------------------------------------------------------
# Proveedor LLM OpenAI-compatible
# ---------------------------------------------------------------------------


def test_llm_sends_payload_with_grounding() -> None:
    client = _FakeClient(_FakeResponse(_FAKE_LLM_PAYLOAD))
    provider = _make_llm(
        client=client,
        content_items=[{"title": "Horario", "content": "Atendemos de 9 a 18."}],
        catalog_items=[{"name": "Plan Básico", "price": "199.50"}],
    )
    history = (
        {"role": "user", "content": "¿precio?"},
        {"role": "assistant", "content": "El plan básico cuesta 199."},
    )
    response = provider.respond(
        user_message="¿cuánto cuesta?",
        conversation_context=_context(history=history),
    )

    assert len(client.calls) == 1
    payload = client.calls[0]["json"]
    assert payload["model"] == "deepseek-chat"
    assert payload["temperature"] == 0.7
    system = payload["messages"][0]["content"]
    assert "Eres el asistente de Mi Empresa." in system
    assert "Horario" in system
    assert "Plan Básico" in system
    roles = [m["role"] for m in payload["messages"]]
    assert roles == ["system", "user", "assistant", "user"]
    assert payload["messages"][-1]["content"] == "¿cuánto cuesta?"
    assert client.calls[0]["headers"]["Authorization"] == "Bearer test-key"

    assert response.tokens_used == 12
    assert response.provider_kind == "llm"
    assert response.provider_used == "deepseek-chat"
    assert "Hola, ¿en qué puedo ayudarte?" in response.content


def test_llm_omits_temperature_when_not_configured() -> None:
    client = _FakeClient(_FakeResponse(_FAKE_LLM_PAYLOAD))
    provider = _make_llm(temperature=None, client=client)
    provider.respond(user_message="hola", conversation_context=_context())
    assert "temperature" not in client.calls[0]["json"]


def test_llm_filters_history_roles_and_blank_content() -> None:
    client = _FakeClient(_FakeResponse(_FAKE_LLM_PAYLOAD))
    provider = _make_llm(client=client)
    history = (
        {"role": "system", "content": "ignorado"},
        {"role": "user", "content": ""},
        {"role": "user", "content": "primera"},
        {"role": "assistant", "content": "respuesta"},
        {"role": "assistant", "content": "   "},
    )
    provider.respond(user_message="hola", conversation_context=_context(history=history))
    messages = client.calls[0]["json"]["messages"]
    roles = [m["role"] for m in messages]
    assert roles == ["system", "user", "assistant", "user"]
    assert all(m["content"].strip() for m in messages[1:])
    assert messages[-1]["content"] == "hola"


def test_llm_missing_api_key_raises_dependency_error() -> None:
    provider = _make_llm(api_key="   ", client=_FakeClient(_FakeResponse(_FAKE_LLM_PAYLOAD)))
    with pytest.raises(DependencyError) as exc_info:
        provider.respond(user_message="hola", conversation_context=_context())
    assert exc_info.value.context["reason"] == "api_key_missing"


def test_llm_http_error_raises_dependency_error() -> None:
    provider = _make_llm(client=_FakeClient(error=httpx.ConnectError("boom")))
    with pytest.raises(DependencyError) as exc_info:
        provider.respond(user_message="hola", conversation_context=_context())
    assert exc_info.value.context["stage"] == "http"


def test_llm_parse_error_raises_dependency_error() -> None:
    provider = _make_llm(
        client=_FakeClient(_FakeResponse(_FAKE_LLM_PAYLOAD, json_error=ValueError("no json")))
    )
    with pytest.raises(DependencyError) as exc_info:
        provider.respond(user_message="hola", conversation_context=_context())
    assert exc_info.value.context["stage"] == "parse"


def test_llm_shape_error_raises_dependency_error() -> None:
    provider = _make_llm(client=_FakeClient(_FakeResponse({"choices": []})))
    with pytest.raises(DependencyError) as exc_info:
        provider.respond(user_message="hola", conversation_context=_context())
    assert exc_info.value.context["stage"] == "shape"


def test_llm_close_does_not_close_injected_client() -> None:
    client = _TrackingClient(_FakeResponse(_FAKE_LLM_PAYLOAD))
    provider = _make_llm(client=client)
    provider.close()
    assert client.closed is False


def test_llm_close_closes_owned_client(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _TrackingClient(_FakeResponse(_FAKE_LLM_PAYLOAD))
    _patch_llm_client(monkeypatch, client)
    provider = _make_llm(client=None)
    provider.respond(user_message="hola", conversation_context=_context())
    provider.close()
    assert client.closed is True


# ---------------------------------------------------------------------------
# Router de proveedores (selección + fallback + caché)
# ---------------------------------------------------------------------------


def test_router_selects_first_enabled_and_caches(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _TrackingClient(_FakeResponse(_FAKE_LLM_PAYLOAD))
    _patch_llm_client(monkeypatch, fake)
    logger = _RecordingLogger()
    router = _make_router(
        providers=[_provider_config(provider_kind="llm", order=1, api_key="test-key", prompt_base="P1")],
        cache=LruBotResponseCache(max_entries=16),
        logger=logger,
    )
    context = _context()
    first = router.respond(user_message="hola", conversation_context=context)
    second = router.respond(user_message="hola", conversation_context=context)

    assert first.content == second.content
    assert len(fake.calls) == 1
    selected = [e for e in logger.events if e[0] == "bot.provider.selected"]
    assert len(selected) == 1
    assert any(e[0] == "bot.provider.cache_hit" for e in logger.events)


def test_router_falls_back_to_next_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    failing = _FakeClient(error=httpx.ConnectError("boom"))
    _patch_llm_client(monkeypatch, failing)
    logger = _RecordingLogger()
    router = _make_router(
        providers=[
            _provider_config(provider_kind="llm", order=1, api_key="test-key", prompt_base="P1"),
            _provider_config(provider_kind="local", order=2, prompt_base="P2"),
        ],
        content_items=[{"title": "Horario", "content": "Atendemos de 9 a 18."}],
        logger=logger,
    )
    response = router.respond(user_message="horario", conversation_context=_context())

    assert response.provider_kind == "local"
    assert "9 a 18" in response.content
    selected = [e for e in logger.events if e[0] == "bot.provider.selected"]
    assert len(selected) == 2
    assert any(e[0] == "bot.provider.fallback" for e in logger.events)


def test_router_all_failed_escalates_to_human(monkeypatch: pytest.MonkeyPatch) -> None:
    failing = _FakeClient(error=httpx.ConnectError("boom"))
    _patch_llm_client(monkeypatch, failing)
    logger = _RecordingLogger()
    router = _make_router(
        providers=[_provider_config(provider_kind="llm", order=1, api_key="test-key", prompt_base="P1")],
        logger=logger,
    )
    response = router.respond(user_message="hola", conversation_context=_context())

    assert response.needs_human is True
    assert response.metadata["reason"] == "all_providers_failed"
    assert any(e[0] == "bot.provider.failed" for e in logger.events)


def test_router_no_providers_returns_needs_human() -> None:
    logger = _RecordingLogger()
    router = _make_router(providers=[], logger=logger)
    response = router.respond(user_message="hola", conversation_context=_context())

    assert response.needs_human is True
    assert response.metadata["reason"] == "no_providers"
    assert any(e[0] == "bot.provider.no_providers" for e in logger.events)


def test_router_skips_disabled_and_unsupported_providers(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _TrackingClient(_FakeResponse(_FAKE_LLM_PAYLOAD))
    _patch_llm_client(monkeypatch, fake)
    logger = _RecordingLogger()
    router = _make_router(
        providers=[
            _provider_config(provider_kind="llm", order=1, enabled=False, api_key="test-key"),
            _provider_config(provider_kind="telegram", order=2),
            _provider_config(provider_kind="local", order=3),
        ],
        content_items=[{"title": "Horario", "content": "Atendemos de 9 a 18."}],
        logger=logger,
    )
    response = router.respond(user_message="horario", conversation_context=_context())

    assert response.provider_kind == "local"
    assert len(fake.calls) == 0
    assert any(e[0] == "bot.provider.unsupported_kind" for e in logger.events)
    assert not any(e[0] == "bot.provider.cache_hit" for e in logger.events)


def test_router_does_not_cache_needs_human_responses() -> None:
    logger = _RecordingLogger()
    router = _make_router(
        providers=[_provider_config(provider_kind="local", order=1)],
        catalog_items=[{"name": "Plan Básico", "price": "199.50"}],
        cache=LruBotResponseCache(max_entries=16),
        logger=logger,
    )
    context = _context()
    router.respond(user_message="no existe", conversation_context=context)
    router.respond(user_message="no existe", conversation_context=context)

    selected = [e for e in logger.events if e[0] == "bot.provider.selected"]
    assert len(selected) == 2
    assert not any(e[0] == "bot.provider.cache_hit" for e in logger.events)


def test_router_factory_builds_router() -> None:
    router = _make_router(
        providers=[_provider_config(provider_kind="local", order=1)],
        cache=LruBotResponseCache(max_entries=16),
    )
    assert isinstance(router, ResponseProviderRouter)
    assert router.kind == "router"


def test_router_close_closes_owned_providers(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _TrackingClient(_FakeResponse(_FAKE_LLM_PAYLOAD))
    _patch_llm_client(monkeypatch, client)
    router = _make_router(
        providers=[_provider_config(provider_kind="llm", order=1, api_key="test-key", prompt_base="P1")],
    )
    router.respond(user_message="hola", conversation_context=_context())
    router.close()
    assert client.closed is True
