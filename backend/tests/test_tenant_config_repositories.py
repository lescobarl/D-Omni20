"""Tests de los repositorios de configuración del tenant (Fase 1).

Cubre los 4 repositorios nuevos (apariencia, contenido, catálogo y canales),
incluyendo el cifrado/descifrado de secretos de canales vía ``TokenCipher`` y
el aislamiento multi-tenant (defensa en profundidad: los repositorios filtran
SIEMPRE por ``tenant_id`` + sin soft-delete).

Notas de diseño:
- ``db_session`` (fixture de conftest) commitea al salir y ve las filas
  ``flush()`` del mismo test.
- SQLite de pruebas no fuerza claves foráneas (no se emite
  ``PRAGMA foreign_keys=ON``), por lo que un ``other_tenant`` aleatorio puede
  usarse sin sembrar una fila en ``tenants``.
- ``TokenCipher`` deriva la clave Fernet por SHA-256 para cualquier secreto de
  >= 32 caracteres, así que el test puede usar una clave literal.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

import pytest

from app.core.encryption import TokenCipher
from app.repositories.sqlalchemy_repositories import (
    SqlAlchemyCatalogItemRepository,
    SqlAlchemyContentItemRepository,
    SqlAlchemyTenantAppearanceRepository,
    SqlAlchemyTenantChannelRepository,
)

TEST_ENCRYPTION_KEY = "test-secret-key-omnibotia-channels-2026"


@pytest.fixture()
def tenant_id() -> uuid.UUID:
    """Tenant aislado por test (SQLite de pruebas no fuerza FKs).

    El tenant de desarrollo del conftest es de scope sesión y su base se comparte
    y acumula filas entre tests (``db_session`` commitea al salir), por lo que las
    pruebas de este módulo usan un UUID fresco por test para ser deterministas e
    independientes del orden de ejecución.
    """
    return uuid.uuid4()


class TestTenantAppearanceRepository:
    def test_upsert_creates_then_updates_same_row(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyTenantAppearanceRepository(db_session)

        first = repo.upsert(
            tenant_id=tenant_id,
            primary_color="#2563EB",
            accent_color="#7C3AED",
            surface_color="#FFFFFF",
            text_color="#0F172A",
            brand_badge="#2563EB",
            logo_url=None,
            font_family=None,
        )
        assert first.id is not None
        assert first.primary_color == "#2563EB"

        updated = repo.upsert(
            tenant_id=tenant_id,
            primary_color="#111827",
            accent_color="#EF4444",
            surface_color="#F9FAFB",
            text_color="#1F2937",
            brand_badge="#111827",
            logo_url="https://cdn.example.com/logo.png",
            font_family="Inter",
        )
        # Misma fila (mismo UUID), campos actualizados, sin duplicar el registro.
        assert updated.id == first.id
        assert updated.primary_color == "#111827"
        assert updated.font_family == "Inter"

        fetched = repo.get(tenant_id=tenant_id)
        assert fetched is not None
        assert fetched.id == first.id
        assert fetched.accent_color == "#EF4444"

    def test_get_unknown_tenant_returns_none(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyTenantAppearanceRepository(db_session)
        repo.upsert(
            tenant_id=tenant_id,
            primary_color="#2563EB",
            accent_color="#7C3AED",
            surface_color="#FFFFFF",
            text_color="#0F172A",
            brand_badge="#2563EB",
            logo_url=None,
            font_family=None,
        )
        assert repo.get(tenant_id=uuid.uuid4()) is None


class TestContentItemRepository:
    def _create(self, repo, tenant_id, *, kind, title, content="", tags=None):
        return repo.create(
            tenant_id=tenant_id,
            kind=kind,
            title=title,
            content=content,
            tags=tags or [],
        )

    def test_create_and_get(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyContentItemRepository(db_session)
        item = self._create(
            repo, tenant_id, kind="greeting", title="Saludo inicial", content="¡Hola!", tags=["saludo"]
        )
        assert item.id is not None
        assert item.kind == "greeting"
        assert item.tags == ["saludo"]

        fetched = repo.get(tenant_id=tenant_id, item_id=item.id)
        assert fetched is not None
        assert fetched.title == "Saludo inicial"

    def test_get_by_kind_filters_kind_and_tenant(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyContentItemRepository(db_session)
        self._create(repo, tenant_id, kind="faq", title="¿Qué es?", content="Respuesta FAQ")
        self._create(repo, tenant_id, kind="faq", title="Atención", content="Horarios")
        self._create(repo, tenant_id, kind="menu", title="Menú principal", content="Opciones")

        faqs = repo.get_by_kind(tenant_id=tenant_id, kind="faq")
        assert [f.title for f in faqs] == ["Atención", "¿Qué es?"]  # order_by title asc

        # Aislamiento: otro tenant no ve las FAQs.
        assert repo.get_by_kind(tenant_id=uuid.uuid4(), kind="faq") == []

    def test_list_pagination_and_total(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyContentItemRepository(db_session)
        for i in range(3):
            self._create(repo, tenant_id, kind="menu", title=f"Opción {i}", content="x")

        page1, total = repo.list(tenant_id=tenant_id, page=1, page_size=2)
        assert len(page1) == 2
        assert total == 3

        page2, _ = repo.list(tenant_id=tenant_id, page=2, page_size=2)
        assert len(page2) == 1

    def test_update_fields(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyContentItemRepository(db_session)
        item = self._create(repo, tenant_id, kind="greeting", title="Antes", content="v1")

        updated = repo.update(
            tenant_id=tenant_id, item_id=item.id, fields={"title": "Después", "content": "v2"}
        )
        assert updated is not None
        assert updated.title == "Después"
        assert updated.content == "v2"

        assert repo.update(
            tenant_id=tenant_id, item_id=uuid.uuid4(), fields={"title": "Nope"}
        ) is None

    def test_soft_delete_excludes_from_active_queries(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyContentItemRepository(db_session)
        item = self._create(repo, tenant_id, kind="greeting", title="Temporal", content="x")

        assert repo.soft_delete(tenant_id=tenant_id, item_id=item.id) is True
        assert repo.get(tenant_id=tenant_id, item_id=item.id) is None
        assert repo.get_by_kind(tenant_id=tenant_id, kind="greeting") == []
        items, total = repo.list(tenant_id=tenant_id, page=1, page_size=10)
        assert items == [] and total == 0
        # Soft-delete de un id inexistente devuelve False.
        assert repo.soft_delete(tenant_id=tenant_id, item_id=uuid.uuid4()) is False

    def test_tenant_isolation_on_get(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyContentItemRepository(db_session)
        item = self._create(repo, tenant_id, kind="faq", title="Privado", content="secreto")
        assert repo.get(tenant_id=uuid.uuid4(), item_id=item.id) is None


class TestCatalogItemRepository:
    def _create(self, repo, tenant_id, *, sku, name, price, **kwargs):
        return repo.create(
            tenant_id=tenant_id,
            sku=sku,
            name=name,
            description=kwargs.get("description"),
            price=price,
            currency=kwargs.get("currency", "MXN"),
            available=kwargs.get("available", True),
            metadata=kwargs.get("metadata", {}),
        )

    def test_create_and_get_by_sku(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyCatalogItemRepository(db_session)
        item = self._create(
            repo,
            tenant_id,
            sku="PEN-001",
            name="Pluma",
            price=Decimal("129.99"),
            description="Pluma azul",
            metadata={"color": "azul", "stock": 10},
        )
        assert item.id is not None
        assert item.price == Decimal("129.99")
        assert item.currency == "MXN"
        assert item.metadata_json == {"color": "azul", "stock": 10}

        by_sku = repo.get_by_sku(tenant_id=tenant_id, sku="PEN-001")
        assert by_sku is not None and by_sku.id == item.id
        assert repo.get_by_sku(tenant_id=uuid.uuid4(), sku="PEN-001") is None

    def test_update_and_soft_delete(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyCatalogItemRepository(db_session)
        item = self._create(
            repo, tenant_id, sku="SRV-001", name="Consulta", price=Decimal("500.00")
        )

        updated = repo.update(
            tenant_id=tenant_id,
            item_id=item.id,
            fields={"price": Decimal("450.00"), "available": False},
        )
        assert updated is not None
        assert updated.price == Decimal("450.00")
        assert updated.available is False

        assert repo.soft_delete(tenant_id=tenant_id, item_id=item.id) is True
        assert repo.get(tenant_id=tenant_id, item_id=item.id) is None
        assert repo.get_by_sku(tenant_id=tenant_id, sku="SRV-001") is None


class TestTenantChannelRepository:
    def _cipher(self) -> TokenCipher:
        return TokenCipher(TEST_ENCRYPTION_KEY)

    def _create(self, repo, tenant_id, *, channel_type="whatsapp", **kwargs):
        return repo.create(
            tenant_id=tenant_id,
            channel_type=channel_type,
            external_id=kwargs.get("external_id"),
            phone_number=kwargs.get("phone_number", "+5215512345678"),
            phone_number_id=kwargs.get("phone_number_id", "1234567890"),
            access_token=kwargs.get("access_token", "EAAG-secret-token"),
            webhook_secret=kwargs.get("webhook_secret", "whsec_secreto"),
            enabled=kwargs.get("enabled", True),
        )

    def test_create_encrypts_secrets_in_rest(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyTenantChannelRepository(db_session, cipher=self._cipher())
        channel = self._create(repo, tenant_id, access_token="EAAG-secret-token")

        # El dominio recibe el secreto en claro (atributos transitorios)…
        assert channel.access_token == "EAAG-secret-token"
        assert channel.webhook_secret == "whsec_secreto"
        # …pero en reposo (columnas persistidas) nunca se guarda en claro.
        assert channel.encrypted_access_token != "EAAG-secret-token"
        assert channel.encrypted_webhook_secret != "whsec_secreto"

    def test_get_decrypts_secrets_again(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyTenantChannelRepository(db_session, cipher=self._cipher())
        channel = self._create(repo, tenant_id)

        fetched = repo.get(tenant_id=tenant_id, channel_id=channel.id)
        assert fetched is not None
        assert fetched.access_token == "EAAG-secret-token"
        assert fetched.webhook_secret == "whsec_secreto"

    def test_plaintext_fallback_without_cipher(self, db_session, tenant_id) -> None:
        # Sin TOKEN_ENCRYPTION_KEY (dev/tests) se persiste en claro como respaldo.
        repo = SqlAlchemyTenantChannelRepository(db_session, cipher=None)
        channel = self._create(repo, tenant_id, access_token="EAAG-dev-fallback")

        assert channel.encrypted_access_token == "EAAG-dev-fallback"
        fetched = repo.get(tenant_id=tenant_id, channel_id=channel.id)
        assert fetched is not None and fetched.access_token == "EAAG-dev-fallback"

    def test_update_re_encrypts_secrets(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyTenantChannelRepository(db_session, cipher=self._cipher())
        channel = self._create(repo, tenant_id)

        updated = repo.update(
            tenant_id=tenant_id,
            channel_id=channel.id,
            fields={"access_token": "EAAG-nuevo-token", "enabled": False},
        )
        assert updated is not None
        assert updated.access_token == "EAAG-nuevo-token"
        assert updated.enabled is False
        # El nuevo secreto vuelve a quedar cifrado en reposo.
        assert updated.encrypted_access_token != "EAAG-nuevo-token"
        # Y se puede leer de vuelta descifrado.
        fetched = repo.get(tenant_id=tenant_id, channel_id=channel.id)
        assert fetched is not None and fetched.access_token == "EAAG-nuevo-token"

    def test_get_by_type_and_soft_delete(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyTenantChannelRepository(db_session, cipher=self._cipher())
        channel = self._create(repo, tenant_id, channel_type="whatsapp", external_id="w-1")
        self._create(repo, tenant_id, channel_type="whatsapp", external_id="w-2")

        whatsapp = repo.get_by_type(tenant_id=tenant_id, channel_type="whatsapp")
        assert len(whatsapp) == 2
        assert all(c.access_token == "EAAG-secret-token" for c in whatsapp)
        assert repo.get_by_type(tenant_id=tenant_id, channel_type="instagram") == []

        assert repo.soft_delete(tenant_id=tenant_id, channel_id=channel.id) is True
        remaining = repo.get_by_type(tenant_id=tenant_id, channel_type="whatsapp")
        assert [c.id for c in remaining] != [channel.id]

    def test_tenant_isolation_on_get(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyTenantChannelRepository(db_session, cipher=self._cipher())
        channel = self._create(repo, tenant_id)
        assert repo.get(tenant_id=uuid.uuid4(), channel_id=channel.id) is None
        assert repo.get_by_type(tenant_id=uuid.uuid4(), channel_type="whatsapp") == []

    def test_get_by_natural_key(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyTenantChannelRepository(db_session, cipher=self._cipher())
        self._create(repo, tenant_id, external_id="waba-1")

        fetched = repo.get_by_natural_key(
            tenant_id=tenant_id, channel_type="whatsapp", external_id="waba-1"
        )
        assert fetched is not None
        assert fetched.phone_number == "+5215512345678"
        assert fetched.access_token == "EAAG-secret-token"

        # Aislamiento multi-tenant: otra empresa no ve el canal.
        assert (
            repo.get_by_natural_key(
                tenant_id=uuid.uuid4(), channel_type="whatsapp", external_id="waba-1"
            )
            is None
        )
