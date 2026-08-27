"""Pruebas del contenedor de dependencias (regla CLAUDE: DI, sin ``new``)."""

from __future__ import annotations

from app.core.di import build_container
from app.core.logging import ILogger
from app.core.rls import RLSManager
from app.services.interfaces import IAiService
from app.services.workflow_interfaces import (
    ICrmWebhookSender,
    IEmailSender,
    IGoogleCalendarProvider,
    ISmsSender,
    IWhatsAppSender,
)


def test_build_container_exposes_singletons(test_settings) -> None:
    container = build_container(test_settings)

    assert isinstance(container.logger, ILogger)
    assert container.database is not None
    assert isinstance(container.rls, RLSManager)
    assert isinstance(container.ai_service, IAiService)
    assert container.settings is test_settings

    container.dispose()


def test_container_properties_are_lazy_singletons(test_settings) -> None:
    container = build_container(test_settings)
    assert container.logger is container.logger
    assert container.database is container.database
    assert container.rls is container.rls
    assert container.ai_service is container.ai_service
    container.dispose()


def test_container_database_url_matches_settings(test_settings) -> None:
    container = build_container(test_settings)
    url = str(container.database.engine.url)
    assert "sqlite" in url
    assert "test.db" in url
    container.dispose()


def test_build_container_without_settings_uses_defaults() -> None:
    container = build_container()
    assert container.settings is not None
    container.dispose()


def test_container_exposes_external_integration_providers(test_settings) -> None:
    container = build_container(test_settings)

    assert isinstance(container.email_sender, IEmailSender)
    assert isinstance(container.sms_sender, ISmsSender)
    assert isinstance(container.whatsapp_sender, IWhatsAppSender)
    assert isinstance(container.google_calendar_provider, IGoogleCalendarProvider)
    assert isinstance(container.calendar_provider, IGoogleCalendarProvider)
    assert isinstance(container.crm_webhook_sender, ICrmWebhookSender)

    container.dispose()


def test_external_integration_providers_are_lazy_singletons(test_settings) -> None:
    container = build_container(test_settings)

    assert container.email_sender is container.email_sender
    assert container.sms_sender is container.sms_sender
    assert container.whatsapp_sender is container.whatsapp_sender
    assert container.google_calendar_provider is container.google_calendar_provider
    assert container.calendar_provider is container.google_calendar_provider

    container.dispose()
