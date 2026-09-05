"""Pruebas del servicio de generación IA de JSON Schemas (Fase 5 del backlog).

Cubre:
- :class:`SchemaGenerationService`: parseo de JSON (plano y fenced markdown),
  validación como **JSON Schema Draft 2020-12**, caché (hit/miss, aislamiento
  por tenant y por nombre), fail-closed sin API key y errores HTTP/parse/shape/
  schema_validation como :class:`DependencyError` con contexto y causa.
- Persistencia vía :class:`ISchemaRepository` (fake que registra guardados +
  repositorio SQLAlchemy real acotado al tenant).
- Helpers de módulo ``_schema_cache_key`` y ``_normalize_schema``.
- Endpoint ``POST /api/v1/ai/generate-schema``: 403 sin tenant, 422 con payload
  inválido y 500 sin API key (precedente de test_api_designer: la generación
  real con DeepSeek NO se invoca vía HTTP).
"""

from __future__ import annotations

import uuid
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config.settings import Settings
from app.core.errors import ConfigValidationError, DependencyError
from app.core.logging import ILogger
from app.models.schema import DeveloperSchema
from app.repositories.interfaces import ISchemaRepository
from app.repositories.sqlalchemy_repositories import SqlAlchemySchemaRepository
from app.services.ai_service import LruAiResponseCache
from app.services.interfaces import SchemaGenerationResult
from app.services.schema_service import (
    SchemaGenerationService,
    _normalize_schema,
    _schema_cache_key,
)

TENANT_HEADERS: dict[str, str] = {"X-Tenant-Id": "dev-tenant"}
_AUTH: dict[str, str] = {}


@pytest.fixture(autouse=True)
def _auth_headers(super_admin_token: str) -> None:
    _AUTH["Authorization"] = f"Bearer {super_admin_token}"
    TENANT_HEADERS["Authorization"] = f"Bearer {super_admin_token}"

_VALID_SCHEMA_CONTENT = (
    '{"$schema": "https://json-schema.org/draft/2020-12/schema", '
    '"$id": "https://ejemplo.com/lead.json", "type": "object", '
    '"title": "Formulario de lead", "description": "Captura de datos del prospecto", '
    '"properties": {"nombre": {"type": "string", "title": "Nombre", "minLength": 1}}, '
    '"required": ["nombre"], "additionalProperties": false}'
)
_FENCED_SCHEMA_CONTENT = (
    '```json\n{"$schema": "https://json-schema.org/draft/2020-12/schema", '
    '"type": "object", "title": "Fenced", "properties": {}}\n```'
)
_UNPARSEABLE_CONTENT = "Esto no es JSON para nada"
_INVALID_SCHEMA_CONTENT = '{"type": "objeto_inventado"}'

_VALID_PAYLOAD: dict[str, Any] = {
    "choices": [{"message": {"content": _VALID_SCHEMA_CONTENT}}],
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


class _FakeSchemaRepository(ISchemaRepository):
    """Repositorio falso que registra guardados y persiste en memoria."""

    def __init__(self) -> None:
        self.saved: list[dict[str, Any]] = []
        self._store: dict[uuid.UUID, DeveloperSchema] = {}

    def save(
        self,
        *,
        tenant_id: uuid.UUID,
        name: str,
        schema_json: dict[str, Any],
        description: str | None = None,
        version: str = "1.0.0",
    ) -> DeveloperSchema:
        self.saved.append(
            {
                "tenant_id": tenant_id,
                "name": name,
                "schema_json": schema_json,
                "description": description,
                "version": version,
            }
        )
        record = DeveloperSchema(
            tenant_id=tenant_id,
            name=name,
            description=description,
            schema_json=schema_json,
            version=version,
        )
        record.id = uuid.uuid4()
        record.deleted = False
        self._store[record.id] = record
        return record

    def get(self, *, tenant_id: uuid.UUID, schema_id: uuid.UUID) -> DeveloperSchema | None:
        record = self._store.get(schema_id)
        if record is None or record.tenant_id != tenant_id or record.deleted:
            return None
        return record

    def list(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[DeveloperSchema], int]:
        items = [
            record
            for record in self._store.values()
            if record.tenant_id == tenant_id and not record.deleted
        ]
        return items, len(items)

    def soft_delete(self, *, tenant_id: uuid.UUID, schema_id: uuid.UUID) -> bool:
        record = self._store.get(schema_id)
        if record is None or record.tenant_id != tenant_id:
            return False
        record.deleted = True
        return True


def _make_service(
    settings: Settings,
    *,
    cache: LruAiResponseCache | None = None,
    client: _FakeClient | None = None,
    logger: ILogger | None = None,
    repository: ISchemaRepository | None = None,
) -> SchemaGenerationService:
    return SchemaGenerationService(
        settings=settings,
        cache=cache or LruAiResponseCache(),
        logger=logger or _RecordingLogger(),
        repository=repository or _FakeSchemaRepository(),
        client=client,
    )


# ── SchemaGenerationService ───────────────────────────────────────────────────


def test_generate_returns_valid_result() -> None:
    client = _FakeClient(response=_FakeResponse(_VALID_PAYLOAD))
    repo = _FakeSchemaRepository()
    service = _make_service(_make_settings(), client=client, repository=repo)

    result = service.generate_schema(
        tenant_id=uuid.uuid4(), prompt="Crea un formulario de lead", name="Lead Form"
    )

    assert isinstance(result, SchemaGenerationResult)
    assert result.cached is False
    assert result.schema["type"] == "object"
    assert result.schema["title"] == "Formulario de lead"
    assert result.schema["$schema"] == "https://json-schema.org/draft/2020-12/schema"
    assert result.model == "deepseek-chat"
    assert result.prompt_tokens == 10
    assert result.completion_tokens == 20
    # El payload enviado incluye la instrucción de nombre en el mensaje de usuario.
    sent: dict[str, Any] = client.calls[0]
    assert sent["headers"]["Authorization"] == "Bearer test-key"
    assert "Genera un JSON Schema para 'Lead Form'" in sent["json"]["messages"][1]["content"]
    # Se persiste en el repositorio con el nombre dado y el schema normalizado.
    assert len(repo.saved) == 1
    assert repo.saved[0]["name"] == "Lead Form"
    assert repo.saved[0]["schema_json"]["type"] == "object"
    assert repo.saved[0]["schema_json"]["title"] == "Formulario de lead"


def test_generate_parses_fenced_markdown_json() -> None:
    payload = {"choices": [{"message": {"content": _FENCED_SCHEMA_CONTENT}}], "usage": {}}
    service = _make_service(
        _make_settings(), client=_FakeClient(response=_FakeResponse(payload))
    )

    result = service.generate_schema(tenant_id=uuid.uuid4(), prompt="Prompt")

    assert result.schema["title"] == "Fenced"
    assert result.cached is False


def test_generate_serves_second_call_from_cache() -> None:
    client = _FakeClient(response=_FakeResponse(_VALID_PAYLOAD))
    service = _make_service(_make_settings(), client=client)

    tenant = uuid.uuid4()
    first = service.generate_schema(tenant_id=tenant, prompt="Mismo prompt")
    second = service.generate_schema(tenant_id=tenant, prompt="Mismo prompt")

    assert first.cached is False
    assert second.cached is True
    assert second.schema == first.schema
    assert len(client.calls) == 1  # la segunda llamada no tocó la API


def test_generate_cache_is_tenant_aware() -> None:
    client = _FakeClient(response=_FakeResponse(_VALID_PAYLOAD))
    service = _make_service(_make_settings(), client=client)

    service.generate_schema(tenant_id=uuid.uuid4(), prompt="Prompt compartido")
    other = service.generate_schema(tenant_id=uuid.uuid4(), prompt="Prompt compartido")

    assert other.cached is False
    assert len(client.calls) == 2  # tenants distintos → keys distintas


def test_generate_cache_key_includes_name() -> None:
    client = _FakeClient(response=_FakeResponse(_VALID_PAYLOAD))
    service = _make_service(_make_settings(), client=client)

    tenant = uuid.uuid4()
    service.generate_schema(tenant_id=tenant, prompt="Mismo prompt", name="A")
    second = service.generate_schema(tenant_id=tenant, prompt="Mismo prompt", name="B")

    assert second.cached is False
    assert len(client.calls) == 2  # nombres distintos → claves distintas


def test_generate_missing_api_key_raises_config_validation() -> None:
    settings = _make_settings(deepseek_api_key="")
    service = _make_service(settings)

    with pytest.raises(ConfigValidationError) as exc_info:
        service.generate_schema(tenant_id=uuid.uuid4(), prompt="Cualquier cosa")

    assert exc_info.value.operation == "ai.generate_schema"
    assert exc_info.value.context == {"reason": "api_key_missing"}


def test_generate_http_error_raises_dependency() -> None:
    client = _FakeClient(error=httpx.ConnectError("no hay red"))
    service = _make_service(_make_settings(), client=client)

    with pytest.raises(DependencyError) as exc_info:
        service.generate_schema(tenant_id=uuid.uuid4(), prompt="Prompt")

    assert exc_info.value.operation == "ai.generate_schema"
    assert exc_info.value.context["stage"] == "http"
    assert exc_info.value.cause is not None


def test_generate_unparseable_content_raises_dependency() -> None:
    payload = {"choices": [{"message": {"content": _UNPARSEABLE_CONTENT}}], "usage": {}}
    service = _make_service(
        _make_settings(), client=_FakeClient(response=_FakeResponse(payload))
    )

    with pytest.raises(DependencyError) as exc_info:
        service.generate_schema(tenant_id=uuid.uuid4(), prompt="Prompt")

    assert exc_info.value.operation == "ai.generate_schema"
    assert exc_info.value.context["stage"] == "json"
    assert exc_info.value.cause is not None


def test_generate_non_json_response_raises_dependency() -> None:
    response = _FakeResponse(payload=None, json_error=ValueError("no json"))
    service = _make_service(_make_settings(), client=_FakeClient(response=response))

    with pytest.raises(DependencyError) as exc_info:
        service.generate_schema(tenant_id=uuid.uuid4(), prompt="Prompt")

    assert exc_info.value.context["stage"] == "parse"
    assert exc_info.value.context["status_code"] == 200


def test_generate_unexpected_shape_raises_dependency() -> None:
    payload = {"choices": []}  # sin message ni content
    service = _make_service(
        _make_settings(), client=_FakeClient(response=_FakeResponse(payload))
    )

    with pytest.raises(DependencyError) as exc_info:
        service.generate_schema(tenant_id=uuid.uuid4(), prompt="Prompt")

    assert exc_info.value.context["stage"] == "shape"
    assert exc_info.value.cause is not None


def test_generate_invalid_schema_raises_dependency() -> None:
    """JSON válido pero NO un JSON Schema Draft 2020-12 válido → fail-closed."""
    payload = {"choices": [{"message": {"content": _INVALID_SCHEMA_CONTENT}}], "usage": {}}
    service = _make_service(
        _make_settings(), client=_FakeClient(response=_FakeResponse(payload))
    )

    with pytest.raises(DependencyError) as exc_info:
        service.generate_schema(tenant_id=uuid.uuid4(), prompt="Prompt")

    assert exc_info.value.operation == "ai.generate_schema"
    assert exc_info.value.context["stage"] == "schema_validation"
    assert exc_info.value.cause is not None


def test_generate_persists_schema_with_title_fallback() -> None:
    """Sin nombre explícito, el nombre se toma del título normalizado del schema."""
    content = '{"type": "object", "properties": {}}'
    payload = {"choices": [{"message": {"content": content}}], "usage": {}}
    repo = _FakeSchemaRepository()
    service = _make_service(
        _make_settings(), client=_FakeClient(response=_FakeResponse(payload)), repository=repo
    )

    result = service.generate_schema(tenant_id=uuid.uuid4(), prompt="Prompt")

    assert result.schema["$schema"] == "https://json-schema.org/draft/2020-12/schema"
    assert result.schema["title"] == "Esquema generado"
    assert len(repo.saved) == 1
    assert repo.saved[0]["name"] == "Esquema generado"


def test_generate_name_is_truncated_to_255() -> None:
    client = _FakeClient(response=_FakeResponse(_VALID_PAYLOAD))
    repo = _FakeSchemaRepository()
    service = _make_service(_make_settings(), client=client, repository=repo)

    long_name = "x" * 300
    service.generate_schema(tenant_id=uuid.uuid4(), prompt="Prompt", name=long_name)

    assert len(repo.saved) == 1
    assert len(repo.saved[0]["name"]) == 255
    assert repo.saved[0]["name"] == long_name[:255]


def test_close_does_not_close_injected_client() -> None:
    client = _FakeClient(response=_FakeResponse(_VALID_PAYLOAD))
    service = _make_service(_make_settings(), client=client)
    service.close()  # no debe fallar ni cerrar un cliente que no posee
    assert client.calls == []


# ── Helpers de módulo ─────────────────────────────────────────────────────────


def test_schema_cache_key_is_tenant_aware() -> None:
    tenant_a = uuid.UUID("00000000-0000-0000-0000-000000000001")
    tenant_b = uuid.UUID("00000000-0000-0000-0000-000000000002")
    key_a = _schema_cache_key(tenant_id=tenant_a, prompt="mismo prompt", name=None)
    key_b = _schema_cache_key(tenant_id=tenant_b, prompt="mismo prompt", name=None)
    assert key_a != key_b
    # Mismo tenant + mismo prompt + mismo nombre → misma clave (aunque cambie la caja).
    assert key_a == _schema_cache_key(tenant_id=tenant_a, prompt="MISMO PROMPT", name=None)


def test_schema_cache_key_includes_name() -> None:
    tenant = uuid.uuid4()
    without = _schema_cache_key(tenant_id=tenant, prompt="prompt", name=None)
    with_name = _schema_cache_key(tenant_id=tenant, prompt="prompt", name="Lead")
    assert without != with_name
    assert with_name == _schema_cache_key(tenant_id=tenant, prompt="prompt", name="LEAD")


def test_normalize_schema_rejects_non_object() -> None:
    with pytest.raises(DependencyError) as exc_info:
        _normalize_schema("no soy objeto")
    assert exc_info.value.operation == "ai.generate_schema"
    assert exc_info.value.context == {"stage": "shape", "reason": "not_object"}


def test_normalize_schema_adds_defaults() -> None:
    schema = _normalize_schema({"type": "object", "properties": {}})
    assert schema["$schema"] == "https://json-schema.org/draft/2020-12/schema"
    assert schema["title"] == "Esquema generado"
    assert schema["type"] == "object"


def test_normalize_schema_preserves_existing_title() -> None:
    schema = _normalize_schema({"title": "Mi título", "type": "object"})
    assert schema["title"] == "Mi título"


# ── Repositorio SQLAlchemy real ───────────────────────────────────────────────


def test_repository_save_get_list_soft_delete(db_session) -> None:
    """El repositorio real persiste, lista y soft-deletea schemas acotados al tenant."""
    repo = SqlAlchemySchemaRepository(db_session)
    tenant = uuid.uuid4()

    saved = repo.save(
        tenant_id=tenant,
        name="Lead Schema",
        schema_json={"type": "object", "title": "Lead"},
        description="Formulario de lead",
    )
    assert isinstance(saved, DeveloperSchema)
    assert saved.id is not None
    assert saved.name == "Lead Schema"

    fetched = repo.get(tenant_id=tenant, schema_id=saved.id)
    assert fetched is not None
    assert fetched.schema_json["type"] == "object"

    items, total = repo.list(tenant_id=tenant, page=1, page_size=10)
    assert total == 1
    assert items[0].id == saved.id

    # Otro tenant NO ve el schema (aislamiento multi-tenant).
    assert repo.get(tenant_id=uuid.uuid4(), schema_id=saved.id) is None

    assert repo.soft_delete(tenant_id=tenant, schema_id=saved.id) is True
    assert repo.get(tenant_id=tenant, schema_id=saved.id) is None
    assert repo.soft_delete(tenant_id=tenant, schema_id=saved.id) is False


# ── Endpoint POST /api/v1/ai/generate-schema ──────────────────────────────────


def test_generate_schema_missing_tenant_header_returns_403(
    client: TestClient, super_admin_token: str
) -> None:
    response = client.post(
        "/api/v1/ai/generate-schema",
        headers={"Authorization": f"Bearer {super_admin_token}"},
        json={"prompt": "Crea un formulario"},
    )
    assert response.status_code == 403
    body = response.json()
    assert body["error"]["code"] == "tenant.isolation_violation"


def test_generate_schema_invalid_payload_returns_422(client: TestClient) -> None:
    response = client.post(
        "/api/v1/ai/generate-schema",
        json={"prompt": ""},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "validation.request_error"


def test_generate_schema_without_api_key_returns_500(client: TestClient) -> None:
    """Con API key vacía (test_settings) el servicio falla de forma cerrada → 500."""
    response = client.post(
        "/api/v1/ai/generate-schema",
        json={"prompt": "Crea un formulario de lead", "name": "Lead Form"},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 500
    body = response.json()
    assert body["error"]["code"] == "config.validation_error"
    assert body["error"]["operation"] == "ai.generate_schema"
    assert body["error"]["context"] == {"reason": "api_key_missing"}


# ── Endpoint GET /api/v1/ai/schemas ───────────────────────────────────────────


def test_list_schemas_missing_tenant_header_returns_403(
    client: TestClient, super_admin_token: str
) -> None:
    """El listado exige el tenant activo (aislamiento multi-tenant)."""
    response = client.get(
        "/api/v1/ai/schemas",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert response.status_code == 403
    body = response.json()
    assert body["error"]["code"] == "tenant.isolation_violation"


def test_list_schemas_returns_page_shape(client: TestClient) -> None:
    """Roundtrip real sin dependencias externas: página 200 con la forma ``Page``."""
    response = client.get("/api/v1/ai/schemas", headers=TENANT_HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"items", "total", "page", "page_size"}
    assert isinstance(body["items"], list)
    assert body["page"] == 1
    assert body["page_size"] == 20
    assert isinstance(body["total"], int)
    assert body["total"] >= 0


def test_list_schemas_returns_persisted_schema(
    client: TestClient, db_session, tenant_id
) -> None:
    """El listado HTTP ve los schemas guardados vía repositorio (mismo archivo SQLite)."""
    repo = SqlAlchemySchemaRepository(db_session)
    repo.save(
        tenant_id=tenant_id,
        name="Lead HTTP",
        schema_json={"type": "object", "title": "Lead", "properties": {}},
        description="Roundtrip de listado",
    )
    db_session.commit()  # visible para la conexión de la app

    response = client.get("/api/v1/ai/schemas", headers=TENANT_HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert body["total"] >= 1
    names = [item["name"] for item in body["items"]]
    assert "Lead HTTP" in names
    lead = next(item for item in body["items"] if item["name"] == "Lead HTTP")
    assert lead["schema_json"]["type"] == "object"
    assert lead["tenant_id"] == str(tenant_id)
    assert lead["version"] == "1.0.0"
