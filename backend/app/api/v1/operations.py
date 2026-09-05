"""Endpoints de operación del bot (Bloque B de LAE Omni2.0).

CRUD acotado al tenant activo (``X-Tenant-Id`` vía ``get_current_tenant``) y
delegado en los puertos de repositorio por ``Depends`` (regla CLAUDE: DI). Los
borrados son *soft-delete* (nunca borrado físico — regla CLAUDE: tupla sync)
excepto donde el dominio no lo permite: destinatarios de campaña e
intervenciones humanas son estados transitorios sin borrado.

Recursos:
- ``/operations/contacts`` — directorio de contactos (B.6).
- ``/operations/templates`` — plantillas de mensaje (B.5).
- ``/operations/navigation-trees`` — árboles de navegación (B.3).
- ``/operations/campaigns`` + ``/recipients`` — campañas de envío (B.4).
- ``/operations/interventions`` — cola de intervención humana (B.7).
- ``/operations/maintenance`` — configuración de mantenimiento (B.9).
- ``/operations/stats/overview`` — dashboard operativo y estadísticas (B.1 + B.2).
"""

from __future__ import annotations

import csv
import io
import uuid
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import (
    APIRouter,
    Depends,
    File,
    Query,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import (
    get_bot_conversation_repository,
    get_bot_message_repository,
    get_bot_privacy_service,
    get_bot_queue_service,
    get_campaign_dispatcher,
    get_campaign_recipient_repository,
    get_campaign_repository,
    get_contact_repository,
    get_container,
    get_current_tenant,
    get_document_repository,
    get_intervention_repository,
    get_maintenance_config_repository,
    get_maintenance_service,
    get_navigation_tree_repository,
    get_operations_stats_repository,
    get_rebranding_config_repository,
    get_recipient_file_repository,
    get_session,
    get_synonym_repository,
    get_template_repository,
    require_role,
)
from app.bot.governance import IPrivacyService
from app.bot.queue.service import DIRECTION_OUTBOUND, BotQueueService
from app.bot.repository_interfaces import IBotConversationRepository, IBotMessageRepository
from app.core.di import Container
from app.core.errors import InputValidationError, NotFoundError
from app.models.base import utcnow
from app.models.user import Role
from app.repositories.interfaces import (
    IDocumentRepository,
    IRebrandingConfigRepository,
    ISynonymRepository,
)
from app.repositories.operations_interfaces import (
    ICampaignRecipientRepository,
    ICampaignRepository,
    IContactRepository,
    IInterventionRepository,
    IMaintenanceConfigRepository,
    INavigationTreeRepository,
    IOperationsStatsRepository,
    IRecipientFileRepository,
    ITemplateRepository,
)
from app.schemas.bot import MessageRead
from app.schemas.common import Page, Pagination
from app.schemas.operations import (
    ActiveConversationRead,
    BackupMetaRead,
    CampaignCreate,
    CampaignRead,
    CampaignRecipientCreate,
    CampaignRecipientRead,
    CampaignRecipientUpdate,
    CampaignUpdate,
    ContactCreate,
    ContactRead,
    ContactUpdate,
    CsvImportRequest,
    DispatchResultRead,
    ImportResultRead,
    IndividualSendInput,
    InterventionAssignRequest,
    InterventionCloseResult,
    InterventionCreate,
    InterventionPendingCountRead,
    InterventionRead,
    InterventionReplyRequest,
    InterventionUpdate,
    MaintenanceActionRead,
    MaintenanceConfigRead,
    MaintenanceConfigUpsert,
    MessageSendResultRead,
    NavigationTreeCreate,
    NavigationTreeRead,
    NavigationTreeUpdate,
    PurgeRequest,
    RecipientFileCreate,
    RecipientFileDispatchInput,
    RecipientFilePreviewRead,
    RecipientFileRead,
    RestoreResultRead,
    ScheduledRunResultRead,
    ScheduledTaskResultRead,
    StatsChannelRead,
    StatsDailyRead,
    StatsOverviewRead,
    TableStatsRead,
    TemplateCreate,
    TemplateRead,
    TemplateUpdate,
)
from app.services.campaign_service import ICampaignDispatcher
from app.services.maintenance_service import IMaintenanceService

router = APIRouter(
    prefix="/operations",
    tags=["operations"],
    dependencies=[Depends(require_role(Role.ADMIN, Role.OPERADOR))],
)

# Límite de errores por fila reportados en una importación CSV (evita respuestas
# enormes en cargas masivas con muchos fallos).
_MAX_IMPORT_ERRORS = 100


def _elapsed_ms(started: datetime) -> int:
    """Milisegundos transcurridos desde ``started`` (para acciones de B.9)."""
    return int((datetime.now(timezone.utc) - started).total_seconds() * 1000)


# ---------------------------------------------------------------------------
# Contactos (B.6)
# ---------------------------------------------------------------------------
@router.get("/contacts", response_model=Page[ContactRead])
def list_contacts(
    pagination: Pagination = Depends(),
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IContactRepository = Depends(get_contact_repository),
) -> Page[ContactRead]:
    """Lista el directorio de contactos del tenant activo (paginado)."""
    items, total = repository.list(
        tenant_id=tenant_id, page=pagination.page, page_size=pagination.page_size
    )
    return Page(
        items=[ContactRead.model_validate(item) for item in items],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.post("/contacts", response_model=ContactRead, status_code=status.HTTP_201_CREATED)
def create_contact(
    data: ContactCreate,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IContactRepository = Depends(get_contact_repository),
) -> ContactRead:
    """Crea un contacto del directorio (``phone`` único por tenant)."""
    row = repository.create(
        tenant_id=tenant_id,
        phone=data.phone,
        name=data.name,
        email=data.email,
        tags=data.tags,
        state=data.state,
        source=data.source,
        external_contact_id=data.external_contact_id,
        last_contact_at=data.last_contact_at,
    )
    return ContactRead.model_validate(row)


@router.get("/contacts/{contact_id}", response_model=ContactRead)
def get_contact(
    contact_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IContactRepository = Depends(get_contact_repository),
) -> ContactRead:
    """Devuelve un contacto del tenant activo (404 si no existe)."""
    row = repository.get(tenant_id=tenant_id, contact_id=contact_id)
    if row is None:
        raise NotFoundError(
            "Contacto no encontrado para el tenant activo",
            operation="operations.contact.get",
            context={"tenant_id": str(tenant_id), "contact_id": str(contact_id)},
        )
    return ContactRead.model_validate(row)


@router.put("/contacts/{contact_id}", response_model=ContactRead)
def update_contact(
    contact_id: uuid.UUID,
    data: ContactUpdate,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IContactRepository = Depends(get_contact_repository),
) -> ContactRead:
    """Actualiza un contacto (solo los campos enviados)."""
    fields = data.model_dump(exclude_unset=True)
    if not fields:
        raise InputValidationError(
            "No se recibieron campos para actualizar",
            operation="operations.contact.update",
            context={"tenant_id": str(tenant_id), "contact_id": str(contact_id)},
        )
    row = repository.update(tenant_id=tenant_id, contact_id=contact_id, fields=fields)
    if row is None:
        raise NotFoundError(
            "Contacto no encontrado para el tenant activo",
            operation="operations.contact.update",
            context={"tenant_id": str(tenant_id), "contact_id": str(contact_id)},
        )
    return ContactRead.model_validate(row)


@router.delete("/contacts/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_contact(
    contact_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IContactRepository = Depends(get_contact_repository),
) -> Response:
    """Soft-delete de un contacto (nunca borrado físico)."""
    deleted = repository.soft_delete(tenant_id=tenant_id, contact_id=contact_id)
    if not deleted:
        raise NotFoundError(
            "Contacto no encontrado para el tenant activo",
            operation="operations.contact.delete",
            context={"tenant_id": str(tenant_id), "contact_id": str(contact_id)},
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/contacts/import-csv", response_model=ImportResultRead)
def import_contacts_csv(
    data: CsvImportRequest,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IContactRepository = Depends(get_contact_repository),
) -> ImportResultRead:
    """Importa contactos en lote desde un CSV (texto crudo, cabecera obligatoria).

    Columnas soportadas: ``phone`` (obligatoria y única por tenant), ``name``,
    ``email``, ``tags`` (separadas por ``|``) y ``state``. Los teléfonos ya
    existentes en el tenant se omiten (skipped). Los errores por fila se
    acumulan en ``errors`` (máx. ``_MAX_IMPORT_ERRORS``).
    """
    result = ImportResultRead()
    try:
        reader = csv.DictReader(io.StringIO(data.csv), delimiter=data.delimiter)
        rows = list(reader)
    except csv.Error as exc:
        raise InputValidationError(
            f"CSV inválido: {exc}",
            operation="operations.contacts.import",
            context={"tenant_id": str(tenant_id)},
        ) from exc
    for index, row in enumerate(rows, start=2):
        phone = (row.get("phone") or "").strip()
        if not phone:
            result.failed += 1
            if len(result.errors) < _MAX_IMPORT_ERRORS:
                result.errors.append(f"fila {index}: falta el campo 'phone'")
            continue
        if repository.get_by_phone(tenant_id=tenant_id, phone=phone) is not None:
            result.skipped += 1
            continue
        tags_raw = (row.get("tags") or "").strip()
        repository.create(
            tenant_id=tenant_id,
            phone=phone,
            name=(row.get("name") or "").strip() or None,
            email=(row.get("email") or "").strip() or None,
            tags=[tag.strip() for tag in tags_raw.split("|") if tag.strip()],
            state=(row.get("state") or "").strip() or "new",
            source="import",
            external_contact_id=None,
            last_contact_at=None,
        )
        result.created += 1
    return result


# ---------------------------------------------------------------------------
# Plantillas de mensaje (B.5)
# ---------------------------------------------------------------------------
@router.get("/templates", response_model=Page[TemplateRead])
def list_templates(
    pagination: Pagination = Depends(),
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: ITemplateRepository = Depends(get_template_repository),
) -> Page[TemplateRead]:
    """Lista las plantillas de mensaje del tenant activo (paginado)."""
    items, total = repository.list(
        tenant_id=tenant_id, page=pagination.page, page_size=pagination.page_size
    )
    return Page(
        items=[TemplateRead.model_validate(item) for item in items],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.post("/templates", response_model=TemplateRead, status_code=status.HTTP_201_CREATED)
def create_template(
    data: TemplateCreate,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: ITemplateRepository = Depends(get_template_repository),
) -> TemplateRead:
    """Crea una plantilla de mensaje (``name`` único por tenant)."""
    row = repository.create(
        tenant_id=tenant_id,
        name=data.name,
        body=data.body,
        template_type=data.template_type,
        variables=data.variables,
    )
    return TemplateRead.model_validate(row)


@router.get("/templates/{template_id}", response_model=TemplateRead)
def get_template(
    template_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: ITemplateRepository = Depends(get_template_repository),
) -> TemplateRead:
    """Devuelve una plantilla del tenant activo (404 si no existe)."""
    row = repository.get(tenant_id=tenant_id, template_id=template_id)
    if row is None:
        raise NotFoundError(
            "Plantilla no encontrada para el tenant activo",
            operation="operations.template.get",
            context={"tenant_id": str(tenant_id), "template_id": str(template_id)},
        )
    return TemplateRead.model_validate(row)


@router.put("/templates/{template_id}", response_model=TemplateRead)
def update_template(
    template_id: uuid.UUID,
    data: TemplateUpdate,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: ITemplateRepository = Depends(get_template_repository),
) -> TemplateRead:
    """Actualiza una plantilla (solo los campos enviados)."""
    fields = data.model_dump(exclude_unset=True)
    if not fields:
        raise InputValidationError(
            "No se recibieron campos para actualizar",
            operation="operations.template.update",
            context={"tenant_id": str(tenant_id), "template_id": str(template_id)},
        )
    row = repository.update(tenant_id=tenant_id, template_id=template_id, fields=fields)
    if row is None:
        raise NotFoundError(
            "Plantilla no encontrada para el tenant activo",
            operation="operations.template.update",
            context={"tenant_id": str(tenant_id), "template_id": str(template_id)},
        )
    return TemplateRead.model_validate(row)


@router.delete("/templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_template(
    template_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: ITemplateRepository = Depends(get_template_repository),
) -> Response:
    """Soft-delete de una plantilla (nunca borrado físico)."""
    deleted = repository.soft_delete(tenant_id=tenant_id, template_id=template_id)
    if not deleted:
        raise NotFoundError(
            "Plantilla no encontrada para el tenant activo",
            operation="operations.template.delete",
            context={"tenant_id": str(tenant_id), "template_id": str(template_id)},
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Árboles de navegación (B.3)
# ---------------------------------------------------------------------------
@router.get("/navigation-trees", response_model=Page[NavigationTreeRead])
def list_navigation_trees(
    pagination: Pagination = Depends(),
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: INavigationTreeRepository = Depends(get_navigation_tree_repository),
) -> Page[NavigationTreeRead]:
    """Lista los árboles de navegación del tenant activo (paginado)."""
    items, total = repository.list(
        tenant_id=tenant_id, page=pagination.page, page_size=pagination.page_size
    )
    return Page(
        items=[NavigationTreeRead.model_validate(item) for item in items],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.post(
    "/navigation-trees",
    response_model=NavigationTreeRead,
    status_code=status.HTTP_201_CREATED,
)
def create_navigation_tree(
    data: NavigationTreeCreate,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: INavigationTreeRepository = Depends(get_navigation_tree_repository),
) -> NavigationTreeRead:
    """Crea un árbol de navegación (``name`` único por tenant)."""
    row = repository.create(
        tenant_id=tenant_id,
        name=data.name,
        num_options=data.num_options,
        options=data.options,
    )
    return NavigationTreeRead.model_validate(row)


@router.get("/navigation-trees/{tree_id}", response_model=NavigationTreeRead)
def get_navigation_tree(
    tree_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: INavigationTreeRepository = Depends(get_navigation_tree_repository),
) -> NavigationTreeRead:
    """Devuelve un árbol de navegación del tenant activo (404 si no existe)."""
    row = repository.get(tenant_id=tenant_id, tree_id=tree_id)
    if row is None:
        raise NotFoundError(
            "Árbol de navegación no encontrado para el tenant activo",
            operation="operations.navigation_tree.get",
            context={"tenant_id": str(tenant_id), "tree_id": str(tree_id)},
        )
    return NavigationTreeRead.model_validate(row)


@router.put("/navigation-trees/{tree_id}", response_model=NavigationTreeRead)
def update_navigation_tree(
    tree_id: uuid.UUID,
    data: NavigationTreeUpdate,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: INavigationTreeRepository = Depends(get_navigation_tree_repository),
) -> NavigationTreeRead:
    """Actualiza un árbol de navegación (solo los campos enviados)."""
    fields = data.model_dump(exclude_unset=True)
    if not fields:
        raise InputValidationError(
            "No se recibieron campos para actualizar",
            operation="operations.navigation_tree.update",
            context={"tenant_id": str(tenant_id), "tree_id": str(tree_id)},
        )
    row = repository.update(tenant_id=tenant_id, tree_id=tree_id, fields=fields)
    if row is None:
        raise NotFoundError(
            "Árbol de navegación no encontrado para el tenant activo",
            operation="operations.navigation_tree.update",
            context={"tenant_id": str(tenant_id), "tree_id": str(tree_id)},
        )
    return NavigationTreeRead.model_validate(row)


@router.delete("/navigation-trees/{tree_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_navigation_tree(
    tree_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: INavigationTreeRepository = Depends(get_navigation_tree_repository),
) -> Response:
    """Soft-delete de un árbol de navegación (nunca borrado físico)."""
    deleted = repository.soft_delete(tenant_id=tenant_id, tree_id=tree_id)
    if not deleted:
        raise NotFoundError(
            "Árbol de navegación no encontrado para el tenant activo",
            operation="operations.navigation_tree.delete",
            context={"tenant_id": str(tenant_id), "tree_id": str(tree_id)},
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Campañas de envío (B.4)
# ---------------------------------------------------------------------------
@router.get("/campaigns", response_model=Page[CampaignRead])
def list_campaigns(
    pagination: Pagination = Depends(),
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: ICampaignRepository = Depends(get_campaign_repository),
) -> Page[CampaignRead]:
    """Lista las campañas del tenant activo (paginado)."""
    items, total = repository.list(
        tenant_id=tenant_id, page=pagination.page, page_size=pagination.page_size
    )
    return Page(
        items=[CampaignRead.model_validate(item) for item in items],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.post("/campaigns", response_model=CampaignRead, status_code=status.HTTP_201_CREATED)
def create_campaign(
    data: CampaignCreate,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: ICampaignRepository = Depends(get_campaign_repository),
) -> CampaignRead:
    """Crea una campaña de envío (plantilla + estado + agenda)."""
    row = repository.create(
        tenant_id=tenant_id,
        name=data.name,
        template_id=data.template_id,
        state=data.state,
        schedule=data.schedule,
        segment_type=data.segment_type,
        segment_config=data.segment_config,
        trigger_type=data.trigger_type,
        trigger_event=data.trigger_event,
        landing_id=data.landing_id,
    )
    return CampaignRead.model_validate(row)


@router.get("/campaigns/{campaign_id}", response_model=CampaignRead)
def get_campaign(
    campaign_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: ICampaignRepository = Depends(get_campaign_repository),
) -> CampaignRead:
    """Devuelve una campaña del tenant activo (404 si no existe)."""
    row = repository.get(tenant_id=tenant_id, campaign_id=campaign_id)
    if row is None:
        raise NotFoundError(
            "Campaña no encontrada para el tenant activo",
            operation="operations.campaign.get",
            context={"tenant_id": str(tenant_id), "campaign_id": str(campaign_id)},
        )
    return CampaignRead.model_validate(row)


@router.put("/campaigns/{campaign_id}", response_model=CampaignRead)
def update_campaign(
    campaign_id: uuid.UUID,
    data: CampaignUpdate,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: ICampaignRepository = Depends(get_campaign_repository),
) -> CampaignRead:
    """Actualiza una campaña (solo los campos enviados)."""
    fields = data.model_dump(exclude_unset=True)
    if not fields:
        raise InputValidationError(
            "No se recibieron campos para actualizar",
            operation="operations.campaign.update",
            context={"tenant_id": str(tenant_id), "campaign_id": str(campaign_id)},
        )
    row = repository.update(tenant_id=tenant_id, campaign_id=campaign_id, fields=fields)
    if row is None:
        raise NotFoundError(
            "Campaña no encontrada para el tenant activo",
            operation="operations.campaign.update",
            context={"tenant_id": str(tenant_id), "campaign_id": str(campaign_id)},
        )
    return CampaignRead.model_validate(row)


@router.delete("/campaigns/{campaign_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_campaign(
    campaign_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: ICampaignRepository = Depends(get_campaign_repository),
) -> Response:
    """Soft-delete de una campaña (nunca borrado físico)."""
    deleted = repository.soft_delete(tenant_id=tenant_id, campaign_id=campaign_id)
    if not deleted:
        raise NotFoundError(
            "Campaña no encontrada para el tenant activo",
            operation="operations.campaign.delete",
            context={"tenant_id": str(tenant_id), "campaign_id": str(campaign_id)},
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/campaigns/{campaign_id}/dispatch", response_model=DispatchResultRead)
def dispatch_campaign(
    campaign_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    dispatcher: ICampaignDispatcher = Depends(get_campaign_dispatcher),
) -> DispatchResultRead:
    """Despacha una campaña de forma inmediata (disparo manual de operaciones).

    Delega en ``CampaignDispatcher.dispatch_campaign`` (C-2): evalúa la audiencia
    de la campaña y envía por el canal configurado, marcando la campaña como
    completada. Devuelve los totales procesados/enviados/fallidos/omitidos.
    """
    totals = dispatcher.dispatch_campaign(tenant_id=tenant_id, campaign_id=campaign_id)
    return DispatchResultRead(
        campaigns_processed=totals.campaigns_processed,
        recipients_sent=totals.recipients_sent,
        recipients_failed=totals.recipients_failed,
        recipients_skipped=totals.recipients_skipped,
    )


@router.post("/messages/send-individual", response_model=MessageSendResultRead)
def send_individual_message(
    data: IndividualSendInput,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    dispatcher: ICampaignDispatcher = Depends(get_campaign_dispatcher),
) -> MessageSendResultRead:
    """Envía un mensaje individual reutilizando una plantilla del tenant (B.4).

    Delega en ``CampaignDispatcher.send_individual``: resuelve (o crea) el
    contacto por ``phone`` en el directorio del tenant, envía por el canal
    WhatsApp configurado y devuelve el estado del envío junto con el id del
    contacto. No crea una campaña ni registra destinatarios de campaña.
    """
    state, result, contact_id = dispatcher.send_individual(
        tenant_id=tenant_id,
        template_id=data.template_id,
        phone=data.phone,
        contact_id=data.contact_id,
        variables=data.variables,
    )
    return MessageSendResultRead(
        state=state,
        result=result,
        contact_id=contact_id,
        phone=data.phone,
    )


# ---------------------------------------------------------------------------
# Destinatarios de campaña (B.4) — recurso anidado + actualización individual
# ---------------------------------------------------------------------------
@router.post(
    "/campaigns/{campaign_id}/recipients",
    response_model=CampaignRecipientRead,
    status_code=status.HTTP_201_CREATED,
)
def add_campaign_recipient(
    campaign_id: uuid.UUID,
    data: CampaignRecipientCreate,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: ICampaignRecipientRepository = Depends(get_campaign_recipient_repository),
) -> CampaignRecipientRead:
    """Asocia un contacto a una campaña (único por campaña+contacto)."""
    row = repository.create(
        tenant_id=tenant_id,
        campaign_id=campaign_id,
        contact_id=data.contact_id,
        state=data.state,
        result=data.result,
        attempts=data.attempts,
    )
    return CampaignRecipientRead.model_validate(row)


@router.get(
    "/campaigns/{campaign_id}/recipients",
    response_model=Page[CampaignRecipientRead],
)
def list_campaign_recipients(
    campaign_id: uuid.UUID,
    pagination: Pagination = Depends(),
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: ICampaignRecipientRepository = Depends(get_campaign_recipient_repository),
) -> Page[CampaignRecipientRead]:
    """Lista los destinatarios de una campaña (paginado)."""
    items, total = repository.list_by_campaign(
        tenant_id=tenant_id,
        campaign_id=campaign_id,
        page=pagination.page,
        page_size=pagination.page_size,
    )
    return Page(
        items=[CampaignRecipientRead.model_validate(item) for item in items],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.put("/recipients/{recipient_id}", response_model=CampaignRecipientRead)
def update_campaign_recipient(
    recipient_id: uuid.UUID,
    data: CampaignRecipientUpdate,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: ICampaignRecipientRepository = Depends(get_campaign_recipient_repository),
) -> CampaignRecipientRead:
    """Actualiza el estado de envío de un destinatario (solo campos enviados)."""
    fields = data.model_dump(exclude_unset=True)
    if not fields:
        raise InputValidationError(
            "No se recibieron campos para actualizar",
            operation="operations.recipient.update",
            context={"tenant_id": str(tenant_id), "recipient_id": str(recipient_id)},
        )
    row = repository.update(tenant_id=tenant_id, recipient_id=recipient_id, fields=fields)
    if row is None:
        raise NotFoundError(
            "Destinatario no encontrado para el tenant activo",
            operation="operations.recipient.update",
            context={"tenant_id": str(tenant_id), "recipient_id": str(recipient_id)},
        )
    return CampaignRecipientRead.model_validate(row)


@router.post(
    "/campaigns/{campaign_id}/recipients/import-csv",
    response_model=ImportResultRead,
)
def import_campaign_recipients_csv(
    campaign_id: uuid.UUID,
    data: CsvImportRequest,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    recipient_repository: ICampaignRecipientRepository = Depends(
        get_campaign_recipient_repository
    ),
    contact_repository: IContactRepository = Depends(get_contact_repository),
) -> ImportResultRead:
    """Importa destinatarios en lote desde un CSV (texto crudo, cabecera obligatoria).

    Cada fila debe traer ``contact_id`` (UUID) o ``phone`` para localizar el
    contacto del tenant activo. Los contactos ya vinculados a la campaña se
    omiten (skipped). Los errores por fila se acumulan en ``errors``.
    """
    result = ImportResultRead()
    try:
        reader = csv.DictReader(io.StringIO(data.csv), delimiter=data.delimiter)
        rows = list(reader)
    except csv.Error as exc:
        raise InputValidationError(
            f"CSV inválido: {exc}",
            operation="operations.campaign.recipients.import",
            context={"tenant_id": str(tenant_id), "campaign_id": str(campaign_id)},
        ) from exc
    for index, row in enumerate(rows, start=2):
        contact_id_raw = (row.get("contact_id") or "").strip()
        phone = (row.get("phone") or "").strip()
        contact = None
        if contact_id_raw:
            try:
                parsed = uuid.UUID(contact_id_raw)
            except ValueError:
                parsed = None
            if parsed is not None:
                contact = contact_repository.get(
                    tenant_id=tenant_id, contact_id=parsed
                )
        elif phone:
            contact = contact_repository.get_by_phone(
                tenant_id=tenant_id, phone=phone
            )
        if contact is None:
            result.failed += 1
            if len(result.errors) < _MAX_IMPORT_ERRORS:
                result.errors.append(
                    f"fila {index}: contacto no encontrado "
                    f"(contact_id={contact_id_raw or '-'}, phone={phone or '-'})"
                )
            continue
        existing = recipient_repository.get_by_campaign_and_contact(
            tenant_id=tenant_id,
            campaign_id=campaign_id,
            contact_id=contact.id,
        )
        if existing is not None:
            result.skipped += 1
            continue
        recipient_repository.create(
            tenant_id=tenant_id,
            campaign_id=campaign_id,
            contact_id=contact.id,
            state="pending",
            result=None,
            attempts=0,
        )
        result.created += 1
    return result


# ---------------------------------------------------------------------------
# Archivos de destinatarios reutilizables (GAP 2) — CSV + vista previa + envío
# ---------------------------------------------------------------------------
@router.post(
    "/recipient-files",
    response_model=RecipientFileRead,
    status_code=status.HTTP_201_CREATED,
)
def create_recipient_file(
    data: RecipientFileCreate,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IRecipientFileRepository = Depends(get_recipient_file_repository),
) -> RecipientFileRead:
    """Sube un archivo de destinatarios reutilizable (CSV crudo) del tenant.

    El CSV se almacena tal cual (``raw_csv``) junto con metadatos de origen
    (``source_meta``). No se interpreta aquí: la materialización de contactos
    ocurre en la vista previa o al disparar una campaña desde el archivo.
    """
    row = repository.create(
        tenant_id=tenant_id,
        name=data.name,
        content_type=data.content_type,
        raw_csv=data.raw_csv,
        source_meta=data.source_meta,
    )
    return RecipientFileRead.model_validate(row)


@router.get("/recipient-files", response_model=Page[RecipientFileRead])
def list_recipient_files(
    pagination: Pagination = Depends(),
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IRecipientFileRepository = Depends(get_recipient_file_repository),
) -> Page[RecipientFileRead]:
    """Lista los archivos de destinatarios reutilizables del tenant (paginado)."""
    items, total = repository.list(
        tenant_id=tenant_id,
        page=pagination.page,
        page_size=pagination.page_size,
    )
    return Page(
        items=[RecipientFileRead.model_validate(item) for item in items],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.post(
    "/recipient-files/{file_id}/preview",
    response_model=RecipientFilePreviewRead,
)
def preview_recipient_file(
    file_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IRecipientFileRepository = Depends(get_recipient_file_repository),
) -> RecipientFilePreviewRead:
    """Vista previa de los contactos de un archivo (dry-run, sin insertar).

    Parsea el CSV almacenado y devuelve hasta ``_MAX_IMPORT_ERRORS`` filas con
    ``phone``/``name`` detectados. No crea contactos ni destinatarios: es una
    inspección previa al envío masivo.
    """
    row = repository.get(tenant_id=tenant_id, file_id=file_id)
    if row is None:
        raise NotFoundError(
            "Archivo de destinatarios no encontrado",
            operation="operations.recipient_files.preview",
            context={"tenant_id": str(tenant_id), "file_id": str(file_id)},
        )
    try:
        reader = csv.DictReader(io.StringIO(row.raw_csv))
        rows = list(reader)
    except csv.Error as exc:
        raise InputValidationError(
            f"CSV inválido: {exc}",
            operation="operations.recipient_files.preview",
            context={"tenant_id": str(tenant_id), "file_id": str(file_id)},
        ) from exc
    contacts: list[dict[str, Any]] = []
    for index, csv_row in enumerate(rows, start=2):
        phone = (csv_row.get("phone") or "").strip()
        if not phone:
            continue
        contacts.append(
            {
                "phone": phone,
                "name": (csv_row.get("name") or "").strip() or None,
            }
        )
        if len(contacts) >= _MAX_IMPORT_ERRORS:
            break
    return RecipientFilePreviewRead(
        file_id=file_id,
        name=row.name,
        total=len(contacts),
        contacts=contacts,
    )


@router.post(
    "/campaigns/{campaign_id}/dispatch-from-file",
    response_model=DispatchResultRead,
)
def dispatch_campaign_from_file(
    campaign_id: uuid.UUID,
    data: RecipientFileDispatchInput,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    dispatcher: ICampaignDispatcher = Depends(get_campaign_dispatcher),
) -> DispatchResultRead:
    """Despacha una campaña usando un archivo de destinatarios reutilizable (GAP 2).

    Delega en ``CampaignDispatcher.dispatch_campaign_from_file``: materializa los
    contactos del CSV (resolviendo o creando por ``phone``), los registra como
    destinatarios de la campaña (idempotente) y dispara el envío de forma
    inmediata. Devuelve los totales procesados/enviados/fallidos/omitidos.
    """
    totals = dispatcher.dispatch_campaign_from_file(
        tenant_id=tenant_id,
        campaign_id=campaign_id,
        file_id=data.file_id,
    )
    return DispatchResultRead(
        campaigns_processed=totals.campaigns_processed,
        recipients_sent=totals.recipients_sent,
        recipients_failed=totals.recipients_failed,
        recipients_skipped=totals.recipients_skipped,
    )


# ---------------------------------------------------------------------------
# Intervención humana (B.7) — cola pendiente y resolución por operador
# ---------------------------------------------------------------------------
@router.get("/interventions", response_model=Page[InterventionRead])
def list_interventions(
    state: str | None = Query(default=None, max_length=32),
    pagination: Pagination = Depends(),
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IInterventionRepository = Depends(get_intervention_repository),
) -> Page[InterventionRead]:
    """Lista las intervenciones del tenant activo, opcionalmente por estado."""
    if state:
        items, total = repository.list_by_state(
            tenant_id=tenant_id,
            state=state,
            page=pagination.page,
            page_size=pagination.page_size,
        )
    else:
        items, total = repository.list(
            tenant_id=tenant_id, page=pagination.page, page_size=pagination.page_size
        )
    return Page(
        items=[InterventionRead.model_validate(item) for item in items],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.post(
    "/interventions",
    response_model=InterventionRead,
    status_code=status.HTTP_201_CREATED,
)
def create_intervention(
    data: InterventionCreate,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IInterventionRepository = Depends(get_intervention_repository),
) -> InterventionRead:
    """Registra una intervención humana sobre una conversación."""
    row = repository.create(
        tenant_id=tenant_id,
        conversation_id=data.conversation_id,
        state=data.state,
        operator=data.operator,
        notes=data.notes,
        assigned_at=data.assigned_at,
        resolved_at=data.resolved_at,
    )
    return InterventionRead.model_validate(row)


@router.get("/interventions/pending-count", response_model=InterventionPendingCountRead)
def get_interventions_pending_count(
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IInterventionRepository = Depends(get_intervention_repository),
) -> InterventionPendingCountRead:
    """Devuelve el contador de intervenciones pendientes (badge 🆕 del panel)."""
    return InterventionPendingCountRead(
        state="pending",
        count=repository.count_by_state(tenant_id=tenant_id, state="pending"),
    )


@router.get("/interventions/{intervention_id}", response_model=InterventionRead)
def get_intervention(
    intervention_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IInterventionRepository = Depends(get_intervention_repository),
) -> InterventionRead:
    """Devuelve una intervención del tenant activo (404 si no existe)."""
    row = repository.get(tenant_id=tenant_id, intervention_id=intervention_id)
    if row is None:
        raise NotFoundError(
            "Intervención no encontrada para el tenant activo",
            operation="operations.intervention.get",
            context={
                "tenant_id": str(tenant_id),
                "intervention_id": str(intervention_id),
            },
        )
    return InterventionRead.model_validate(row)


@router.put("/interventions/{intervention_id}", response_model=InterventionRead)
def update_intervention(
    intervention_id: uuid.UUID,
    data: InterventionUpdate,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IInterventionRepository = Depends(get_intervention_repository),
) -> InterventionRead:
    """Actualiza una intervención (asignación, notas o resolución)."""
    fields = data.model_dump(exclude_unset=True)
    if not fields:
        raise InputValidationError(
            "No se recibieron campos para actualizar",
            operation="operations.intervention.update",
            context={
                "tenant_id": str(tenant_id),
                "intervention_id": str(intervention_id),
            },
        )
    row = repository.update(
        tenant_id=tenant_id, intervention_id=intervention_id, fields=fields
    )
    if row is None:
        raise NotFoundError(
            "Intervención no encontrada para el tenant activo",
            operation="operations.intervention.update",
            context={
                "tenant_id": str(tenant_id),
                "intervention_id": str(intervention_id),
            },
        )
    return InterventionRead.model_validate(row)


@router.post("/interventions/{intervention_id}/assign", response_model=InterventionRead)
def assign_intervention(
    intervention_id: uuid.UUID,
    data: InterventionAssignRequest,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IInterventionRepository = Depends(get_intervention_repository),
) -> InterventionRead:
    """Asigna una intervención pendiente a un operador (B.7)."""
    row = repository.update(
        tenant_id=tenant_id,
        intervention_id=intervention_id,
        fields={
            "state": "assigned",
            "operator": data.operator,
            "assigned_at": utcnow(),
        },
    )
    if row is None:
        raise NotFoundError(
            "Intervención no encontrada para el tenant activo",
            operation="operations.intervention.assign",
            context={
                "tenant_id": str(tenant_id),
                "intervention_id": str(intervention_id),
            },
        )
    return InterventionRead.model_validate(row)


@router.get(
    "/interventions/{intervention_id}/messages", response_model=list[MessageRead]
)
def list_intervention_messages(
    intervention_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IInterventionRepository = Depends(get_intervention_repository),
    messages: IBotMessageRepository = Depends(get_bot_message_repository),
) -> list[MessageRead]:
    """Lista el historial de chat de la conversación de una intervención (B.7).

    La verificación de pertenencia (intervención existente y del tenant activo)
    es explícita (fail-closed): 404 si no existe o pertenece a otra empresa.
    """
    intervention = repository.get(tenant_id=tenant_id, intervention_id=intervention_id)
    if intervention is None:
        raise NotFoundError(
            "Intervención no encontrada para el tenant activo",
            operation="operations.intervention.messages",
            context={
                "tenant_id": str(tenant_id),
                "intervention_id": str(intervention_id),
            },
        )
    rows = messages.list_by_conversation(
        tenant_id=tenant_id, conversation_id=intervention.conversation_id
    )
    return [MessageRead.model_validate(row) for row in rows]


@router.post("/interventions/{intervention_id}/reply", response_model=MessageRead)
def reply_intervention(
    intervention_id: uuid.UUID,
    data: InterventionReplyRequest,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IInterventionRepository = Depends(get_intervention_repository),
    conversations: IBotConversationRepository = Depends(get_bot_conversation_repository),
    messages: IBotMessageRepository = Depends(get_bot_message_repository),
    queue_service: BotQueueService = Depends(get_bot_queue_service),
    session: Session = Depends(get_session),
) -> MessageRead:
    """Encola una respuesta saliente a la conversación de la intervención (B.7).

    Reutiliza la conversación existente vía ``enqueue_inbound`` con dirección
    ``outbound`` (idempotente por ``message_id`` = uuid4 nuevo por envío).
    """
    intervention = repository.get(tenant_id=tenant_id, intervention_id=intervention_id)
    if intervention is None:
        raise NotFoundError(
            "Intervención no encontrada para el tenant activo",
            operation="operations.intervention.reply",
            context={
                "tenant_id": str(tenant_id),
                "intervention_id": str(intervention_id),
            },
        )
    conversation = conversations.get(
        tenant_id=tenant_id, conversation_id=intervention.conversation_id
    )
    if conversation is None:
        raise NotFoundError(
            "Conversación no encontrada para el tenant activo",
            operation="operations.intervention.reply",
            context={
                "tenant_id": str(tenant_id),
                "conversation_id": str(intervention.conversation_id),
            },
        )
    message_id = str(uuid.uuid4())
    ok = queue_service.enqueue_inbound(
        tenant_id=tenant_id,
        channel_id=conversation.channel_id,
        external_contact_id=conversation.external_contact_id,
        message_id=message_id,
        content=data.content,
        direction=DIRECTION_OUTBOUND,
    )
    if not ok:
        raise InputValidationError(
            "No se pudo encolar la respuesta en la cola D3",
            operation="operations.intervention.reply",
            context={
                "tenant_id": str(tenant_id),
                "intervention_id": str(intervention_id),
            },
        )
    # ``enqueue_inbound`` persiste el mensaje en su PROPIA ``session_scope`` y la
    # confirma. La sesión del request abrió una transacción de lectura al resolver
    # la intervención/conversación; en SQLite (aislamiento de snapshot) ese
    # snapshot predata el commit, así que el read-back no vería el mensaje nuevo.
    # Se confirma la transacción de lectura para que el siguiente SELECT abra un
    # snapshot nuevo (mismo patrón que ``send_conversation_message`` en bot.py).
    session.commit()
    row = messages.get_by_message_id(tenant_id=tenant_id, message_id=message_id)
    if row is None:
        raise NotFoundError(
            "Mensaje no encontrado tras encolar la respuesta",
            operation="operations.intervention.reply",
            context={
                "tenant_id": str(tenant_id),
                "message_id": message_id,
            },
        )
    return MessageRead.model_validate(row)


@router.post(
    "/interventions/{intervention_id}/close", response_model=InterventionCloseResult
)
def close_intervention(
    intervention_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IInterventionRepository = Depends(get_intervention_repository),
) -> InterventionCloseResult:
    """Cierra una intervención humana marcándola como resuelta (B.7)."""
    row = repository.update(
        tenant_id=tenant_id,
        intervention_id=intervention_id,
        fields={"state": "resolved", "resolved_at": utcnow()},
    )
    if row is None:
        raise NotFoundError(
            "Intervención no encontrada para el tenant activo",
            operation="operations.intervention.close",
            context={
                "tenant_id": str(tenant_id),
                "intervention_id": str(intervention_id),
            },
        )
    return InterventionCloseResult(
        intervention_id=row.id,
        state=row.state,
        resolved_at=row.resolved_at,
        message="Intervención cerrada",
    )


@router.get(
    "/monitor/active-conversations", response_model=Page[ActiveConversationRead]
)
def list_active_conversations(
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IBotConversationRepository = Depends(
        get_bot_conversation_repository
    ),
    pagination: Pagination = Depends(),
) -> Page[ActiveConversationRead]:
    """Lista las conversaciones activas del tenant para el Monitor (Fase 7).

    Vista de negocio paginada: agrega por conversación el último mensaje, el
    contador de mensajes y los no leídos (entrantes desde el último saliente).
    Acotado al ``X-Tenant-Id`` del request (aislamiento multi-tenant en el
    propio repositorio).
    """
    items, total = repository.list_active(
        tenant_id=tenant_id, page=pagination.page, page_size=pagination.page_size
    )
    return Page(
        items=[ActiveConversationRead.model_validate(item) for item in items],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


# ---------------------------------------------------------------------------
# Configuración de mantenimiento (B.9) — upsert por tenant
# ---------------------------------------------------------------------------
@router.get("/maintenance", response_model=MaintenanceConfigRead)
def get_maintenance_config(
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IMaintenanceConfigRepository = Depends(get_maintenance_config_repository),
) -> MaintenanceConfigRead:
    """Devuelve la configuración de mantenimiento del tenant (404 si no existe)."""
    row = repository.get(tenant_id=tenant_id)
    if row is None:
        raise NotFoundError(
            "Configuración de mantenimiento no encontrada para el tenant activo",
            operation="operations.maintenance.get",
            context={"tenant_id": str(tenant_id)},
        )
    return MaintenanceConfigRead.model_validate(row)


@router.put("/maintenance", response_model=MaintenanceConfigRead)
def upsert_maintenance_config(
    data: MaintenanceConfigUpsert,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IMaintenanceConfigRepository = Depends(get_maintenance_config_repository),
) -> MaintenanceConfigRead:
    """Crea o actualiza la configuración de mantenimiento (una por tenant)."""
    row = repository.upsert(
        tenant_id=tenant_id,
        retention_rules=data.retention_rules,
        maintenance_schedule=data.maintenance_schedule,
    )
    return MaintenanceConfigRead.model_validate(row)


# ---------------------------------------------------------------------------
# Acciones de mantenimiento (B.9) — purga por retención y optimización física
# ---------------------------------------------------------------------------
@router.post("/maintenance/purge", response_model=MaintenanceActionRead)
def purge_maintenance(
    payload: PurgeRequest,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    privacy: IPrivacyService = Depends(get_bot_privacy_service),
    document_repository: IDocumentRepository = Depends(get_document_repository),
    synonym_repository: ISynonymRepository = Depends(get_synonym_repository),
    rebranding_config_repository: IRebrandingConfigRepository = Depends(
        get_rebranding_config_repository
    ),
    maintenance_config_repository: IMaintenanceConfigRepository = Depends(
        get_maintenance_config_repository
    ),
    container: Container = Depends(get_container),
) -> MaintenanceActionRead:
    """Purga los datos del bot por dominio (B.9 — Limpieza).

    El ``scope`` selecciona el dominio a limpiar, siempre acotado al
    ``X-Tenant-Id`` del request:

    - ``conversations`` — reutiliza :meth:`BotPrivacyService.purge_expired`
      (governance.py): elimina físicamente las conversaciones y mensajes
      anteriores al cutoff de retención global del bot.
    - ``knowledge_base`` — soft-delete de todos los documentos y sinónimos
      de la base de conocimiento del tenant.
    - ``configurations`` — soft-delete de las configuraciones de rebranding
      y de la configuración de mantenimiento del tenant.

    Todos los borrados (salvo conversaciones por retención) son *soft-delete*
    (regla CLAUDE: tupla sync) y se registran en auditoría/log.
    """
    started = datetime.now(timezone.utc)

    if payload.scope == "conversations":
        result = privacy.purge_expired(tenant_id=tenant_id)
        container.logger.warning(
            "maintenance.purge",
            "Purga por retención completada.",
            tenant_id=str(tenant_id),
            scope="conversations",
            deleted_conversations=result.deleted_conversations,
            deleted_messages=result.deleted_messages,
        )
        return MaintenanceActionRead(
            tenant_id=result.tenant_id,
            action="purge",
            deleted_conversations=result.deleted_conversations,
            deleted_messages=result.deleted_messages,
            duration_ms=_elapsed_ms(started),
            message="Purga por retención completada.",
        )

    if payload.scope == "knowledge_base":
        documents = document_repository.list_all(tenant_id=tenant_id)
        for document in documents:
            document_repository.soft_delete(
                tenant_id=tenant_id, document_id=document.id
            )
        synonyms = synonym_repository.list_all(tenant_id=tenant_id)
        for synonym in synonyms:
            synonym_repository.soft_delete(
                tenant_id=tenant_id, synonym_id=synonym.id
            )
        container.logger.warning(
            "maintenance.purge",
            "Base de conocimiento purgada (soft-delete).",
            tenant_id=str(tenant_id),
            scope="knowledge_base",
            deleted_documents=len(documents),
            deleted_synonyms=len(synonyms),
        )
        return MaintenanceActionRead(
            tenant_id=tenant_id,
            action="purge_knowledge_base",
            deleted_documents=len(documents),
            deleted_synonyms=len(synonyms),
            duration_ms=_elapsed_ms(started),
            message="Base de conocimiento purgada (soft-delete).",
        )

    # scope == "configurations"
    configs = rebranding_config_repository.list_all(tenant_id=tenant_id)
    for config in configs:
        rebranding_config_repository.soft_delete(
            tenant_id=tenant_id, config_id=config.id
        )
    maintenance_config_repository.soft_delete(tenant_id=tenant_id)
    container.logger.warning(
        "maintenance.purge",
        "Configuraciones purgadas (soft-delete).",
        tenant_id=str(tenant_id),
        scope="configurations",
        deleted_configs=len(configs),
    )
    return MaintenanceActionRead(
        tenant_id=tenant_id,
        action="purge_configurations",
        deleted_configs=len(configs),
        duration_ms=_elapsed_ms(started),
        message="Configuraciones purgadas (soft-delete).",
    )


@router.post("/maintenance/optimize", response_model=MaintenanceActionRead)
def optimize_maintenance(
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    container: Container = Depends(get_container),
) -> MaintenanceActionRead:
    """Optimización física de la base de datos (B.9 — Optimización).

    Ejecuta ``VACUUM`` + ``REINDEX`` vía :meth:`Database.optimize` (conexión
    cruda en autocommit; ``VACUUM`` no puede correr dentro de una transacción).
    El endpoint exige tenant activo para mantener el mismo contrato de la
    pantalla (403 sin ``X-Tenant-Id``), aunque la operación es física y global.
    """
    result = container.database.optimize()
    return MaintenanceActionRead(
        tenant_id=tenant_id,
        action="optimize",
        duration_ms=result["duration_ms"],
        message="Optimización física completada.",
    )


@router.post("/maintenance/run-scheduled", response_model=ScheduledRunResultRead)
def run_scheduled_maintenance(
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    privacy: IPrivacyService = Depends(get_bot_privacy_service),
    document_repository: IDocumentRepository = Depends(get_document_repository),
    synonym_repository: ISynonymRepository = Depends(get_synonym_repository),
    rebranding_config_repository: IRebrandingConfigRepository = Depends(
        get_rebranding_config_repository
    ),
    maintenance_config_repository: IMaintenanceConfigRepository = Depends(
        get_maintenance_config_repository
    ),
    maintenance_service: IMaintenanceService = Depends(get_maintenance_service),
    container: Container = Depends(get_container),
) -> ScheduledRunResultRead:
    """Ejecuta manualmente el mantenimiento programado configurado (B.9).

    Lee la configuración de mantenimiento del tenant (``maintenance_configs``)
    y ejecuta de inmediato cada tarea habilitada, reportando el resultado por
    tarea (``ok``/``error``/``skipped``) sin abortar el resto si una falla.

    Tareas derivadas de ``retention_rules``:

    - ``conversations`` → purga por retención (``purge_expired``).
    - ``knowledge_base`` → soft-delete de documentos y sinónimos.
    - ``configurations`` → soft-delete de configuraciones de rebranding y
      configuración de mantenimiento.

    Además se ejecutan siempre la optimización física (``Database.optimize``)
    y el backup de la configuración de operación (``MaintenanceService``).
    """
    started = datetime.now(timezone.utc)
    config = maintenance_config_repository.get(tenant_id=tenant_id)
    tasks: list[ScheduledTaskResultRead] = []

    def _record(
        table: str,
        operation: str,
        status: Literal["ok", "error", "skipped"],
        message: str,
    ) -> None:
        tasks.append(
            ScheduledTaskResultRead(
                table=table,
                operation=operation,
                status=status,
                executed_at=datetime.now(timezone.utc),
                message=message,
            )
        )

    # Sin configuración: no hay tareas programadas que ejecutar.
    if config is None:
        _record(
            table="maintenance_configs",
            operation="run_scheduled",
            status="skipped",
            message="No hay configuración de mantenimiento para el tenant.",
        )
        return ScheduledRunResultRead(
            tenant_id=tenant_id,
            tasks=tasks,
            duration_ms=_elapsed_ms(started),
            message="No hay mantenimiento programado configurado.",
        )

    rules = config.retention_rules or {}

    # 1) Purga por retención de conversaciones (si está habilitada).
    if rules.get("conversations") is not None:
        try:
            result = privacy.purge_expired(tenant_id=tenant_id)
            _record(
                table="bot_conversations",
                operation="purge",
                status="ok",
                message=(
                    f"Eliminadas {result.deleted_conversations} conversaciones y "
                    f"{result.deleted_messages} mensajes vencidos."
                ),
            )
        except Exception as exc:  # noqa: BLE001 — aislamiento por tarea
            container.logger.error(
                "maintenance.run_scheduled",
                "Error al purgar conversaciones.",
                tenant_id=str(tenant_id),
                task="conversations",
                error=str(exc),
            )
            _record(
                table="bot_conversations",
                operation="purge",
                status="error",
                message=f"Error al purgar conversaciones: {exc}",
            )
    else:
        _record(
            table="bot_conversations",
            operation="purge",
            status="skipped",
            message="Retención de conversaciones no configurada.",
        )

    # 2) Purga de la base de conocimiento (si está habilitada).
    if rules.get("knowledge_base") is not None:
        try:
            documents = document_repository.list_all(tenant_id=tenant_id)
            for document in documents:
                document_repository.soft_delete(
                    tenant_id=tenant_id, document_id=document.id
                )
            synonyms = synonym_repository.list_all(tenant_id=tenant_id)
            for synonym in synonyms:
                synonym_repository.soft_delete(
                    tenant_id=tenant_id, synonym_id=synonym.id
                )
            _record(
                table="bot_documents",
                operation="purge_knowledge_base",
                status="ok",
                message=(
                    f"Soft-delete de {len(documents)} documentos y "
                    f"{len(synonyms)} sinónimos."
                ),
            )
        except Exception as exc:  # noqa: BLE001 — aislamiento por tarea
            container.logger.error(
                "maintenance.run_scheduled",
                "Error al purgar la base de conocimiento.",
                tenant_id=str(tenant_id),
                task="knowledge_base",
                error=str(exc),
            )
            _record(
                table="bot_documents",
                operation="purge_knowledge_base",
                status="error",
                message=f"Error al purgar la base de conocimiento: {exc}",
            )
    else:
        _record(
            table="bot_documents",
            operation="purge_knowledge_base",
            status="skipped",
            message="Purga de base de conocimiento no configurada.",
        )

    # 3) Purga de configuraciones (si está habilitada).
    if rules.get("configurations") is not None:
        try:
            configs = rebranding_config_repository.list_all(tenant_id=tenant_id)
            for item in configs:
                rebranding_config_repository.soft_delete(
                    tenant_id=tenant_id, config_id=item.id
                )
            maintenance_config_repository.soft_delete(tenant_id=tenant_id)
            _record(
                table="bot_rebranding_configs",
                operation="purge_configurations",
                status="ok",
                message=f"Soft-delete de {len(configs)} configuraciones de rebranding.",
            )
        except Exception as exc:  # noqa: BLE001 — aislamiento por tarea
            container.logger.error(
                "maintenance.run_scheduled",
                "Error al purgar configuraciones.",
                tenant_id=str(tenant_id),
                task="configurations",
                error=str(exc),
            )
            _record(
                table="bot_rebranding_configs",
                operation="purge_configurations",
                status="error",
                message=f"Error al purgar configuraciones: {exc}",
            )
    else:
        _record(
            table="bot_rebranding_configs",
            operation="purge_configurations",
            status="skipped",
            message="Purga de configuraciones no configurada.",
        )

    # 4) Optimización física (siempre).
    try:
        optimize_result = container.database.optimize()
        _record(
            table="database",
            operation="optimize",
            status="ok",
            message=f"Optimización física completada en {optimize_result['duration_ms']} ms.",
        )
    except Exception as exc:  # noqa: BLE001 — aislamiento por tarea
        container.logger.error(
            "maintenance.run_scheduled",
            "Error al optimizar la base de datos.",
            tenant_id=str(tenant_id),
            task="optimize",
            error=str(exc),
        )
        _record(
            table="database",
            operation="optimize",
            status="error",
            message=f"Error al optimizar la base de datos: {exc}",
        )

    # 5) Backup de la configuración de operación (siempre).
    try:
        backup_bytes = maintenance_service.create_backup(tenant_id=tenant_id)
        _record(
            table="operations",
            operation="backup",
            status="ok",
            message=f"Backup generado ({len(backup_bytes)} bytes).",
        )
    except Exception as exc:  # noqa: BLE001 — aislamiento por tarea
        container.logger.error(
            "maintenance.run_scheduled",
            "Error al generar el backup.",
            tenant_id=str(tenant_id),
            task="backup",
            error=str(exc),
        )
        _record(
            table="operations",
            operation="backup",
            status="error",
            message=f"Error al generar el backup: {exc}",
        )

    container.logger.info(
        "maintenance.run_scheduled",
        "Mantenimiento programado ejecutado manualmente.",
        tenant_id=str(tenant_id),
        tasks=len(tasks),
        duration_ms=_elapsed_ms(started),
    )
    return ScheduledRunResultRead(
        tenant_id=tenant_id,
        tasks=tasks,
        duration_ms=_elapsed_ms(started),
        message="Mantenimiento programado ejecutado manualmente.",
    )


@router.get("/maintenance/backup")
def download_maintenance_backup(
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    maintenance: IMaintenanceService = Depends(get_maintenance_service),
) -> StreamingResponse:
    """Descarga el backup de la configuración de operación del tenant (B.9).

    Genera un documento JSON versionado (``omni2.operations.backup`` v1) con las
    7 tablas de operación del bot acotadas al tenant activo y lo devuelve como
    archivo binario (``application/octet-stream``) para su descarga. Los
    metadatos del documento se exponen en la cabecera ``X-Backup-Meta`` para que
    la UI muestre origen y fecha sin parsear el binario.
    """
    payload = maintenance.create_backup(tenant_id=tenant_id)
    meta = BackupMetaRead(
        format="omni2.operations.backup",
        version=1,
        tenant_id=tenant_id,
        created_at=datetime.now(timezone.utc),
    )
    return StreamingResponse(
        iter([payload]),
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="backup-{tenant_id}.json"',
            "X-Backup-Meta": meta.model_dump_json(),
        },
    )


@router.post("/maintenance/restore", response_model=RestoreResultRead)
async def restore_maintenance_backup(
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    maintenance: IMaintenanceService = Depends(get_maintenance_service),
    file: UploadFile = File(...),
) -> RestoreResultRead:
    """Restaura un backup de la configuración de operación del tenant (B.9).

    Recibe el archivo (multipart) generado por ``GET /maintenance/backup``,
    valida su formato/versión/tenant y restaura las filas en una única
    transacción (regla CLAUDE: transaccionalidad). Registra un evento de
    auditoría por operación.
    """
    data = await file.read()
    restored = maintenance.restore_backup(tenant_id=tenant_id, data=data)
    return RestoreResultRead(
        tenant_id=tenant_id,
        restored=restored,
        message="Backup restaurado correctamente.",
    )


# ---------------------------------------------------------------------------
# Estadísticas del bot (B.1 Dashboard + B.2 Estadísticas) — agregados por tenant
# ---------------------------------------------------------------------------
@router.get("/stats/overview", response_model=StatsOverviewRead)
def get_stats_overview(
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IOperationsStatsRepository = Depends(get_operations_stats_repository),
) -> StatsOverviewRead:
    """KPIs agregados del dashboard operativo y estadísticas del bot (B.1 + B.2)."""
    stats = repository.overview(tenant_id=tenant_id)
    return StatsOverviewRead(
        tenant_id=stats.tenant_id,
        active_conversations=stats.active_conversations,
        inbound_messages=stats.inbound_messages,
        outbound_messages=stats.outbound_messages,
        total_messages=stats.total_messages,
        escalated=stats.escalated,
        resolved=stats.resolved,
        resolved_ratio=stats.resolved_ratio,
        unique_contacts=stats.unique_contacts,
        daily=[
            StatsDailyRead(
                date=item.date,
                inbound=item.inbound,
                outbound=item.outbound,
                total=item.total,
            )
            for item in stats.daily
        ],
        by_channel=[
            StatsChannelRead(
                channel_id=item.channel_id,
                conversation_count=item.conversation_count,
                message_count=item.message_count,
            )
            for item in stats.by_channel
        ],
    )


@router.get("/maintenance/table-stats", response_model=list[TableStatsRead])
def get_table_stats(
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IOperationsStatsRepository = Depends(get_operations_stats_repository),
) -> list[TableStatsRead]:
    """Conteo total/activo/inactivo por tabla del tenant (B.9 mantenimiento).

    Devuelve, para cada tabla de operación del bot, el total de filas (incluye
    las marcadas como eliminadas), las activas (``deleted = false``) y las
    inactivas (soft-delete). Permite al operador auditar el volumen de datos
    retenidos por el tenant antes de ejecutar purgas.
    """
    rows = repository.table_stats(tenant_id=tenant_id)
    return [
        TableStatsRead(
            table_name=row.table_name,
            total=row.total,
            active=row.active,
            inactive=row.inactive,
        )
        for row in rows
    ]
