"""Sembrado de datos operativos para el tenant de desarrollo (única fuente de verdad).

Centraliza la lógica de siembra de KPIs de operación (Dashboard B.1 +
Estadísticas B.2) que antes estaba duplicada entre ``app/main.py``
(``_seed_dev_operations``, ejecutada automáticamente en el lifespan) y
``scripts/seed_dev_ops.py`` (script CLI manual). Una única implementación evita
que ambas rutas diverjan silenciosamente.

Genera KPIs deterministas —canales, conversaciones, mensajes e intervenciones—
para que el E2E de KPIs valide el contrato del bloque B sobre datos reales con
RLS.

Idempotente: usa el marcador ``e2e-kpi-`` en ``external_contact_id`` y se omite
si ya existen conversaciones sembradas para el tenant, evitando duplicar KPIs en
ejecuciones repetidas (tanto al arrancar la app como al invocar el script).
"""

from __future__ import annotations

import uuid

from sqlalchemy import select

from app.bot.models import BotConversation, BotMessage
from app.models.bot_operations import BotIntervention
from app.models.tenant_config import TenantChannel

# Marcador en ``external_contact_id`` para detectar una siembra previa de KPIs
# de operación. Compartido por ``app/main.py`` y ``scripts/seed_dev_ops.py`` para
# que ambas rutas sean idempotentes entre sí.
DEV_OPS_MARKER_PREFIX = "e2e-kpi-"


def _suffix() -> str:
    """Sufijo corto y único para identificadores externos (8 hex)."""
    return uuid.uuid4().hex[:8]


def has_seeded_operations(session: object, tenant_id: uuid.UUID) -> bool:
    """Devuelve ``True`` si el tenant ya tiene KPIs de operación sembrados.

    Idempotencia: busca una conversación cuyo ``external_contact_id`` empiece por
    el marcador ``e2e-kpi-``. Si existe, la siembra ya se hizo y debe omitirse.
    """
    exists = session.scalars(
        select(BotConversation.id)
        .where(
            BotConversation.tenant_id == tenant_id,
            BotConversation.external_contact_id.like(f"{DEV_OPS_MARKER_PREFIX}%"),
        )
        .limit(1)
    ).first()
    return exists is not None


def seed_dev_operations(tenant_id: uuid.UUID, session: object) -> None:
    """Crea canales, conversaciones, mensajes e intervenciones deterministas.

    Replica el escenario validado por ``test_stats_overview_returns_aggregates``:
    dos canales (whatsapp + instagram), dos conversaciones (activa y nueva),
    tres mensajes (dos entrantes + uno saliente) y dos intervenciones
    (pendiente + resuelta por ``operador-1``).

    No commitea: el llamador decide cuándo hacer ``session.commit()`` para poder
    agrupar la siembra con otras operaciones en la misma transacción.
    """
    channel_a = TenantChannel(
        tenant_id=tenant_id,
        channel_type="whatsapp",
        external_id=f"waba-{_suffix()}",
        phone_number=f"52155{_suffix()}",
        phone_number_id=f"pid-{_suffix()}",
        encrypted_access_token="",
        encrypted_webhook_secret="",
        enabled=True,
    )
    channel_b = TenantChannel(
        tenant_id=tenant_id,
        channel_type="instagram",
        external_id=f"ig-{_suffix()}",
        phone_number=f"52155{_suffix()}",
        phone_number_id=f"pid-{_suffix()}",
        encrypted_access_token="",
        encrypted_webhook_secret="",
        enabled=True,
    )
    session.add_all([channel_a, channel_b])
    session.flush()

    conversation = BotConversation(
        tenant_id=tenant_id,
        channel_id=channel_a.id,
        external_contact_id=f"{DEV_OPS_MARKER_PREFIX}activa-{_suffix()}",
        state="active",
    )
    conversation_sin_mensajes = BotConversation(
        tenant_id=tenant_id,
        channel_id=channel_b.id,
        external_contact_id=f"{DEV_OPS_MARKER_PREFIX}nueva-{_suffix()}",
        state="new",
    )
    session.add_all([conversation, conversation_sin_mensajes])
    session.flush()

    session.add_all(
        [
            BotMessage(
                tenant_id=tenant_id,
                conversation_id=conversation.id,
                direction="inbound",
                content="hola",
            ),
            BotMessage(
                tenant_id=tenant_id,
                conversation_id=conversation.id,
                direction="inbound",
                content="¿precio?",
            ),
            BotMessage(
                tenant_id=tenant_id,
                conversation_id=conversation.id,
                direction="outbound",
                content="te paso la cotización",
            ),
        ]
    )
    session.add_all(
        [
            BotIntervention(
                tenant_id=tenant_id,
                conversation_id=conversation.id,
                state="pending",
            ),
            BotIntervention(
                tenant_id=tenant_id,
                conversation_id=conversation.id,
                state="resolved",
                operator="operador-1",
            ),
        ]
    )
