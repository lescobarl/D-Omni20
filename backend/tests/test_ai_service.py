"""Pruebas del servicio de generación IA (DeepSeek) y su caché LRU+TTL.

Cubre:
- :class:`LruAiResponseCache`: roundtrip, TTL, evicción LRU, validación de tamaño.
- :class:`DeepSeekGenerationService`: parseo de JSON (plano y fenced markdown),
  caché (hit/miss y aislamiento por tenant), fail-closed sin API key y errores
  HTTP/parse/shape como :class:`DependencyError` con contexto y causa.
- Helpers ``_cache_key`` y ``_validate_config`` (normalización de bloques).
"""

from __future__ import annotations

import time
import uuid
from typing import Any

import httpx
import pytest

from app.config.settings import Settings
from app.core.errors import ConfigValidationError, DependencyError
from app.core.logging import ILogger
from app.services.ai_service import (
    DeepSeekGenerationService,
    LruAiResponseCache,
    _cache_key,
    _validate_config,
)
from app.services.interfaces import AiGenerationResult

_VALID_CONTENT = (
    '{"title": "Mi Landing", "workflowType": "lead_capture", "blocks": '
    '[{"type": "hero", "name": "Hero", "config": {"title": "Hola"}}]}'
)
_FENCED_CONTENT = '```json\n{"title": "Fenced", "workflowType": "direct_checkout", "blocks": []}\n```'
_UNPARSEABLE_CONTENT = "Esto no es JSON para nada"

_VALID_PAYLOAD: dict[str, Any] = {
    "choices": [{"message": {"content": _VALID_CONTENT}}],
    "usage": {"prompt_tokens": 10, "completion_tokens": 20},
}


def _make_settings(**overrides: Any) -> Settings:
    """Settings aislados con API key presente por defecto (los tests lo sobreescriben)."""
    base: dict[str, Any] = {
        "database_url": "sqlite:///:memory:",
        "deepseek_api_key": "test-key",
        "deepseek_base_url": "https://api.example.com/v1",
        "deepseek_model": "deepseek-chat",
    }
    base.update(overrides)
    return Settings(**base)


class _RecordingLogger(ILogger):
    """Logger de prueba que solo acumula eventos (sin E/S)."""

    def __init__(self) -> None:
        self.events: list[tuple[str, str, dict[str, Any]]] = []

    def debug(self, event: str, message: str = "", **fields: Any) -> None:
        self.events.append((event, message, fields))

    def info(self, event: str, message: str = "", **fields: Any) -> None:
        self.events.append((event, message, fields))

    def warning(self, event: str, message: str = "", **fields: Any) -> None:
        self.events.append((event, message, fields))

    def error(self, event: str, message: str = "", **fields: Any) -> None:
        self.events.append((event, message, fields))

    def critical(self, event: str, message: str = "", **fields: Any) -> None:
        self.events.append((event, message, fields))

    def exception(self, event: str, message: str = "", **fields: Any) -> None:
        self.events.append((event, message, fields))


class _FakeResponse:
    """Respuesta HTTP falsa con la superficie que usa el servicio (httpx)."""

    def __init__(
        self,
        payload: Any,
        status_code: int = 200,
        *,
        json_error: ValueError | None = None,
    ) -> None:
        self._payload = payload
        self.status_code = status_code
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
        error: httpx.HTTPError | None = None,
    ) -> None:
        self._response = response
        self._error = error
        self.calls: list[dict[str, Any]] = []

    def post(self, url: str, *, headers: dict[str, str], json: dict[str, Any]) -> _FakeResponse:
        self.calls.append({"url": url, "headers": headers, "json": json})
        if self._error is not None:
            raise self._error
        assert self._response is not None
        return self._response


def _make_service(
    settings: Settings,
    *,
    cache: LruAiResponseCache | None = None,
    client: _FakeClient | None = None,
    logger: ILogger | None = None,
) -> DeepSeekGenerationService:
    return DeepSeekGenerationService(
        settings=settings,
        cache=cache or LruAiResponseCache(),
        logger=logger or _RecordingLogger(),
        client=client,
    )


# ── LruAiResponseCache ────────────────────────────────────────────────────────


def test_cache_set_get_roundtrip() -> None:
    cache = LruAiResponseCache()
    cache.set("a", {"config": {"title": "X"}})
    assert cache.get("a") == {"config": {"title": "X"}}


def test_cache_get_missing_returns_none() -> None:
    cache = LruAiResponseCache()
    assert cache.get("inexistente") is None


def test_cache_ttl_expires_entries() -> None:
    cache = LruAiResponseCache()
    cache.set("a", "valor", ttl_seconds=0.01)
    assert cache.get("a") == "valor"
    time.sleep(0.03)
    assert cache.get("a") is None


def test_cache_lru_evicts_least_recently_used() -> None:
    cache = LruAiResponseCache(max_entries=2)
    cache.set("a", 1)
    cache.set("b", 2)
    cache.set("c", 3)
    assert cache.get("a") is None  # "a" fue la LRU → expulsada
    assert cache.get("b") == 2
    assert cache.get("c") == 3


def test_cache_invalid_max_entries_raises() -> None:
    with pytest.raises(ValueError):
        LruAiResponseCache(max_entries=0)


# ── DeepSeekGenerationService ────────────────────────────────────────────────


def test_generate_returns_valid_result() -> None:
    client = _FakeClient(response=_FakeResponse(_VALID_PAYLOAD))
    settings = _make_settings()
    service = _make_service(settings, client=client)

    result = service.generate_landing(
        tenant_id=uuid.uuid4(),
        prompt="Crea una landing de ventas",
        workflow_type="lead_capture",
    )

    assert isinstance(result, AiGenerationResult)
    assert result.cached is False
    assert result.config["title"] == "Mi Landing"
    assert result.config["workflowType"] == "lead_capture"
    assert result.config["blocks"][0]["type"] == "hero"
    assert result.model == "deepseek-chat"
    assert result.prompt_tokens == 10
    assert result.completion_tokens == 20
    # El payload enviado incluye la instrucción de workflow en el mensaje de usuario.
    sent: dict[str, Any] = client.calls[0]
    assert sent["headers"]["Authorization"] == "Bearer test-key"
    assert "lead_capture" in sent["json"]["messages"][1]["content"]


def test_generate_parses_fenced_markdown_json() -> None:
    payload = {"choices": [{"message": {"content": _FENCED_CONTENT}}], "usage": {}}
    service = _make_service(
        _make_settings(), client=_FakeClient(response=_FakeResponse(payload))
    )

    result = service.generate_landing(tenant_id=uuid.uuid4(), prompt="Prompt")

    assert result.config["title"] == "Fenced"
    assert result.cached is False


def test_generate_serves_second_call_from_cache() -> None:
    client = _FakeClient(response=_FakeResponse(_VALID_PAYLOAD))
    service = _make_service(_make_settings(), client=client)

    tenant = uuid.uuid4()
    first = service.generate_landing(tenant_id=tenant, prompt="Mismo prompt")
    second = service.generate_landing(tenant_id=tenant, prompt="Mismo prompt")

    assert first.cached is False
    assert second.cached is True
    assert second.config == first.config
    assert len(client.calls) == 1  # la segunda llamada no tocó la API


def test_generate_cache_is_tenant_aware() -> None:
    client = _FakeClient(response=_FakeResponse(_VALID_PAYLOAD))
    service = _make_service(_make_settings(), client=client)

    service.generate_landing(tenant_id=uuid.uuid4(), prompt="Prompt compartido")
    other = service.generate_landing(tenant_id=uuid.uuid4(), prompt="Prompt compartido")

    assert other.cached is False
    assert len(client.calls) == 2  # tenants distintos → keys distintas


def test_generate_missing_api_key_raises_config_validation() -> None:
    settings = _make_settings(deepseek_api_key="")
    service = _make_service(settings)

    with pytest.raises(ConfigValidationError) as exc_info:
        service.generate_landing(tenant_id=uuid.uuid4(), prompt="Cualquier cosa")

    assert exc_info.value.operation == "ai.generate"
    assert exc_info.value.context == {"reason": "api_key_missing"}


def test_generate_http_error_raises_dependency() -> None:
    client = _FakeClient(error=httpx.ConnectError("no hay red"))
    service = _make_service(_make_settings(), client=client)

    with pytest.raises(DependencyError) as exc_info:
        service.generate_landing(tenant_id=uuid.uuid4(), prompt="Prompt")

    assert exc_info.value.operation == "ai.generate"
    assert exc_info.value.context["stage"] == "http"
    assert exc_info.value.cause is not None


def test_generate_unparseable_content_raises_dependency() -> None:
    payload = {"choices": [{"message": {"content": _UNPARSEABLE_CONTENT}}], "usage": {}}
    service = _make_service(
        _make_settings(), client=_FakeClient(response=_FakeResponse(payload))
    )

    with pytest.raises(DependencyError) as exc_info:
        service.generate_landing(tenant_id=uuid.uuid4(), prompt="Prompt")

    assert exc_info.value.operation == "ai.generate"
    assert exc_info.value.context["stage"] == "json"
    assert exc_info.value.cause is not None


def test_generate_non_json_response_raises_dependency() -> None:
    response = _FakeResponse(payload=None, json_error=ValueError("no json"))
    service = _make_service(_make_settings(), client=_FakeClient(response=response))

    with pytest.raises(DependencyError) as exc_info:
        service.generate_landing(tenant_id=uuid.uuid4(), prompt="Prompt")

    assert exc_info.value.context["stage"] == "parse"
    assert exc_info.value.context["status_code"] == 200


def test_generate_unexpected_shape_raises_dependency() -> None:
    payload = {"choices": []}  # sin message ni content
    service = _make_service(
        _make_settings(), client=_FakeClient(response=_FakeResponse(payload))
    )

    with pytest.raises(DependencyError) as exc_info:
        service.generate_landing(tenant_id=uuid.uuid4(), prompt="Prompt")

    assert exc_info.value.context["stage"] == "shape"
    assert exc_info.value.cause is not None


def test_close_does_not_close_injected_client() -> None:
    client = _FakeClient(response=_FakeResponse(_VALID_PAYLOAD))
    service = _make_service(_make_settings(), client=client)
    service.close()  # no debe fallar ni cerrar un cliente que no posee
    assert client.calls == []


# ── Helpers de módulo ─────────────────────────────────────────────────────────


def test_cache_key_is_tenant_aware() -> None:
    tenant_a = uuid.UUID("00000000-0000-0000-0000-000000000001")
    tenant_b = uuid.UUID("00000000-0000-0000-0000-000000000002")
    key_a = _cache_key(tenant_id=tenant_a, prompt="mismo prompt", workflow_type=None)
    key_b = _cache_key(tenant_id=tenant_b, prompt="mismo prompt", workflow_type=None)
    assert key_a != key_b
    # Mismo tenant + mismo prompt → misma clave (aunque cambie la caja).
    assert key_a == _cache_key(tenant_id=tenant_a, prompt="MISMO PROMPT", workflow_type=None)


def test_generate_uses_brand_voice_in_system_prompt() -> None:
    client = _FakeClient(response=_FakeResponse(_VALID_PAYLOAD))
    service = _make_service(_make_settings(), client=client)
    service.generate_landing(
        tenant_id=uuid.uuid4(),
        prompt="Crea una landing",
        brand_voice={
            "tone": "cercano y profesional",
            "custom_instructions": "Menciona la garantía de 30 días",
        },
    )
    sent: dict[str, Any] = client.calls[0]
    system_content = sent["json"]["messages"][0]["content"]
    assert "cercano y profesional" in system_content
    assert "Menciona la garantía de 30 días" in system_content

    # Sin brand_voice → el prompt de sistema base no se altera.
    service.generate_landing(tenant_id=uuid.uuid4(), prompt="Crea una landing")
    base_content = client.calls[1]["json"]["messages"][0]["content"]
    assert "Tono de marca obligatorio" not in base_content


def test_generate_brand_voice_changes_cache_key() -> None:
    client = _FakeClient(response=_FakeResponse(_VALID_PAYLOAD))
    service = _make_service(_make_settings(), client=client)
    tenant = uuid.uuid4()
    prompt = "Crea una landing"
    first = service.generate_landing(
        tenant_id=tenant, prompt=prompt, brand_voice={"tone": "formal"}
    )
    second = service.generate_landing(
        tenant_id=tenant, prompt=prompt, brand_voice={"tone": "juvenil"}
    )
    assert first.cached is False
    assert second.cached is False  # distinta voz → distinta clave → miss
    assert len(client.calls) == 2


def test_cache_key_is_brand_voice_aware() -> None:
    tenant = uuid.UUID("00000000-0000-0000-0000-000000000001")
    prompt = "mismo prompt"
    base = _cache_key(tenant_id=tenant, prompt=prompt, workflow_type=None)
    formal = _cache_key(
        tenant_id=tenant,
        prompt=prompt,
        workflow_type=None,
        brand_voice={"tone": "formal", "custom_instructions": "A"},
    )
    formal_again = _cache_key(
        tenant_id=tenant,
        prompt=prompt,
        workflow_type=None,
        brand_voice={"custom_instructions": "A", "tone": "formal"},
    )
    juvenile = _cache_key(
        tenant_id=tenant,
        prompt=prompt,
        workflow_type=None,
        brand_voice={"tone": "juvenil"},
    )
    assert formal != base  # con voz → clave distinta a la base
    assert formal != juvenile  # voces distintas → claves distintas
    assert formal == formal_again  # dicts equivalentes (orden de claves) → misma clave


def test_validate_config_whitelists_extended_keys() -> None:
    raw = {
        "title": "Mi Landing",
        "workflowType": "direct_checkout",
        "blocks": [],
        "brand_voice": {"tone": "amable"},
        "seo_programmatic": {"city": "madrid"},
        "geo_optimization": {"local_business": {"name": "X"}},
        "metadata_template": {"title_template": "{city} · {service}"},
        "campo_inventado": {"nope": True},
    }
    config = _validate_config(raw)
    for key in (
        "brand_voice",
        "seo_programmatic",
        "geo_optimization",
        "metadata_template",
    ):
        assert key in config
    assert "campo_inventado" not in config

    config_with_string = _validate_config({**raw, "brand_voice": "texto"})
    assert "brand_voice" not in config_with_string


def test_validate_config_rejects_non_object() -> None:
    with pytest.raises(DependencyError) as exc_info:
        _validate_config("no soy objeto")
    assert exc_info.value.context == {"reason": "not_object"}


def test_validate_config_normalizes_blocks_and_workflow() -> None:
    raw = {
        "title": "  ",
        "workflowType": "workflow_inventado",
        "blocks": [
            {"type": "hero", "name": "Hero", "config": {"title": "Hola"}},
            {"type": "tipo_inventado", "config": {"x": 1}},
            "no soy bloque",
            {"type": "lead_form", "config": "no dict"},
        ],
    }

    config = _validate_config(raw)

    assert config["title"] == "Landing generada"  # fallback de título vacío
    assert config["workflowType"] == "direct_checkout"  # fallback de workflow
    assert [b["type"] for b in config["blocks"]] == ["hero", "lead_form"]
    assert config["blocks"][1]["config"] == {}  # config no-dict → {}
    assert config["blocks"][0]["name"] == "Hero"
