"""Servicio del subsistema CRM (caso de uso: pipeline, tareas, SLA y embudo).

Contrato (PLAN_CRM_E2E_Y_UX §3.1, reglas CLAUDE):
- Toda operación está acotada al ``tenant_id`` activo (defensa en profundidad
  sobre RLS) y se registra en el log de auditoría estructurado.
- Mover un deal a una etapa terminal (``is_terminal``) cierra el deal según su
  resultado estructural ``outcome`` (``won``/``lost``); todo movimiento escribe
  un ``StageChangeRead`` en el historial append-only.
- Errores de dominio se elevan como :class:`AppError` con contexto y
  ``operation`` (regla CLAUDE: error management with context).
- El servicio depende de interfaces (repositorios, auditoría, logger)
  inyectadas desde el composition root — nunca ``new`` (regla DI).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from app.core.errors import ConflictError, InputValidationError, NotFoundError
from app.core.logging import ILogger
from app.models.crm import DealStatus, StageOutcome, TaskPriority, TaskStatus
from app.repositories.crm_interfaces import (
    IDealRepository,
    IFunnelRepository,
    ISlaRepository,
    IStageRepository,
    ITaskRepository,
)
from app.repositories.operations_interfaces import IContactRepository
from app.schemas.common import Page
from app.schemas.crm import (
    CrmSummaryRead,
    DealCreate,
    DealRead,
    DealUpdate,
    FunnelRead,
    FunnelStageRead,
    SlaRead,
    SlaUpsert,
    StageChangeRead,
    StageCreate,
    StageRead,
    StageUpdate,
    TaskCreate,
    TaskRead,
    TaskUpdate,
)
from app.services.crm_interfaces import (
    ICrmEventPublisher,
    LeadNeedsHumanEvent,
    PaymentConfirmedEvent,
)
from app.services.interfaces import ICrmService, IAuditService


class CrmService(ICrmService):
    def __init__(
        self,
        *,
        stage_repository: IStageRepository,
        deal_repository: IDealRepository,
        task_repository: ITaskRepository,
        sla_repository: ISlaRepository,
        funnel_repository: IFunnelRepository,
        contact_repository: IContactRepository,
        audit: IAuditService,
        logger: ILogger,
    ) -> None:
        self._stages = stage_repository
        self._deals = deal_repository
        self._tasks = task_repository
        self._sla = sla_repository
        self._funnel = funnel_repository
        self._contacts = contact_repository
        self._audit = audit
        self._logger = logger

    # ────────────────────────────────────────────────────────────────────────────
    # ETAPAS DEL PIPELINE (M1)
    # ────────────────────────────────────────────────────────────────────────────
    def create_stage(self, *, tenant_id: uuid.UUID, data: StageCreate) -> StageRead:
        self._validate_outcome_invariant(
            is_terminal=data.is_terminal,
            outcome=data.outcome,
            operation="crm.stage.create",
            tenant_id=tenant_id,
        )
        existing = self._stages.get_by_name(tenant_id=tenant_id, name=data.name)
        if existing is not None:
            raise ConflictError(
                "Ya existe una etapa con este nombre",
                operation="crm.stage.create",
                context={"tenant_id": str(tenant_id), "name": data.name},
            )

        stage = self._stages.create(
            tenant_id=tenant_id,
            name=data.name,
            order=data.order,
            default_probability=data.default_probability,
            is_terminal=data.is_terminal,
            outcome=data.outcome,
        )
        self._audit.record(
            tenant_id=tenant_id,
            operation="crm.stage.create",
            entity_type="crm_deal_stage",
            entity_id=str(stage.id),
            details={
                "name": data.name,
                "order": data.order,
                "is_terminal": data.is_terminal,
                "outcome": data.outcome,
            },
        )
        self._logger.info(
            "crm.stage_created",
            message="Etapa del pipeline creada",
            stage_id=str(stage.id),
            tenant_id=str(tenant_id),
            name=data.name,
            is_terminal=data.is_terminal,
        )
        return StageRead.model_validate(stage)

    def get_stage(self, *, tenant_id: uuid.UUID, stage_id: uuid.UUID) -> StageRead:
        stage = self._stages.get(tenant_id=tenant_id, stage_id=stage_id)
        if stage is None:
            raise NotFoundError(
                "Etapa no encontrada",
                operation="crm.stage.get",
                context={"tenant_id": str(tenant_id), "stage_id": str(stage_id)},
            )
        return StageRead.model_validate(stage)

    def list_stages(self, *, tenant_id: uuid.UUID) -> list[StageRead]:
        stages = self._stages.list(tenant_id=tenant_id)
        return [StageRead.model_validate(stage) for stage in stages]

    def update_stage(
        self, *, tenant_id: uuid.UUID, stage_id: uuid.UUID, data: StageUpdate
    ) -> StageRead:
        current = self._stages.get(tenant_id=tenant_id, stage_id=stage_id)
        if current is None:
            raise NotFoundError(
                "Etapa no encontrada",
                operation="crm.stage.update",
                context={"tenant_id": str(tenant_id), "stage_id": str(stage_id)},
            )

        fields = data.model_dump(exclude_unset=True)
        if not fields:
            raise InputValidationError(
                "No se recibieron campos para actualizar",
                operation="crm.stage.update",
                context={"tenant_id": str(tenant_id), "stage_id": str(stage_id)},
            )

        if "name" in fields:
            existing = self._stages.get_by_name(tenant_id=tenant_id, name=fields["name"])
            if existing is not None and existing.id != stage_id:
                raise ConflictError(
                    "Ya existe una etapa con este nombre",
                    operation="crm.stage.update",
                    context={
                        "tenant_id": str(tenant_id),
                        "stage_id": str(stage_id),
                        "name": fields["name"],
                    },
                )

        # Invariante is_terminal ↔ outcome con los valores resultantes.
        is_terminal = fields.get("is_terminal", current.is_terminal)
        outcome = fields.get("outcome", current.outcome)
        self._validate_outcome_invariant(
            is_terminal=is_terminal,
            outcome=outcome,
            operation="crm.stage.update",
            tenant_id=tenant_id,
        )
        if not is_terminal:
            # Normalización estructural: una etapa no terminal nunca lleva outcome.
            fields["outcome"] = None

        stage = self._stages.update(
            tenant_id=tenant_id, stage_id=stage_id, fields=fields
        )
        if stage is None:
            raise NotFoundError(
                "Etapa no encontrada",
                operation="crm.stage.update",
                context={"tenant_id": str(tenant_id), "stage_id": str(stage_id)},
            )
        self._audit.record(
            tenant_id=tenant_id,
            operation="crm.stage.update",
            entity_type="crm_deal_stage",
            entity_id=str(stage_id),
            details={"fields": list(fields.keys())},
        )
        self._logger.info(
            "crm.stage_updated",
            message="Etapa del pipeline actualizada",
            stage_id=str(stage_id),
            tenant_id=str(tenant_id),
            fields=",".join(sorted(fields.keys())),
        )
        return StageRead.model_validate(stage)

    def delete_stage(self, *, tenant_id: uuid.UUID, stage_id: uuid.UUID) -> None:
        stage = self._stages.get(tenant_id=tenant_id, stage_id=stage_id)
        if stage is None:
            raise NotFoundError(
                "Etapa no encontrada",
                operation="crm.stage.delete",
                context={"tenant_id": str(tenant_id), "stage_id": str(stage_id)},
            )

        # Guardia: no se elimina una etapa con deals activos (evita huérfanos).
        _, total = self._deals.list(
            tenant_id=tenant_id, page=1, page_size=1, stage_id=stage_id
        )
        if total > 0:
            raise ConflictError(
                "No se puede eliminar una etapa con oportunidades asociadas",
                operation="crm.stage.delete",
                context={"tenant_id": str(tenant_id), "stage_id": str(stage_id), "deals": total},
            )

        deleted = self._stages.soft_delete(tenant_id=tenant_id, stage_id=stage_id)
        if not deleted:
            raise NotFoundError(
                "Etapa no encontrada",
                operation="crm.stage.delete",
                context={"tenant_id": str(tenant_id), "stage_id": str(stage_id)},
            )
        self._audit.record(
            tenant_id=tenant_id,
            operation="crm.stage.delete",
            entity_type="crm_deal_stage",
            entity_id=str(stage_id),
            details={"deleted": True},
        )
        self._logger.info(
            "crm.stage_deleted",
            message="Etapa del pipeline eliminada (soft delete)",
            stage_id=str(stage_id),
            tenant_id=str(tenant_id),
        )

    # ────────────────────────────────────────────────────────────────────────────
    # OPORTUNIDADES (M1)
    # ────────────────────────────────────────────────────────────────────────────
    def create_deal(self, *, tenant_id: uuid.UUID, data: DealCreate) -> DealRead:
        stage = self._stages.get(tenant_id=tenant_id, stage_id=data.stage_id)
        if stage is None:
            raise NotFoundError(
                "Etapa no encontrada",
                operation="crm.deal.create",
                context={"tenant_id": str(tenant_id), "stage_id": str(data.stage_id)},
            )
        if stage.is_terminal:
            raise InputValidationError(
                "No se puede crear una oportunidad en una etapa terminal",
                operation="crm.deal.create",
                context={"tenant_id": str(tenant_id), "stage_id": str(data.stage_id)},
            )

        deal = self._deals.create(
            tenant_id=tenant_id,
            title=data.title,
            stage_id=data.stage_id,
            amount_minor=data.amount_minor,
            currency=data.currency,
            probability=data.probability,
            owner_id=data.owner_id,
            contact_id=data.contact_id,
            lead_id=data.lead_id,
            quote_id=data.quote_id,
            payment_id=data.payment_id,
            expected_close_at=data.expected_close_at,
            metadata_json=data.metadata,
        )
        # Historial append-only: nacimiento del deal en la etapa inicial.
        self._deals.append_stage_change(
            tenant_id=tenant_id,
            deal_id=deal.id,
            from_stage_id=None,
            to_stage_id=data.stage_id,
            changed_by="sistema",
            note="Creación de la oportunidad",
        )
        self._audit.record(
            tenant_id=tenant_id,
            operation="crm.deal.create",
            entity_type="crm_deal",
            entity_id=str(deal.id),
            details={"title": data.title, "stage_id": str(data.stage_id)},
        )
        self._logger.info(
            "crm.deal_created",
            message="Oportunidad comercial creada",
            deal_id=str(deal.id),
            tenant_id=str(tenant_id),
            title=data.title,
            stage_id=str(data.stage_id),
        )
        return DealRead.model_validate(deal)

    def get_deal(self, *, tenant_id: uuid.UUID, deal_id: uuid.UUID) -> DealRead:
        deal = self._deals.get(tenant_id=tenant_id, deal_id=deal_id)
        if deal is None:
            raise NotFoundError(
                "Oportunidad no encontrada",
                operation="crm.deal.get",
                context={"tenant_id": str(tenant_id), "deal_id": str(deal_id)},
            )
        return DealRead.model_validate(deal)

    def list_deals(
        self,
        *,
        tenant_id: uuid.UUID,
        page: int,
        page_size: int,
        stage_id: uuid.UUID | None = None,
        owner_id: uuid.UUID | None = None,
        status: str | None = None,
    ) -> Page[DealRead]:
        items, total = self._deals.list(
            tenant_id=tenant_id,
            page=page,
            page_size=page_size,
            stage_id=stage_id,
            owner_id=owner_id,
            status=status,
        )
        return Page(
            items=[DealRead.model_validate(item) for item in items],
            total=total,
            page=page,
            page_size=page_size,
        )

    def update_deal(
        self,
        *,
        tenant_id: uuid.UUID,
        deal_id: uuid.UUID,
        data: DealUpdate,
    ) -> DealRead:
        current = self._deals.get(tenant_id=tenant_id, deal_id=deal_id)
        if current is None:
            raise NotFoundError(
                "Oportunidad no encontrada",
                operation="crm.deal.update",
                context={"tenant_id": str(tenant_id), "deal_id": str(deal_id)},
            )

        fields = data.model_dump(exclude_unset=True)
        if not fields:
            raise InputValidationError(
                "No se recibieron campos para actualizar",
                operation="crm.deal.update",
                context={"tenant_id": str(tenant_id), "deal_id": str(deal_id)},
            )

        # Campos operacionales (no columnas): nota del movimiento y razón de pérdida.
        note = fields.pop("note", None)
        lost_reason = fields.pop("lost_reason", None)
        # PATCH semantics: ``metadata`` no puede anularse a NULL (columna NOT NULL).
        if "metadata" in fields and fields["metadata"] is None:
            fields.pop("metadata")
        if lost_reason is not None:
            fields["lost_reason"] = lost_reason

        # Movimiento de etapa → reglas de cierre/reapertura del deal.
        moved = False
        from_stage_id: uuid.UUID | None = None
        if "stage_id" in fields:
            if fields["stage_id"] == current.stage_id:
                # Sin movimiento: se descarta para no ensuciar el historial.
                fields.pop("stage_id")
            else:
                moved = True
                from_stage_id = current.stage_id
                target = self._stages.get(
                    tenant_id=tenant_id, stage_id=fields["stage_id"]
                )
                if target is None:
                    raise NotFoundError(
                        "Etapa destino no encontrada",
                        operation="crm.deal.update",
                        context={
                            "tenant_id": str(tenant_id),
                            "deal_id": str(deal_id),
                            "stage_id": str(fields["stage_id"]),
                        },
                    )
                now = datetime.now(timezone.utc)
                if target.is_terminal:
                    # Cierre: el resultado estructural de la etapa terminal decide.
                    if target.outcome == StageOutcome.WON:
                        fields["status"] = DealStatus.WON
                        fields["closed_at"] = now
                        fields["won_at"] = now
                        fields["lost_at"] = None
                        fields["lost_reason"] = None
                    else:
                        if not lost_reason:
                            raise InputValidationError(
                                "Se requiere 'lost_reason' al mover a una etapa "
                                "terminal con resultado 'lost'",
                                operation="crm.deal.update",
                                context={
                                    "tenant_id": str(tenant_id),
                                    "deal_id": str(deal_id),
                                    "stage_id": str(fields["stage_id"]),
                                },
                            )
                        fields["status"] = DealStatus.LOST
                        fields["closed_at"] = now
                        fields["lost_at"] = now
                        fields["won_at"] = None
                else:
                    # Reapertura: de vuelta al flujo activo tras un cierre.
                    if current.status != DealStatus.OPEN:
                        fields["status"] = DealStatus.OPEN
                        fields["closed_at"] = None
                        fields["won_at"] = None
                        fields["lost_at"] = None
                        fields["lost_reason"] = None

        if not fields:
            raise InputValidationError(
                "No se recibieron campos para actualizar",
                operation="crm.deal.update",
                context={"tenant_id": str(tenant_id), "deal_id": str(deal_id)},
            )

        deal = self._deals.update(
            tenant_id=tenant_id, deal_id=deal_id, fields=fields
        )
        if deal is None:
            raise NotFoundError(
                "Oportunidad no encontrada",
                operation="crm.deal.update",
                context={"tenant_id": str(tenant_id), "deal_id": str(deal_id)},
            )
        if moved:
            self._deals.append_stage_change(
                tenant_id=tenant_id,
                deal_id=deal_id,
                from_stage_id=from_stage_id,
                to_stage_id=deal.stage_id,
                changed_by="vendedor",
                note=note,
            )
        self._audit.record(
            tenant_id=tenant_id,
            operation="crm.deal.update",
            entity_type="crm_deal",
            entity_id=str(deal_id),
            details={"fields": list(fields.keys()), "moved": moved},
        )
        self._logger.info(
            "crm.deal_updated",
            message="Oportunidad comercial actualizada",
            deal_id=str(deal_id),
            tenant_id=str(tenant_id),
            fields=",".join(sorted(fields.keys())),
            moved=moved,
        )
        return DealRead.model_validate(deal)

    def delete_deal(self, *, tenant_id: uuid.UUID, deal_id: uuid.UUID) -> None:
        deleted = self._deals.soft_delete(tenant_id=tenant_id, deal_id=deal_id)
        if not deleted:
            raise NotFoundError(
                "Oportunidad no encontrada",
                operation="crm.deal.delete",
                context={"tenant_id": str(tenant_id), "deal_id": str(deal_id)},
            )
        self._audit.record(
            tenant_id=tenant_id,
            operation="crm.deal.delete",
            entity_type="crm_deal",
            entity_id=str(deal_id),
            details={"deleted": True},
        )
        self._logger.info(
            "crm.deal_deleted",
            message="Oportunidad comercial eliminada (soft delete)",
            deal_id=str(deal_id),
            tenant_id=str(tenant_id),
        )

    def list_history(
        self, *, tenant_id: uuid.UUID, deal_id: uuid.UUID
    ) -> list[StageChangeRead]:
        deal = self._deals.get(tenant_id=tenant_id, deal_id=deal_id)
        if deal is None:
            raise NotFoundError(
                "Oportunidad no encontrada",
                operation="crm.deal.history",
                context={"tenant_id": str(tenant_id), "deal_id": str(deal_id)},
            )
        changes = self._deals.list_stage_changes(
            tenant_id=tenant_id, deal_id=deal_id
        )
        return [StageChangeRead.model_validate(change) for change in changes]

    # ────────────────────────────────────────────────────────────────────────────
    # TAREAS (M2)
    # ────────────────────────────────────────────────────────────────────────────
    def create_task(self, *, tenant_id: uuid.UUID, data: TaskCreate) -> TaskRead:
        if data.deal_id is not None:
            deal = self._deals.get(tenant_id=tenant_id, deal_id=data.deal_id)
            if deal is None:
                raise NotFoundError(
                    "Oportunidad no encontrada",
                    operation="crm.task.create",
                    context={"tenant_id": str(tenant_id), "deal_id": str(data.deal_id)},
                )

        task = self._tasks.create(
            tenant_id=tenant_id,
            deal_id=data.deal_id,
            contact_id=data.contact_id,
            title=data.title,
            due_at=data.due_at,
            status=data.status,
            priority=data.priority,
            assignee_id=data.assignee_id,
        )
        self._audit.record(
            tenant_id=tenant_id,
            operation="crm.task.create",
            entity_type="crm_task",
            entity_id=str(task.id),
            details={"title": data.title, "deal_id": str(data.deal_id) if data.deal_id else None},
        )
        self._logger.info(
            "crm.task_created",
            message="Tarea de seguimiento creada",
            task_id=str(task.id),
            tenant_id=str(tenant_id),
            title=data.title,
            deal_id=str(data.deal_id) if data.deal_id else None,
        )
        return TaskRead.model_validate(task)

    def get_task(self, *, tenant_id: uuid.UUID, task_id: uuid.UUID) -> TaskRead:
        task = self._tasks.get(tenant_id=tenant_id, task_id=task_id)
        if task is None:
            raise NotFoundError(
                "Tarea no encontrada",
                operation="crm.task.get",
                context={"tenant_id": str(tenant_id), "task_id": str(task_id)},
            )
        return TaskRead.model_validate(task)

    def list_tasks(
        self,
        *,
        tenant_id: uuid.UUID,
        page: int,
        page_size: int,
        deal_id: uuid.UUID | None = None,
    ) -> Page[TaskRead]:
        items, total = self._tasks.list(
            tenant_id=tenant_id, page=page, page_size=page_size, deal_id=deal_id
        )
        return Page(
            items=[TaskRead.model_validate(item) for item in items],
            total=total,
            page=page,
            page_size=page_size,
        )

    def update_task(
        self, *, tenant_id: uuid.UUID, task_id: uuid.UUID, data: TaskUpdate
    ) -> TaskRead:
        fields = data.model_dump(exclude_unset=True)
        if not fields:
            raise InputValidationError(
                "No se recibieron campos para actualizar",
                operation="crm.task.update",
                context={"tenant_id": str(tenant_id), "task_id": str(task_id)},
            )
        if "deal_id" in fields and fields["deal_id"] is not None:
            deal = self._deals.get(tenant_id=tenant_id, deal_id=fields["deal_id"])
            if deal is None:
                raise NotFoundError(
                    "Oportunidad no encontrada",
                    operation="crm.task.update",
                    context={"tenant_id": str(tenant_id), "deal_id": str(fields["deal_id"])},
                )

        task = self._tasks.update(
            tenant_id=tenant_id, task_id=task_id, fields=fields
        )
        if task is None:
            raise NotFoundError(
                "Tarea no encontrada",
                operation="crm.task.update",
                context={"tenant_id": str(tenant_id), "task_id": str(task_id)},
            )
        self._audit.record(
            tenant_id=tenant_id,
            operation="crm.task.update",
            entity_type="crm_task",
            entity_id=str(task_id),
            details={"fields": list(fields.keys())},
        )
        self._logger.info(
            "crm.task_updated",
            message="Tarea de seguimiento actualizada",
            task_id=str(task_id),
            tenant_id=str(tenant_id),
            fields=",".join(sorted(fields.keys())),
        )
        return TaskRead.model_validate(task)

    def delete_task(self, *, tenant_id: uuid.UUID, task_id: uuid.UUID) -> None:
        deleted = self._tasks.soft_delete(tenant_id=tenant_id, task_id=task_id)
        if not deleted:
            raise NotFoundError(
                "Tarea no encontrada",
                operation="crm.task.delete",
                context={"tenant_id": str(tenant_id), "task_id": str(task_id)},
            )
        self._audit.record(
            tenant_id=tenant_id,
            operation="crm.task.delete",
            entity_type="crm_task",
            entity_id=str(task_id),
            details={"deleted": True},
        )
        self._logger.info(
            "crm.task_deleted",
            message="Tarea de seguimiento eliminada (soft delete)",
            task_id=str(task_id),
            tenant_id=str(tenant_id),
        )

    # ────────────────────────────────────────────────────────────────────────────
    # SLA (M5)
    # ────────────────────────────────────────────────────────────────────────────
    def upsert_sla(self, *, tenant_id: uuid.UUID, data: SlaUpsert) -> SlaRead:
        stage = self._stages.get(tenant_id=tenant_id, stage_id=data.stage_id)
        if stage is None:
            raise NotFoundError(
                "Etapa no encontrada",
                operation="crm.sla.upsert",
                context={"tenant_id": str(tenant_id), "stage_id": str(data.stage_id)},
            )
        sla = self._sla.upsert(
            tenant_id=tenant_id,
            stage_id=data.stage_id,
            max_response_hours=data.max_response_hours,
            max_stay_days=data.max_stay_days,
        )
        self._audit.record(
            tenant_id=tenant_id,
            operation="crm.sla.upsert",
            entity_type="crm_sla_policy",
            entity_id=str(sla.id),
            details={
                "stage_id": str(data.stage_id),
                "max_response_hours": data.max_response_hours,
                "max_stay_days": data.max_stay_days,
            },
        )
        self._logger.info(
            "crm.sla_upserted",
            message="Política de SLA registrada",
            sla_id=str(sla.id),
            tenant_id=str(tenant_id),
            stage_id=str(data.stage_id),
        )
        return SlaRead.model_validate(sla)

    def list_sla(self, *, tenant_id: uuid.UUID) -> list[SlaRead]:
        policies = self._sla.list(tenant_id=tenant_id)
        return [SlaRead.model_validate(policy) for policy in policies]

    # ────────────────────────────────────────────────────────────────────────────
    # REPORTES
    # ────────────────────────────────────────────────────────────────────────────
    def funnel(self, *, tenant_id: uuid.UUID) -> FunnelRead:
        aggregate = self._funnel.funnel(tenant_id=tenant_id)
        stages = sorted(aggregate.stages, key=lambda s: s.order)

        rows: list[FunnelStageRead] = []
        for index, stage in enumerate(stages):
            if index < len(stages) - 1 and stages[index].count > 0:
                conversion_rate = round(
                    stages[index + 1].count / stages[index].count, 4
                )
            else:
                conversion_rate = None
            rows.append(
                FunnelStageRead(
                    stage_id=stage.stage_id,
                    stage_name=stage.stage_name,
                    count=stage.count,
                    total_amount_minor=stage.total_amount_minor,
                    weighted_value_minor=stage.weighted_value_minor,
                    conversion_rate=conversion_rate,
                    avg_cycle_days=None,
                )
            )

        won = aggregate.won_count
        lost = aggregate.lost_count
        close_rate = round(won / (won + lost), 4) if (won + lost) > 0 else 0.0
        return FunnelRead(
            stages=rows,
            total_deals=aggregate.total_deals,
            won_count=aggregate.won_count,
            lost_count=aggregate.lost_count,
            open_count=aggregate.open_count,
            won_amount_minor=aggregate.won_amount_minor,
            close_rate=close_rate,
            avg_cycle_days=aggregate.avg_cycle_days,
        )

    def summary(self, *, tenant_id: uuid.UUID, email: str) -> CrmSummaryRead:
        contact = self._contacts.get_by_email(tenant_id=tenant_id, email=email)
        if contact is None:
            return CrmSummaryRead(
                deals=[], tasks=[], total_deals=0, open_deals=0, won_deals=0
            )

        deals = self._deals.list_by_contact(
            tenant_id=tenant_id, contact_id=contact.id
        )
        tasks = self._tasks.list_by_contact(
            tenant_id=tenant_id, contact_id=contact.id
        )
        return CrmSummaryRead(
            deals=[DealRead.model_validate(deal) for deal in deals],
            tasks=[TaskRead.model_validate(task) for task in tasks],
            total_deals=len(deals),
            open_deals=sum(1 for deal in deals if deal.status == DealStatus.OPEN),
            won_deals=sum(1 for deal in deals if deal.status == DealStatus.WON),
        )

    # ────────────────────────────────────────────────────────────────────────────
    # ORQUESTACIÓN (P2): eventos consumidos por el subsistema CRM
    # ────────────────────────────────────────────────────────────────────────────
    def create_deal_from_lead(
        self,
        *,
        tenant_id: uuid.UUID,
        lead_id: uuid.UUID,
        name: str,
        email: str,
        phone: str | None,
        source: str,
        metadata: dict[str, Any],
    ) -> DealRead | None:
        """Auto-crea la oportunidad (+ tarea) a partir de un lead ``needs_human``.

        Idempotente: si el lead/contacto ya tiene una oportunidad abierta,
        devuelve la existente sin duplicar (el ciclo ⑤→⑥→⑩ es repetible).
        El deal se coloca en la primera etapa no terminal (menor ``order``) y
        se crea la tarea "Contactar al lead" con vencimiento según la política
        SLA de la etapa (M5) si existe.
        """
        contact = self._contacts.get_by_email(tenant_id=tenant_id, email=email)
        if contact is None and phone:
            contact = self._contacts.get_by_phone(tenant_id=tenant_id, phone=phone)

        if contact is not None:
            open_deals = [
                deal
                for deal in self._deals.list_by_contact(
                    tenant_id=tenant_id, contact_id=contact.id
                )
                if deal.status == DealStatus.OPEN
            ]
            if open_deals:
                return DealRead.model_validate(open_deals[0])

        non_terminal = [
            stage
            for stage in self._stages.list(tenant_id=tenant_id)
            if not stage.is_terminal
        ]
        if not non_terminal:
            self._logger.warning(
                "crm.lead_deal_skipped",
                message="Sin etapa no terminal para auto-crear la oportunidad",
                tenant_id=str(tenant_id),
                lead_id=str(lead_id),
            )
            return None
        non_terminal.sort(key=lambda stage: stage.order)
        stage = non_terminal[0]

        extra_metadata = dict(metadata or {})
        extra_metadata.setdefault("origin", "lead_needs_human")
        extra_metadata.setdefault("lead_source", source)

        deal = self._deals.create(
            tenant_id=tenant_id,
            title=f"Oportunidad: {name}",
            stage_id=stage.id,
            amount_minor=0,
            currency="USD",
            probability=stage.default_probability,
            owner_id=None,
            contact_id=contact.id if contact is not None else None,
            lead_id=lead_id,
            quote_id=None,
            payment_id=None,
            expected_close_at=None,
            metadata_json=extra_metadata,
        )
        self._deals.append_stage_change(
            tenant_id=tenant_id,
            deal_id=deal.id,
            from_stage_id=None,
            to_stage_id=stage.id,
            changed_by="sistema",
            note="Creación automática desde lead con atención humana",
        )

        due_at: datetime | None = None
        sla = self._sla.get_by_stage(tenant_id=tenant_id, stage_id=stage.id)
        if sla is not None and sla.max_response_hours > 0:
            due_at = datetime.now(timezone.utc) + timedelta(hours=sla.max_response_hours)
        self._tasks.create(
            tenant_id=tenant_id,
            deal_id=deal.id,
            contact_id=contact.id if contact is not None else None,
            title="Contactar al lead",
            due_at=due_at,
            status=TaskStatus.PENDING,
            priority=TaskPriority.HIGH,
            assignee_id=None,
        )

        self._audit.record(
            tenant_id=tenant_id,
            operation="crm.deal.create_from_lead",
            entity_type="crm_deal",
            entity_id=str(deal.id),
            details={"lead_id": str(lead_id), "stage_id": str(stage.id), "source": source},
        )
        self._logger.info(
            "crm.deal_created_from_lead",
            message="Oportunidad auto-creada desde lead con atención humana",
            deal_id=str(deal.id),
            tenant_id=str(tenant_id),
            lead_id=str(lead_id),
            stage_id=str(stage.id),
        )
        return DealRead.model_validate(deal)

    def suggest_won(
        self,
        *,
        tenant_id: uuid.UUID,
        customer_email: str,
        source: str,
    ) -> int:
        """Registra la sugerencia ``Ganado`` en las oportunidades abiertas.

        No mueve el deal (la decisión la toma el vendedor): solo escribe la
        sugerencia ``{"type": "won", "source", "suggested_at"}`` en la metadata
        de cada oportunidad abierta ligada al contacto. Devuelve el conteo de
        deals marcados (0 si el cliente no existe o no tiene oportunidades).
        """
        contact = self._contacts.get_by_email(
            tenant_id=tenant_id, email=customer_email
        )
        if contact is None:
            return 0

        suggestion = {
            "type": "won",
            "source": source,
            "suggested_at": datetime.now(timezone.utc).isoformat(),
        }
        flagged = 0
        for deal in self._deals.list_by_contact(
            tenant_id=tenant_id, contact_id=contact.id
        ):
            if deal.status != DealStatus.OPEN:
                continue
            merged = dict(deal.metadata_json or {})
            merged["crm_suggestion"] = suggestion
            self._deals.update(
                tenant_id=tenant_id,
                deal_id=deal.id,
                fields={"metadata": merged},
            )
            flagged += 1

        if flagged:
            self._audit.record(
                tenant_id=tenant_id,
                operation="crm.deal.suggest_won",
                entity_type="crm_deal",
                entity_id=None,
                details={
                    "customer_email": customer_email,
                    "count": flagged,
                    "source": source,
                },
            )
            self._logger.info(
                "crm.deal_suggested_won",
                message="Sugerencia de cierre Ganado registrada",
                tenant_id=str(tenant_id),
                customer_email=customer_email,
                count=flagged,
                source=source,
            )
        return flagged

    # ────────────────────────────────────────────────────────────────────────────
    # HELPERS DE DOMINIO
    # ────────────────────────────────────────────────────────────────────────────
    @staticmethod
    def _validate_outcome_invariant(
        *,
        is_terminal: bool,
        outcome: str | None,
        operation: str,
        tenant_id: uuid.UUID,
    ) -> None:
        """Invariante estructural: outcome no-nulo si y sólo si is_terminal."""
        if is_terminal and outcome is None:
            raise InputValidationError(
                "Una etapa terminal debe declarar su resultado ('won' o 'lost')",
                operation=operation,
                context={"tenant_id": str(tenant_id), "is_terminal": True, "outcome": None},
            )
        if not is_terminal and outcome is not None:
            raise InputValidationError(
                "Una etapa no terminal no puede llevar resultado de cierre",
                operation=operation,
                context={"tenant_id": str(tenant_id), "is_terminal": False, "outcome": outcome},
            )


class CrmEventPublisher(ICrmEventPublisher):
    """Emisor de eventos de orquestación → delega en :class:`CrmService`.

    Conecta los workflows con el subsistema CRM sin importaciones cruzadas
    (regla CLAUDE: DI): el servicio de workflows solo conoce el puerto
    :class:`ICrmEventPublisher` y este emisor traduce el payload desacoplado
    a las operaciones de dominio del CRM.
    """

    def __init__(self, *, crm_service: CrmService) -> None:
        self._crm = crm_service

    def publish_lead_needs_human(self, *, event: LeadNeedsHumanEvent) -> None:
        self._crm.create_deal_from_lead(
            tenant_id=event.tenant_id,
            lead_id=event.lead_id,
            name=event.name,
            email=event.email,
            phone=event.phone,
            source=event.source,
            metadata=event.metadata,
        )

    def publish_payment_confirmed(self, *, event: PaymentConfirmedEvent) -> None:
        if not event.customer_email:
            return
        self._crm.suggest_won(
            tenant_id=event.tenant_id,
            customer_email=event.customer_email,
            source=f"payment:{event.payment_id}",
        )
