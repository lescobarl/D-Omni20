"""Pruebas de persistencia cifrada de tokens Google (FASE 3 del backlog).

Cubre:
- :class:`TokenCipher`: cifrado/descifrado, validación de clave y errores con contexto.
- Estado OAuth: codificación/decodificación del tenant en ``state``.
- :class:`SqlAlchemyOAuthTokenStore`: roundtrip, upsert y aislamiento por tenant
  (incluida la normalización de ``expires_at`` a aware UTC tras SQLite).
- :class:`GoogleCalendarProvider` con ``token_store``/``cipher``: autenticación
  persistente, carga de tokens, auto-refresh, fallos de descifrado y expiración
  con ``expires_at`` naive (comportamiento real de SQLite).
- Wiring del contenedor DI cuando se configura ``TOKEN_ENCRYPTION_KEY``.
"""

from __future__ import annotations

import base64
import uuid
from collections.abc import Generator
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import quote

import httpx
import pytest
from sqlalchemy import select

from app.config.settings import Settings
from app.core.database import Database
from app.core.di import Container
from app.core.encryption import TokenCipher
from app.core.errors import ConfigValidationError
from app.core.logging import ILogger
from app.models.base import Base
from app.models.tenant import TenantOAuthToken
from app.repositories.interfaces import IOAuthTokenStore, StoredOAuthToken
from app.repositories.sqlalchemy_repositories import (
    SqlAlchemyOAuthTokenStore,
    SqlAlchemyTenantRepository,
)
from app.schemas.workflow import AppointmentRead
from app.services.providers import (
    GoogleCalendarProvider,
    decode_oauth_state,
    encode_oauth_state,
)
from app.services.workflow_interfaces import CalendarEventResult, ICalendarProvider

TEST_KEY = "0123456789abcdef0123456789abcdef"  # 32 caracteres


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
    """Respuesta HTTP falsa con la superficie que usan los proveedores."""

    def __init__(self, payload: Any = None, status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code

    def json(self) -> Any:
        return self._payload


class _FakeClient:
    """Cliente httpx falso compatible con ``GoogleCalendarProvider``."""

    def __init__(
        self,
        response: _FakeResponse | None = None,
        *,
        error: httpx.HTTPError | None = None,
        responses: list[_FakeResponse] | None = None,
    ) -> None:
        self._response = response
        self._error = error
        self._responses = list(responses or [])
        self.calls: list[dict[str, Any]] = []
        self.closed = False

    def post(
        self,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        json: dict[str, Any] | None = None,
        data: dict[str, Any] | None = None,
        auth: tuple[str, str] | None = None,
    ) -> _FakeResponse:
        self.calls.append(
            {"url": url, "headers": headers, "json": json, "data": data, "auth": auth}
        )
        if self._error is not None:
            raise self._error
        if self._responses:
            return self._responses.pop(0)
        assert self._response is not None
        return self._response

    def close(self) -> None:
        self.closed = True


class _FakeIcsProvider(ICalendarProvider):
    """Proveedor ICS falso que registra llamadas (respaldo local de Google)."""

    def __init__(self) -> None:
        self.calls: list[AppointmentRead] = []

    def create_event(self, *, appointment: AppointmentRead) -> CalendarEventResult:
        self.calls.append(appointment)
        return CalendarEventResult(
            url="http://test/event.ics",
            path="artifacts/event.ics",
            bytes_size=42,
        )


class _FakeTokenStore(IOAuthTokenStore):
    """Almacén en memoria que registra llamadas (dict por (tenant, proveedor))."""

    def __init__(self, *, preload: StoredOAuthToken | None = None) -> None:
        self._data: dict[tuple[uuid.UUID, str], StoredOAuthToken] = {}
        self.load_calls: list[tuple[uuid.UUID, str]] = []
        self.saved: list[dict[str, Any]] = []
        if preload is not None:
            self._data[(preload.tenant_id, preload.provider)] = preload

    def load(
        self, *, tenant_id: uuid.UUID, provider: str
    ) -> StoredOAuthToken | None:
        self.load_calls.append((tenant_id, provider))
        return self._data.get((tenant_id, provider))

    def save(
        self,
        *,
        tenant_id: uuid.UUID,
        provider: str,
        encrypted_access_token: str,
        encrypted_refresh_token: str,
        expires_at: datetime | None,
    ) -> None:
        self.saved.append(
            {
                "tenant_id": tenant_id,
                "provider": provider,
                "encrypted_access_token": encrypted_access_token,
                "encrypted_refresh_token": encrypted_refresh_token,
                "expires_at": expires_at,
            }
        )
        self._data[(tenant_id, provider)] = StoredOAuthToken(
            tenant_id=tenant_id,
            provider=provider,
            encrypted_access_token=encrypted_access_token,
            encrypted_refresh_token=encrypted_refresh_token,
            expires_at=expires_at,
        )


def _appointment(*, tenant_id: uuid.UUID | None = None) -> AppointmentRead:
    """Cita válida para los proveedores de calendario."""
    return AppointmentRead(
        id=uuid.uuid4(),
        tenant_id=tenant_id or uuid.uuid4(),
        service="Consulta dental",
        starts_at=datetime(2026, 9, 1, 15, 0, tzinfo=timezone.utc),
        ends_at=datetime(2026, 9, 1, 16, 0, tzinfo=timezone.utc),
        timezone="UTC",
        customer_name="Ana Pérez",
        customer_email="ana@example.com",
        customer_phone="+5215500000000",
        status="scheduled",
        notes="Primera consulta",
        ics_path=None,
        created_at=datetime(2026, 8, 18, 12, 0, tzinfo=timezone.utc),
        revision=1,
        updated_at=datetime(2026, 8, 18, 12, 0, tzinfo=timezone.utc),
    )


def _make_google_with_store(
    *,
    store: IOAuthTokenStore,
    cipher: TokenCipher,
    client: _FakeClient,
    logger: _RecordingLogger,
) -> GoogleCalendarProvider:
    """Proveedor Google configurado con store/cipher inyectados (patrón DI)."""
    return GoogleCalendarProvider(
        client_id="client.apps.googleusercontent.com",
        client_secret="client-secret",
        redirect_uri="http://localhost:5173/auth/google/callback",
        timeout_seconds=5.0,
        logger=logger,
        ics_provider=_FakeIcsProvider(),
        client=client,
        token_store=store,
        cipher=cipher,
    )


@pytest.fixture
def oauth_db() -> Generator[Database, None, None]:
    """Base SQLite en memoria con el esquema completo (tablas creadas)."""
    database = Database("sqlite:///:memory:")
    Base.metadata.create_all(database.engine)
    yield database
    database.dispose()


def _create_tenant(database: Database, *, slug: str, name: str) -> uuid.UUID:
    with database.session_scope() as session:
        tenant = SqlAlchemyTenantRepository(session).create(slug=slug, name=name)
        return tenant.id


# --------------------------------------------------------------------------- #
# TokenCipher
# --------------------------------------------------------------------------- #
def test_token_cipher_roundtrip() -> None:
    cipher = TokenCipher(TEST_KEY)
    assert cipher.decrypt(cipher.encrypt("secreto")) == "secreto"


def test_token_cipher_empty_key_raises() -> None:
    with pytest.raises(ConfigValidationError):
        TokenCipher("")


def test_token_cipher_short_key_raises() -> None:
    with pytest.raises(ConfigValidationError):
        TokenCipher("short")


def test_token_cipher_accepts_valid_fernet_key() -> None:
    fernet_key = base64.urlsafe_b64encode(b"0" * 32).decode("ascii")
    cipher = TokenCipher(fernet_key)
    assert cipher.decrypt(cipher.encrypt("token")) == "token"


def test_token_cipher_invalid_ciphertext_raises() -> None:
    cipher = TokenCipher(TEST_KEY)
    with pytest.raises(ConfigValidationError):
        cipher.decrypt("no-es-cifrado")


def test_token_cipher_wrong_key_raises() -> None:
    cipher_a = TokenCipher(TEST_KEY)
    cipher_b = TokenCipher("9" * 32)
    token = cipher_a.encrypt("secreto")
    with pytest.raises(ConfigValidationError):
        cipher_b.decrypt(token)


# --------------------------------------------------------------------------- #
# Estado OAuth (state = tenant codificado)
# --------------------------------------------------------------------------- #
def test_oauth_state_roundtrip() -> None:
    tenant_id = uuid.uuid4()
    state = encode_oauth_state(tenant_id)
    assert decode_oauth_state(state) == tenant_id


def test_oauth_state_invalid_base64_returns_none() -> None:
    assert decode_oauth_state("no-es-base64-@@@") is None


def test_oauth_state_non_uuid_bytes_returns_none() -> None:
    state = base64.urlsafe_b64encode(b"no-es-uuid").decode("ascii")
    assert decode_oauth_state(state) is None


# --------------------------------------------------------------------------- #
# SqlAlchemyOAuthTokenStore (SQLite real)
# --------------------------------------------------------------------------- #
def test_store_save_load_roundtrip(oauth_db: Database) -> None:
    tenant_id = _create_tenant(oauth_db, slug="store-a", name="Store A")
    cipher = TokenCipher(TEST_KEY)
    store = SqlAlchemyOAuthTokenStore(database=oauth_db, cipher=cipher)
    expires_at = datetime(2030, 1, 1, 12, 0, 0, tzinfo=timezone.utc)

    store.save(
        tenant_id=tenant_id,
        provider="google_calendar",
        encrypted_access_token=cipher.encrypt("access-1"),
        encrypted_refresh_token=cipher.encrypt("refresh-1"),
        expires_at=expires_at,
    )

    stored = store.load(tenant_id=tenant_id, provider="google_calendar")
    assert stored is not None
    assert stored.tenant_id == tenant_id
    assert stored.provider == "google_calendar"
    assert cipher.decrypt(stored.encrypted_access_token) == "access-1"
    assert cipher.decrypt(stored.encrypted_refresh_token) == "refresh-1"
    # SQLite no preserva tzinfo; el store debe normalizar a aware UTC.
    assert stored.expires_at == expires_at
    assert stored.expires_at is not None
    assert stored.expires_at.tzinfo is not None


def test_store_save_upsert_single_row(oauth_db: Database) -> None:
    tenant_id = _create_tenant(oauth_db, slug="store-b", name="Store B")
    cipher = TokenCipher(TEST_KEY)
    store = SqlAlchemyOAuthTokenStore(database=oauth_db, cipher=cipher)

    store.save(
        tenant_id=tenant_id,
        provider="google_calendar",
        encrypted_access_token=cipher.encrypt("v1"),
        encrypted_refresh_token=cipher.encrypt("r1"),
        expires_at=None,
    )
    store.save(
        tenant_id=tenant_id,
        provider="google_calendar",
        encrypted_access_token=cipher.encrypt("v2"),
        encrypted_refresh_token=cipher.encrypt("r2"),
        expires_at=None,
    )

    with oauth_db.session_scope() as session:
        rows = list(session.scalars(select(TenantOAuthToken)).all())
    assert len(rows) == 1
    stored = store.load(tenant_id=tenant_id, provider="google_calendar")
    assert stored is not None
    assert cipher.decrypt(stored.encrypted_access_token) == "v2"


def test_store_load_missing_returns_none(oauth_db: Database) -> None:
    tenant_id = _create_tenant(oauth_db, slug="store-c", name="Store C")
    cipher = TokenCipher(TEST_KEY)
    store = SqlAlchemyOAuthTokenStore(database=oauth_db, cipher=cipher)
    assert store.load(tenant_id=tenant_id, provider="google_calendar") is None


def test_store_tenant_scoped(oauth_db: Database) -> None:
    tenant_a = _create_tenant(oauth_db, slug="tenant-a", name="Tenant A")
    tenant_b = _create_tenant(oauth_db, slug="tenant-b", name="Tenant B")
    cipher = TokenCipher(TEST_KEY)
    store = SqlAlchemyOAuthTokenStore(database=oauth_db, cipher=cipher)

    store.save(
        tenant_id=tenant_a,
        provider="google_calendar",
        encrypted_access_token=cipher.encrypt("a-token"),
        encrypted_refresh_token=cipher.encrypt("a-refresh"),
        expires_at=None,
    )

    assert store.load(tenant_id=tenant_b, provider="google_calendar") is None
    stored_a = store.load(tenant_id=tenant_a, provider="google_calendar")
    assert stored_a is not None
    assert cipher.decrypt(stored_a.encrypted_access_token) == "a-token"


# --------------------------------------------------------------------------- #
# GoogleCalendarProvider con token_store/cipher
# --------------------------------------------------------------------------- #
def test_provider_authenticate_with_tenant_persists() -> None:
    tenant = uuid.uuid4()
    cipher = TokenCipher(TEST_KEY)
    store = _FakeTokenStore()
    logger = _RecordingLogger()
    client = _FakeClient(
        _FakeResponse(
            {"access_token": "acc-123", "refresh_token": "refr-456", "expires_in": 3600}
        )
    )
    provider = _make_google_with_store(
        store=store, cipher=cipher, client=client, logger=logger
    )

    assert provider.authenticate(auth_code="auth-code", tenant_id=tenant) is True

    assert len(store.saved) == 1
    saved = store.saved[0]
    assert saved["tenant_id"] == tenant
    assert saved["provider"] == "google_calendar"
    assert cipher.decrypt(saved["encrypted_access_token"]) == "acc-123"
    assert cipher.decrypt(saved["encrypted_refresh_token"]) == "refr-456"
    # Los tokens deben persistir cifrados, nunca en claro.
    assert "acc-123" not in saved["encrypted_access_token"]


def test_provider_authenticate_without_tenant_no_persist() -> None:
    cipher = TokenCipher(TEST_KEY)
    store = _FakeTokenStore()
    logger = _RecordingLogger()
    client = _FakeClient(
        _FakeResponse(
            {"access_token": "acc-123", "refresh_token": "refr-456", "expires_in": 3600}
        )
    )
    provider = _make_google_with_store(
        store=store, cipher=cipher, client=client, logger=logger
    )

    assert provider.authenticate(auth_code="auth-code") is True
    assert store.saved == []
    assert store.load_calls == []


def test_provider_create_event_loads_stored_token() -> None:
    tenant = uuid.uuid4()
    cipher = TokenCipher(TEST_KEY)
    preload = StoredOAuthToken(
        tenant_id=tenant,
        provider="google_calendar",
        encrypted_access_token=cipher.encrypt("stored-access"),
        encrypted_refresh_token=cipher.encrypt("refresh-token"),
        expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
    )
    store = _FakeTokenStore(preload=preload)
    logger = _RecordingLogger()
    client = _FakeClient(_FakeResponse({"id": "event-abc"}))
    provider = _make_google_with_store(
        store=store, cipher=cipher, client=client, logger=logger
    )

    result = provider.create_calendar_event(appointment=_appointment(tenant_id=tenant))

    assert result == "event-abc"
    assert store.load_calls == [(tenant, "google_calendar")]
    assert len(client.calls) == 1
    assert client.calls[0]["url"] == GoogleCalendarProvider._EVENTS_URL
    assert client.calls[0]["headers"]["Authorization"] == "Bearer stored-access"


def test_provider_auto_refresh_expired() -> None:
    tenant = uuid.uuid4()
    cipher = TokenCipher(TEST_KEY)
    preload = StoredOAuthToken(
        tenant_id=tenant,
        provider="google_calendar",
        encrypted_access_token=cipher.encrypt("old-access"),
        encrypted_refresh_token=cipher.encrypt("refresh-token"),
        expires_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
    )
    store = _FakeTokenStore(preload=preload)
    logger = _RecordingLogger()
    client = _FakeClient(
        responses=[
            _FakeResponse({"access_token": "new-access", "expires_in": 3600}),
            _FakeResponse({"id": "event-abc"}),
        ]
    )
    provider = _make_google_with_store(
        store=store, cipher=cipher, client=client, logger=logger
    )

    result = provider.create_calendar_event(appointment=_appointment(tenant_id=tenant))

    assert result == "event-abc"
    assert len(client.calls) == 2
    assert client.calls[0]["url"] == GoogleCalendarProvider._TOKEN_URL
    assert client.calls[0]["data"]["grant_type"] == "refresh_token"
    assert client.calls[0]["data"]["refresh_token"] == "refresh-token"
    assert client.calls[1]["url"] == GoogleCalendarProvider._EVENTS_URL
    assert client.calls[1]["headers"]["Authorization"] == "Bearer new-access"
    # El access token renovado debe volver a persistirse cifrado.
    assert cipher.decrypt(store.saved[-1]["encrypted_access_token"]) == "new-access"


def test_provider_unauthenticated_with_store_returns_none() -> None:
    tenant = uuid.uuid4()
    cipher = TokenCipher(TEST_KEY)
    store = _FakeTokenStore()
    logger = _RecordingLogger()
    client = _FakeClient(_FakeResponse({"id": "event-abc"}))
    provider = _make_google_with_store(
        store=store, cipher=cipher, client=client, logger=logger
    )

    result = provider.create_calendar_event(appointment=_appointment(tenant_id=tenant))

    assert result is None
    assert client.calls == []
    assert any(
        event == "workflow.google.event_skipped" for event, _, _ in logger.events
    )


def test_provider_decrypt_failure_logs_warning() -> None:
    tenant = uuid.uuid4()
    wrong_key = TokenCipher("9" * 32)
    cipher = TokenCipher(TEST_KEY)
    preload = StoredOAuthToken(
        tenant_id=tenant,
        provider="google_calendar",
        encrypted_access_token=wrong_key.encrypt("access"),
        encrypted_refresh_token=wrong_key.encrypt("refresh"),
        expires_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
    )
    store = _FakeTokenStore(preload=preload)
    logger = _RecordingLogger()
    client = _FakeClient(_FakeResponse({"id": "event-abc"}))
    provider = _make_google_with_store(
        store=store, cipher=cipher, client=client, logger=logger
    )

    result = provider.create_calendar_event(appointment=_appointment(tenant_id=tenant))

    assert result is None
    assert client.calls == []
    assert any(
        event == "workflow.google.token_load_failed" for event, _, _ in logger.events
    )


def test_google_is_expired_handles_naive_expires_at() -> None:
    """SQLite no preserva tzinfo; ``_is_expired`` debe normalizar el valor a UTC."""
    provider = _make_google_with_store(
        store=_FakeTokenStore(),
        cipher=TokenCipher(TEST_KEY),
        client=_FakeClient(),
        logger=_RecordingLogger(),
    )
    provider._expires_at = datetime(2020, 1, 1)  # naive en el pasado
    assert provider._is_expired is True
    provider._expires_at = datetime(2099, 1, 1)  # naive en el futuro
    assert provider._is_expired is False
    provider._expires_at = None
    assert provider._is_expired is False


def test_provider_full_db_auto_refresh(oauth_db: Database) -> None:
    """Auto-refresh real con SqlAlchemyOAuthTokenStore sobre SQLite (roundtrip naive)."""
    tenant_id = _create_tenant(oauth_db, slug="full-db", name="Full DB")
    cipher = TokenCipher(TEST_KEY)
    store = SqlAlchemyOAuthTokenStore(database=oauth_db, cipher=cipher)
    store.save(
        tenant_id=tenant_id,
        provider="google_calendar",
        encrypted_access_token=cipher.encrypt("old-access"),
        encrypted_refresh_token=cipher.encrypt("refresh-token"),
        expires_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
    )
    logger = _RecordingLogger()
    client = _FakeClient(
        responses=[
            _FakeResponse({"access_token": "new-access", "expires_in": 3600}),
            _FakeResponse({"id": "event-abc"}),
        ]
    )
    provider = _make_google_with_store(
        store=store, cipher=cipher, client=client, logger=logger
    )

    result = provider.create_calendar_event(appointment=_appointment(tenant_id=tenant_id))

    assert result == "event-abc"
    assert client.calls[0]["url"] == GoogleCalendarProvider._TOKEN_URL
    assert client.calls[1]["headers"]["Authorization"] == "Bearer new-access"
    reloaded = store.load(tenant_id=tenant_id, provider="google_calendar")
    assert reloaded is not None
    assert cipher.decrypt(reloaded.encrypted_access_token) == "new-access"


# --------------------------------------------------------------------------- #
# authorization_url_for (state OAuth por tenant)
# --------------------------------------------------------------------------- #
def test_authorization_url_embeds_tenant_state() -> None:
    tenant_id = uuid.uuid4()
    provider = _make_google_with_store(
        store=_FakeTokenStore(),
        cipher=TokenCipher(TEST_KEY),
        client=_FakeClient(),
        logger=_RecordingLogger(),
    )
    url = provider.authorization_url_for(tenant_id=tenant_id)
    assert url is not None
    assert f"state={quote(encode_oauth_state(tenant_id))}" in url


def test_authorization_url_without_tenant_omits_state() -> None:
    provider = _make_google_with_store(
        store=_FakeTokenStore(),
        cipher=TokenCipher(TEST_KEY),
        client=_FakeClient(),
        logger=_RecordingLogger(),
    )
    url = provider.authorization_url_for()
    assert url is not None
    assert "state=" not in url


# --------------------------------------------------------------------------- #
# DI wiring (TOKEN_ENCRYPTION_KEY configurada)
# --------------------------------------------------------------------------- #
def test_container_wires_token_store_and_cipher() -> None:
    container = Container(
        Settings(
            database_url="sqlite:///:memory:",
            token_encryption_key=TEST_KEY,
            _env_file=None,
        )
    )
    try:
        provider = container.google_calendar_provider
        assert isinstance(provider, GoogleCalendarProvider)
        assert provider._token_store is not None
        assert provider._cipher is not None
    finally:
        container.dispose()
