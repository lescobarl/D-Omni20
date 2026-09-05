"""Pruebas de la migración de datos de OmniBot_IA (Fase M).

Cubre el caso de uso ``OmniBotMigrationService`` vía su composition root
``build_migration_service``: importación idempotente de KB, catálogo, canales,
proveedores, conversaciones y mensajes; validación de paridad; cifrado en reposo
de secretos de canales; aislamiento multi-tenant y estructura del reporte.

Notas de diseño:
- ``db_session`` (fixture de conftest) commitea al salir y ve las filas
  ``flush()`` del mismo test (todos los repos flush al crear/actualizar).
- SQLite de pruebas no fuerza claves foráneas, así que un tenant ``uuid.uuid4()``
  fresco por test es suficiente para ser determinista.
- Los mensajes son append-only: el overwrite nunca los sobreescribe.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from pathlib import Path

import pytest
from sqlalchemy import select

from app.bot.migration.cli import main as cli_main
from app.bot.migration.schema import SCHEMA_VERSION, OmniBotExport
from app.bot.migration.service import (
    OmniBotMigrationService,
    build_migration_service,
)
from app.bot.models import BotCompanyProvider, BotConversation, BotMessage
from app.core.encryption import TokenCipher
from app.models.tenant_config import CatalogItem, ContentItem, TenantChannel
from app.repositories.sqlalchemy_repositories import (
    SqlAlchemyCatalogItemRepository,
    SqlAlchemyTenantChannelRepository,
    SqlAlchemyTenantRepository,
)

TEST_ENCRYPTION_KEY = "test-secret-key-omnibotia-channels-2026"


@pytest.fixture()
def tenant_id() -> uuid.UUID:
    """Tenant aislado por test (SQLite de pruebas no fuerza FKs)."""
    return uuid.uuid4()


def _build_export(*, schema_version: str = SCHEMA_VERSION) -> OmniBotExport:
    """Export 1.0 de ejemplo con todas las secciones pobladas."""
    return OmniBotExport.model_validate(
        {
            "schema_version": schema_version,
            "exported_at": "2026-01-15T10:00:00Z",
            "source": "OmniBot_IA",
            "tenant_slug": "empresa-demo",
            "knowledge_base": [
                {
                    "kind": "faq",
                    "title": "Horarios",
                    "content": "Lunes a viernes 9-18h",
                    "tags": ["ventas"],
                },
                {
                    "kind": "document",
                    "title": "Politicas",
                    "content": "Devoluciones 30 dias",
                    "tags": ["legal"],
                    "version": 2,
                },
            ],
            "catalog": [
                {
                    "sku": "SKU-001",
                    "name": "Plan Pro",
                    "price": "199.99",
                    "currency": "MXN",
                    "metadata": {"popular": True},
                }
            ],
            "channels": [
                {
                    "channel_type": "whatsapp",
                    "external_id": "waba-123",
                    "phone_number": "+5215512345678",
                    "phone_number_id": "1029384756",
                    "access_token": "EAAG-secret-token",
                    "webhook_secret": "whsec_secreto",
                }
            ],
            "providers": [
                {
                    "provider_kind": "llm",
                    "order": 0,
                    "model": "gpt-4o-mini",
                    "temperature": "0.7",
                    "api_key": "sk-secret-key",
                    "prompt_base": "Eres un asistente comercial.",
                },
                {
                    "provider_kind": "local",
                    "order": 1,
                    "enabled": False,
                    "model": None,
                    "temperature": None,
                    "api_key": "",
                    "prompt_base": "Reglas locales del negocio.",
                },
            ],
            "conversations": [
                {
                    "channel_phone_number": "+5215512345678",
                    "external_contact_id": "waid-111",
                    "state": "active",
                    "last_message_at": "2026-01-15T09:30:00Z",
                    "messages": [
                        {
                            "direction": "inbound",
                            "content": "Hola, quiero comprar",
                            "created_at": "2026-01-15T09:30:00Z",
                        },
                        {
                            "direction": "outbound",
                            "content": "Bienvenido",
                            "provider_used": "gpt-4o-mini",
                            "tokens_used": 42,
                            "created_at": "2026-01-15T09:31:00Z",
                        },
                    ],
                },
            ],
        }
    )


def _service(
    db_session: object, tenant_id: uuid.UUID
) -> tuple[OmniBotMigrationService, TokenCipher]:
    """Construye el servicio vía su composition root con un cipher real."""
    cipher = TokenCipher(TEST_ENCRYPTION_KEY)
    return build_migration_service(db_session, tenant_id=tenant_id, cipher=cipher), cipher


def test_happy_path_full_import(db_session, tenant_id: uuid.UUID) -> None:
    service, _cipher = _service(db_session, tenant_id)

    report = service.run(_build_export())

    assert report.ok is True
    assert report.parity.ok is True
    assert report.counts.errors == []
    assert report.counts.content_created == 2
    assert report.counts.catalog_created == 1
    assert report.counts.channels_created == 1
    assert report.counts.providers_created == 2
    assert report.counts.conversations_created == 1
    assert report.counts.messages_created == 2

    contents = db_session.scalars(
        select(ContentItem).where(ContentItem.tenant_id == tenant_id)
    ).all()
    assert {item.title for item in contents} == {"Horarios", "Politicas"}

    catalog = db_session.scalars(
        select(CatalogItem).where(CatalogItem.tenant_id == tenant_id)
    ).all()
    assert len(catalog) == 1
    assert catalog[0].sku == "SKU-001"
    assert catalog[0].price == Decimal("199.99")

    channels = db_session.scalars(
        select(TenantChannel).where(TenantChannel.tenant_id == tenant_id)
    ).all()
    assert len(channels) == 1
    assert channels[0].phone_number == "+5215512345678"

    providers = db_session.scalars(
        select(BotCompanyProvider).where(BotCompanyProvider.tenant_id == tenant_id)
    ).all()
    assert len(providers) == 2
    assert {provider.provider_kind for provider in providers} == {"llm", "local"}

    conversations = db_session.scalars(
        select(BotConversation).where(BotConversation.tenant_id == tenant_id)
    ).all()
    assert len(conversations) == 1
    assert conversations[0].external_contact_id == "waid-111"

    messages = db_session.scalars(
        select(BotMessage).where(BotMessage.tenant_id == tenant_id)
    ).all()
    assert len(messages) == 2
    assert {message.direction for message in messages} == {"inbound", "outbound"}


def test_idempotent_rerun_skips_everything(db_session, tenant_id: uuid.UUID) -> None:
    service, _cipher = _service(db_session, tenant_id)
    export = _build_export()

    first = service.run(export)
    assert first.ok is True

    second = service.run(export)
    assert second.ok is True
    assert second.parity.ok is True
    assert second.counts.errors == []
    assert second.counts.content_created == 0
    assert second.counts.content_skipped == 2
    assert second.counts.catalog_skipped == 1
    assert second.counts.channels_skipped == 1
    assert second.counts.providers_skipped == 2
    assert second.counts.conversations_skipped == 1
    assert second.counts.messages_created == 0
    assert second.counts.messages_skipped == 2

    messages = db_session.scalars(
        select(BotMessage).where(BotMessage.tenant_id == tenant_id)
    ).all()
    assert len(messages) == 2


def test_overwrite_updates_existing_records(db_session, tenant_id: uuid.UUID) -> None:
    service, _cipher = _service(db_session, tenant_id)
    export = _build_export()

    first = service.run(export)
    assert first.ok is True

    export.knowledge_base[0].content = "Lunes a viernes 8-20h"
    export.catalog[0].price = Decimal("249.99")
    # No se cambia phone_number: el phone_map se reconstruye desde los canales
    # persistidos y la conversación referencia el teléfono original (además el
    # teléfono forma parte del mensaje_id derivado). Con phone_number_id basta
    # para ejercitar la ruta de overwrite (que actualiza todos los campos).
    export.channels[0].phone_number_id = "9999999999"
    export.providers[0].model = "gpt-4o"
    export.conversations[0].state = "closed"

    second = service.run(export, overwrite=True)
    assert second.ok is True
    assert second.counts.content_updated == 2
    assert second.counts.catalog_updated == 1
    assert second.counts.channels_updated == 1
    assert second.counts.providers_updated == 2
    assert second.counts.conversations_updated == 1
    # Los mensajes son append-only: el overwrite nunca los sobreescribe.
    assert second.counts.messages_created == 0
    assert second.counts.messages_skipped == 2

    catalog = db_session.scalars(
        select(CatalogItem).where(CatalogItem.tenant_id == tenant_id)
    ).all()
    assert catalog[0].price == Decimal("249.99")


def test_channel_secrets_encrypted_at_rest(db_session, tenant_id: uuid.UUID) -> None:
    service, cipher = _service(db_session, tenant_id)

    report = service.run(_build_export())
    assert report.ok is True

    channels = db_session.scalars(
        select(TenantChannel).where(TenantChannel.tenant_id == tenant_id)
    ).all()
    assert len(channels) == 1
    assert channels[0].encrypted_access_token != "EAAG-secret-token"
    assert channels[0].encrypted_webhook_secret != "whsec_secreto"

    repo = SqlAlchemyTenantChannelRepository(db_session, cipher=cipher)
    fetched = repo.get_by_natural_key(
        tenant_id=tenant_id, channel_type="whatsapp", external_id="waba-123"
    )
    assert fetched is not None
    assert fetched.access_token == "EAAG-secret-token"
    assert fetched.webhook_secret == "whsec_secreto"


def test_parity_issues_when_nothing_imported(db_session, tenant_id: uuid.UUID) -> None:
    service, _cipher = _service(db_session, tenant_id)

    parity = service.validate(_build_export())

    assert parity.ok is False
    sections = {issue.section for issue in parity.issues}
    assert {"knowledge_base", "catalog", "channels", "providers", "conversations"} <= sections
    assert any(
        issue.section == "conversations" and "canal" in issue.detail
        for issue in parity.issues
    )


def test_parity_detects_mismatched_catalog_price(
    db_session, tenant_id: uuid.UUID
) -> None:
    service, _cipher = _service(db_session, tenant_id)
    export = _build_export()

    report = service.run(export)
    assert report.parity.ok is True

    catalog = db_session.scalars(
        select(CatalogItem).where(CatalogItem.tenant_id == tenant_id)
    ).all()
    assert len(catalog) == 1
    SqlAlchemyCatalogItemRepository(db_session).update(
        tenant_id=tenant_id, item_id=catalog[0].id, fields={"price": Decimal("999.99")}
    )

    parity = service.validate(export)
    assert parity.ok is False
    catalog_issues = [issue for issue in parity.issues if issue.section == "catalog"]
    assert len(catalog_issues) == 1
    assert "difiere" in catalog_issues[0].detail


def test_tenant_isolation(db_session) -> None:
    # Los ids de mensaje se derivan incluyendo el tenant_id (la restricción
    # ``uq_bot_messages_message_id`` es global), así que dos empresas distintas
    # obtienen siempre ids disjuntos aunque importen el mismo export.
    export = _build_export()

    tenant_a = uuid.uuid4()
    tenant_b = uuid.uuid4()

    service_a, _cipher = _service(db_session, tenant_a)
    assert service_a.run(export).ok is True

    service_b, _cipher = _service(db_session, tenant_b)
    assert service_b.validate(export).ok is False
    assert service_b.run(export).ok is True

    messages_a = db_session.scalars(
        select(BotMessage).where(BotMessage.tenant_id == tenant_a)
    ).all()
    messages_b = db_session.scalars(
        select(BotMessage).where(BotMessage.tenant_id == tenant_b)
    ).all()
    assert len(messages_a) == 2
    assert len(messages_b) == 2
    assert {message.message_id for message in messages_a}.isdisjoint(
        {message.message_id for message in messages_b}
    )


def test_schema_version_mismatch_is_reported(db_session, tenant_id: uuid.UUID) -> None:
    service, _cipher = _service(db_session, tenant_id)

    report = service.run(_build_export(schema_version="9.9"))

    assert report.ok is False
    assert len(report.counts.errors) == 1
    assert "schema_version" in report.counts.errors[0]
    assert any(issue.section == "schema" for issue in report.parity.issues)


def test_report_to_dict_structure(db_session, tenant_id: uuid.UUID) -> None:
    service, _cipher = _service(db_session, tenant_id)

    report = service.run(_build_export())
    data = report.to_dict()

    assert set(data) == {"ok", "counts", "parity"}
    assert data["ok"] is True
    assert data["counts"]["knowledge_base"]["created"] == 2
    assert data["counts"]["messages"]["created"] == 2
    assert data["counts"]["errors"] == []
    assert data["parity"]["ok"] is True
    assert data["parity"]["issues"] == []


# --- Pruebas del CLI (``python -m app.bot.migration``) ---


def _create_cli_tenant(container) -> uuid.UUID:
    """Crea un tenant real en la base compartida (el CLI lo resuelve por id).

    ``_resolve_tenant_id`` usa ``SqlAlchemyTenantRepository.get_by_id``, así que
    el tenant debe existir en la base de pruebas antes de invocar al CLI.
    """
    with container.database.session_scope() as session:
        tenant = SqlAlchemyTenantRepository(session).create(
            slug=f"cli-{uuid.uuid4().hex[:8]}",
            name="Tenant CLI",
        )
        return tenant.id


def _write_export_file(tmp_path: Path) -> Path:
    """Escribe un export JSON válido a disco (lo que lee el CLI)."""
    export_file = tmp_path / "export.json"
    export_file.write_text(
        _build_export().model_dump_json(indent=2),
        encoding="utf-8",
    )
    return export_file


def test_cli_import_exit_0_and_persists(
    container, test_settings, tmp_path: Path
) -> None:
    """El CLI importa un export real y devuelve 0 (paridad correcta)."""
    target_tenant = _create_cli_tenant(container)
    export_file = _write_export_file(tmp_path)

    code = cli_main(
        [
            "--export-file",
            str(export_file),
            "--tenant-id",
            str(target_tenant),
            "--db-url",
            test_settings.database_url,
        ]
    )

    assert code == 0
    with container.database.session_scope() as session:
        knowledge = session.scalars(
            select(ContentItem).where(
                ContentItem.tenant_id == target_tenant,
                ContentItem.deleted.is_(False),
            )
        ).all()
        messages = session.scalars(
            select(BotMessage).where(BotMessage.tenant_id == target_tenant)
        ).all()
    assert len(knowledge) == 2
    assert len(messages) == 2


def test_cli_check_only_exit_0_after_import(
    container, test_settings, tmp_path: Path
) -> None:
    """``--check-only`` valida la paridad de un export ya importado (código 0)."""
    target_tenant = _create_cli_tenant(container)
    export_file = _write_export_file(tmp_path)
    base_args = [
        "--export-file",
        str(export_file),
        "--tenant-id",
        str(target_tenant),
        "--db-url",
        test_settings.database_url,
    ]

    assert cli_main(base_args) == 0
    assert cli_main([*base_args, "--check-only"]) == 0


def test_cli_check_only_exit_1_with_deviations(
    container, test_settings, tmp_path: Path
) -> None:
    """``--check-only`` sobre un tenant sin datos reporta desviaciones (código 1)."""
    target_tenant = _create_cli_tenant(container)
    export_file = _write_export_file(tmp_path)

    code = cli_main(
        [
            "--export-file",
            str(export_file),
            "--tenant-id",
            str(target_tenant),
            "--db-url",
            test_settings.database_url,
            "--check-only",
        ]
    )

    assert code == 1


def test_cli_usage_error_exit_2(
    container, test_settings, tmp_path: Path
) -> None:
    """Un export inexistente es un error de uso/lectura (código 2)."""
    target_tenant = _create_cli_tenant(container)

    code = cli_main(
        [
            "--export-file",
            str(tmp_path / "no-existe.json"),
            "--tenant-id",
            str(target_tenant),
            "--db-url",
            test_settings.database_url,
        ]
    )

    assert code == 2
