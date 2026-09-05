"""Esquemas del dominio de operación del bot (Bloque B de LAE Omni2.0).

Contrato público de los endpoints ``/operations`` (regla CLAUDE: schema público
validado). Cubre las 7 tablas de operación:

- Contactos (B.6), Plantillas (B.5), Árboles de navegación (B.3),
  Campañas + destinatarios (B.4), Intervención humana (B.7) y
  Configuración de mantenimiento (B.9) y
  Agregados de estadísticas (B.1 Dashboard + B.2 Estadísticas).

Notas de diseño:
- Los esquemas de lectura extienden :class:`ORMModel` y :class:`SyncFields`
  (tupla sync ``[revision, updated_at, deleted]`` para replicación).
- Las columnas JSON (``tags``, ``variables``, ``options``, ``retention_rules``)
  tienen el mismo nombre en el ORM y en el JSON, por lo que no requieren alias.
- ``MaintenanceConfig`` es *upsert* (una fila por tenant): solo existe
  ``MaintenanceConfigUpsert`` + ``MaintenanceConfigRead``.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import ORMModel, SyncFields


class ContactCreate(BaseModel):
    """Payload para crear un contacto del directorio (B.6)."""

    model_config = ConfigDict(extra="forbid")

    phone: str = Field(min_length=1, max_length=32)
    name: str | None = Field(default=None, max_length=255)
    email: str | None = Field(default=None, max_length=255)
    tags: list[str] = Field(default_factory=list)
    state: str = Field(default="new", max_length=32)
    source: str = Field(default="manual", max_length=32)
    external_contact_id: str | None = Field(default=None, max_length=255)
    last_contact_at: datetime | None = None


class ContactUpdate(BaseModel):
    """Payload parcial para actualizar un contacto (PATCH)."""

    model_config = ConfigDict(extra="forbid")

    phone: str | None = Field(default=None, min_length=1, max_length=32)
    name: str | None = Field(default=None, max_length=255)
    email: str | None = Field(default=None, max_length=255)
    tags: list[str] | None = None
    state: str | None = Field(default=None, max_length=32)
    source: str | None = Field(default=None, max_length=32)
    external_contact_id: str | None = Field(default=None, max_length=255)
    last_contact_at: datetime | None = None


class ContactRead(ORMModel, SyncFields):
    """Contacto del directorio tal como se expone a los clientes."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    phone: str
    name: str | None
    email: str | None
    tags: list[str]
    state: str
    source: str
    external_contact_id: str | None
    last_contact_at: datetime | None
    version: int
    created_at: datetime


class TemplateCreate(BaseModel):
    """Payload para crear una plantilla de mensaje (B.5)."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=255)
    body: str = ""
    template_type: str = Field(default="text", max_length=32)
    variables: list[str] = Field(default_factory=list)


class TemplateUpdate(BaseModel):
    """Payload parcial para actualizar una plantilla (PATCH)."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=255)
    body: str | None = None
    template_type: str | None = Field(default=None, max_length=32)
    variables: list[str] | None = None


class TemplateRead(ORMModel, SyncFields):
    """Plantilla de mensaje tal como se expone a los clientes."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    name: str
    body: str
    template_type: str
    variables: list[str]
    version: int
    created_at: datetime


class NavigationTreeCreate(BaseModel):
    """Payload para crear un árbol de navegación (B.3)."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=255)
    num_options: int = Field(default=0, ge=0)
    options: list[dict[str, Any]] = Field(default_factory=list)


class NavigationTreeUpdate(BaseModel):
    """Payload parcial para actualizar un árbol de navegación (PATCH)."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=255)
    num_options: int | None = Field(default=None, ge=0)
    options: list[dict[str, Any]] | None = None


class NavigationTreeRead(ORMModel, SyncFields):
    """Árbol de navegación tal como se expone a los clientes."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    name: str
    num_options: int
    options: list[dict[str, Any]]
    version: int
    created_at: datetime


class CampaignCreate(BaseModel):
    """Payload para crear una campaña de envío (B.4/C-2).

    ``segment_type``: "tags" (audiencia por etiquetas), "event" (contexto del
    evento) o None (todos los contactos activos). ``trigger_type``: "scheduled"
    (por agenda) o "event" (disparo por evento de workflow).
    """

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=255)
    template_id: uuid.UUID | None = None
    state: str = Field(default="draft", max_length=32)
    schedule: datetime | None = None
    segment_type: str | None = Field(default=None, max_length=32)
    segment_config: dict[str, Any] | None = None
    trigger_type: str | None = Field(default=None, max_length=32)
    trigger_event: str | None = Field(default=None, max_length=64)
    landing_id: uuid.UUID | None = None


class CampaignUpdate(BaseModel):
    """Payload parcial para actualizar una campaña (PATCH)."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=255)
    template_id: uuid.UUID | None = None
    state: str | None = Field(default=None, max_length=32)
    schedule: datetime | None = None
    segment_type: str | None = Field(default=None, max_length=32)
    segment_config: dict[str, Any] | None = None
    trigger_type: str | None = Field(default=None, max_length=32)
    trigger_event: str | None = Field(default=None, max_length=64)
    landing_id: uuid.UUID | None = None


class CampaignRead(ORMModel, SyncFields):
    """Campaña de envío tal como se expone a los clientes."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    name: str
    template_id: uuid.UUID | None
    state: str
    schedule: datetime | None
    segment_type: str | None
    segment_config: dict[str, Any] | None
    trigger_type: str | None
    trigger_event: str | None
    landing_id: uuid.UUID | None
    last_triggered_at: datetime | None
    version: int
    created_at: datetime


class CampaignRecipientCreate(BaseModel):
    """Payload para asociar un contacto a una campaña (B.4).

    El ``campaign_id`` proviene de la ruta anidada
    ``/campaigns/{campaign_id}/recipients`` (fuente única de verdad).
    """

    model_config = ConfigDict(extra="forbid")

    contact_id: uuid.UUID
    state: str = Field(default="pending", max_length=32)
    result: str | None = Field(default=None, max_length=255)
    attempts: int = Field(default=0, ge=0)


class CampaignRecipientUpdate(BaseModel):
    """Payload parcial para actualizar el estado de un destinatario (PATCH)."""

    model_config = ConfigDict(extra="forbid")

    state: str | None = Field(default=None, max_length=32)
    result: str | None = Field(default=None, max_length=255)
    attempts: int | None = Field(default=None, ge=0)


class CampaignRecipientRead(ORMModel, SyncFields):
    """Destinatario de campaña tal como se expone a los clientes."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    campaign_id: uuid.UUID
    contact_id: uuid.UUID
    state: str
    result: str | None
    attempts: int
    version: int
    created_at: datetime


class RecipientFileCreate(BaseModel):
    """Payload para subir un archivo de destinatarios reutilizable (GAP 2).

    El CSV se envía como texto crudo (``raw_csv``) con cabecera obligatoria
    (``phone`` y opcionalmente ``name``). ``source_meta`` guarda metadatos de
    origen (delimitador, columnas detectadas, etc.) sin lógica de negocio.
    """

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=255)
    content_type: str = Field(min_length=1, max_length=128)
    raw_csv: str = Field(min_length=1)
    source_meta: dict[str, Any] = Field(default_factory=dict)


class RecipientFileRead(ORMModel, SyncFields):
    """Archivo de destinatarios reutilizable tal como se expone a los clientes."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    name: str
    content_type: str
    source_meta: dict[str, Any]
    version: int
    created_at: datetime


class RecipientFilePreviewRead(BaseModel):
    """Vista previa de contactos de un archivo (dry-run, sin insertar)."""

    model_config = ConfigDict(extra="forbid")

    file_id: uuid.UUID
    name: str
    total: int
    contacts: list[dict[str, Any]]


class RecipientFileDispatchInput(BaseModel):
    """Payload para disparar una campaña desde un archivo de destinatarios (GAP 2)."""

    model_config = ConfigDict(extra="forbid")

    file_id: uuid.UUID


class InterventionCreate(BaseModel):
    """Payload para crear una intervención humana (B.7)."""

    model_config = ConfigDict(extra="forbid")

    conversation_id: uuid.UUID
    state: str = Field(default="pending", max_length=32)
    operator: str | None = Field(default=None, max_length=255)
    notes: str | None = None
    assigned_at: datetime | None = None
    resolved_at: datetime | None = None


class InterventionUpdate(BaseModel):
    """Payload parcial para actualizar una intervención (PATCH)."""

    model_config = ConfigDict(extra="forbid")

    state: str | None = Field(default=None, max_length=32)
    operator: str | None = Field(default=None, max_length=255)
    notes: str | None = None
    assigned_at: datetime | None = None
    resolved_at: datetime | None = None


class InterventionRead(ORMModel, SyncFields):
    """Intervención humana tal como se expone a los clientes."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    conversation_id: uuid.UUID
    state: str
    operator: str | None
    notes: str | None
    assigned_at: datetime | None
    resolved_at: datetime | None
    version: int
    created_at: datetime


class InterventionAssignRequest(BaseModel):
    """Payload para asignar una intervención humana a un operador (B.7)."""

    model_config = ConfigDict(extra="forbid")

    operator: str = Field(min_length=1, max_length=255)


class InterventionReplyRequest(BaseModel):
    """Payload para responder a la conversación de una intervención (B.7)."""

    model_config = ConfigDict(extra="forbid")

    content: str = Field(min_length=1, max_length=4096)


class InterventionPendingCountRead(BaseModel):
    """Contador de intervenciones pendientes (badge 🆕 del panel)."""

    state: str
    count: int


class InterventionCloseResult(BaseModel):
    """Resultado del cierre de una intervención humana (B.7)."""

    intervention_id: uuid.UUID
    state: str
    resolved_at: datetime | None
    message: str


class MaintenanceConfigUpsert(BaseModel):
    """Payload completo de configuración de mantenimiento (PUT idempotente)."""

    model_config = ConfigDict(extra="forbid")

    retention_rules: dict[str, Any] = Field(default_factory=dict)
    maintenance_schedule: str | None = Field(default=None, max_length=64)


class MaintenanceConfigRead(ORMModel, SyncFields):
    """Configuración de mantenimiento del tenant tal como se expone."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    retention_rules: dict[str, Any]
    maintenance_schedule: str | None
    version: int
    created_at: datetime


class PurgeRequest(BaseModel):
    """Payload de purga por dominio en Mantenimiento (B.9 — Limpieza).

    Permite acotar la purga a un dominio concreto del tenant:

    - ``conversations`` (por defecto): conversaciones y mensajes vencidos por
      retención global (comportamiento histórico de ``purge_expired``).
    - ``knowledge_base``: soft-delete de documentos y sinónimos de la base de
      conocimiento (RAG).
    - ``configurations``: soft-delete de configuraciones de rebranding y de la
      configuración de mantenimiento del tenant.
    """

    model_config = ConfigDict(extra="forbid")

    scope: Literal["conversations", "knowledge_base", "configurations"] = "conversations"


class MaintenanceActionRead(BaseModel):
    """Resultado de una acción de mantenimiento ejecutada (B.9).

    Modelo común para las acciones de la pantalla Mantenimiento: purga por
    retención (Limpieza), purga por dominio (base de conocimiento o
    configuraciones) y optimización física (Optimización). Reporta el resultado
    acotado al tenant activo junto con la duración de la operación.
    """

    model_config = ConfigDict(extra="forbid")

    tenant_id: uuid.UUID
    action: Literal[
        "purge", "purge_knowledge_base", "purge_configurations", "optimize"
    ]
    deleted_conversations: int = 0
    deleted_messages: int = 0
    deleted_documents: int = 0
    deleted_synonyms: int = 0
    deleted_configs: int = 0
    duration_ms: int = 0
    message: str


class BackupMetaRead(BaseModel):
    """Metadatos del documento de backup generado (B.9 backup/restaurar).

    Se devuelve como cabecera del archivo descargado (``X-Backup-Meta``) y como
    respuesta de la operación de restauración, para que la UI pueda mostrar el
    origen y la fecha del documento sin parsear el binario.
    """

    model_config = ConfigDict(extra="forbid")

    format: str
    version: int
    tenant_id: uuid.UUID
    created_at: datetime


class RestoreResultRead(BaseModel):
    """Resultado de la restauración de un backup (B.9 backup/restaurar).

    Reporta el número de filas restauradas por tabla, acotado al tenant activo.
    """

    model_config = ConfigDict(extra="forbid")

    tenant_id: uuid.UUID
    restored: dict[str, int]
    message: str


class StatsChannelRead(BaseModel):
    """Agregado de mensajes y conversaciones por canal (B.1/B.2)."""

    model_config = ConfigDict(extra="forbid")

    channel_id: uuid.UUID
    conversation_count: int
    message_count: int


class StatsDailyRead(BaseModel):
    """Mensajes entrantes/salientes agregados por día (B.2 estadísticas)."""

    model_config = ConfigDict(extra="forbid")

    date: date
    inbound: int
    outbound: int
    total: int


class StatsOverviewRead(BaseModel):
    """Dashboard operativo y estadísticas del bot (B.1 + B.2).

    KPIs agregados por tenant: conversaciones activas, mensajes entrantes y
    salientes, intervenciones escaladas/resueltas, contactos únicos y series
    por día y por canal.
    """

    model_config = ConfigDict(extra="forbid")

    tenant_id: uuid.UUID
    active_conversations: int
    inbound_messages: int
    outbound_messages: int
    total_messages: int
    escalated: int
    resolved: int
    resolved_ratio: float
    unique_contacts: int
    daily: list[StatsDailyRead]
    by_channel: list[StatsChannelRead]


class TableStatsRead(BaseModel):
    """Métricas de una tabla de operación del tenant (B.9 — Estado).

    Reporta el total de filas (incluye soft-deleted), las activas
    (``deleted = false``) y las inactivas (soft-deleted) de una tabla de
    operación del bot, acotadas al tenant activo.
    """

    model_config = ConfigDict(extra="forbid")

    table_name: str
    total: int
    active: int
    inactive: int


class ScheduledTaskResultRead(BaseModel):
    """Resultado de una tarea individual del mantenimiento programado (B.9).

    Cada tarea se ejecuta de forma aislada (try/catch por tarea) para que un
    fallo no aborte el resto del lote. ``executed_at`` es el instante en que se
    intentó ejecutar y ``message`` describe el resultado o el error.
    """

    model_config = ConfigDict(extra="forbid")

    table: str
    operation: str
    status: Literal["ok", "error", "skipped"]
    executed_at: datetime
    message: str


class ScheduledRunResultRead(BaseModel):
    """Resultado del lote de mantenimiento programado ejecutado manualmente.

    Devuelve el resultado de cada tarea configurada en ``maintenance_configs``
    (purga por retención, optimización física y backup) junto con la duración
    total del lote. Las tareas se ejecutan en orden y de forma aislada.
    """

    model_config = ConfigDict(extra="forbid")

    tenant_id: uuid.UUID
    tasks: list[ScheduledTaskResultRead]
    duration_ms: int
    message: str


class CsvImportRequest(BaseModel):
    """Payload de importación masiva CSV (texto crudo, sin multipart).

    El cuerpo llega como JSON con el contenido del archivo en ``csv``. No se usa
    ``UploadFile`` para no introducir la dependencia de ``python-multipart``; el
    parseo se hace con el módulo estándar ``csv`` sobre un ``io.StringIO``.
    """

    model_config = ConfigDict(extra="forbid")

    csv: str = Field(min_length=1, description="Contenido del archivo CSV (con cabecera)")
    delimiter: str = Field(default=",", min_length=1, max_length=1)


class ImportResultRead(BaseModel):
    """Resultado de una importación masiva (contactos o destinatarios de campaña)."""

    model_config = ConfigDict(extra="forbid")

    created: int = 0
    skipped: int = 0
    failed: int = 0
    errors: list[str] = Field(default_factory=list)


class DispatchResultRead(BaseModel):
    """Resultado de un despacho de campaña (agendado, por evento o manual)."""

    model_config = ConfigDict(extra="forbid")

    campaigns_processed: int = 0
    recipients_sent: int = 0
    recipients_failed: int = 0
    recipients_skipped: int = 0


class IndividualSendInput(BaseModel):
    """Payload para un envío individual (B.4 — envío puntual a un teléfono).

    Reutiliza una plantilla existente del tenant y permite sobrescribir las
    variables ``{{ var }}`` de su cuerpo. Si no se indica ``contact_id``, el
    contacto se resuelve (o crea) por ``phone`` en el directorio del tenant.
    """

    model_config = ConfigDict(extra="forbid")

    phone: str = Field(min_length=1, max_length=32)
    template_id: uuid.UUID
    contact_id: uuid.UUID | None = None
    variables: dict[str, str] = Field(default_factory=dict)


class MessageSendResultRead(BaseModel):
    """Resultado de un envío individual (B.4)."""

    model_config = ConfigDict(extra="forbid")

    state: Literal["sent", "failed", "skipped"]
    result: str
    contact_id: uuid.UUID
    phone: str


class ActiveConversationRead(BaseModel):
    """Vista de negocio de una conversación activa para el Monitor (Fase 7).

    Modelo de lectura plano (sin ORM) que agrega la actividad de la
    conversación: último mensaje, contador y no leídos (entrantes desde el
    último saliente). Se valida desde :class:`BotActiveConversation` vía
    ``from_attributes=True``.
    """

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: uuid.UUID
    tenant_id: uuid.UUID
    channel_id: uuid.UUID
    external_contact_id: str
    state: str
    is_active: bool
    message_count: int = Field(ge=0)
    unread_count: int = Field(ge=0)
    last_message_content: str | None = None
    last_message_direction: str | None = None
    last_message_at: datetime | None = None
    updated_at: datetime | None = None
