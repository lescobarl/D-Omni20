"""Implementaciones SQLAlchemy de los repositorios del subsistema CRM.

Reglas aplicadas (mismo patrón que ``ads_repositories.py``):
- Toda query se acota por ``tenant_id`` y ``deleted=False`` (defensa en
  profundidad junto con RLS de PostgreSQL).
- ``_apply_fields`` falla rápido ante campos desconocidos y mapea
  ``metadata`` → columna ORM ``metadata_json``.
- Sin ``try/except`` vacío: los errores se propagan al servicio con contexto.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import Integer, cast, func, select
from sqlalchemy.orm import Session

from app.models.crm import (
    CrmDeal,
    CrmDealStage,
    CrmDealStageChange,
    CrmSlaPolicy,
    CrmTask,
    DealStatus,
)
from app.repositories.crm_interfaces import (
    FunnelAggregate,
    FunnelStageAggregate,
    IDealRepository,
    IFunnelRepository,
    ISlaRepository,
    IStageRepository,
    ITaskRepository,
)


class SqlAlchemyStageRepository(IStageRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    # ── Helpers ──────────────────────────────────────────────────────────────
    @staticmethod
    def _active_scope(tenant_id: uuid.UUID) -> Any:
        """Filtro común: tenant activo + sin soft-delete."""
        return (CrmDealStage.tenant_id == tenant_id) & (CrmDealStage.deleted.is_(False))

    @staticmethod
    def _apply_fields(entity: CrmDealStage, fields: dict[str, Any]) -> None:
        """Aplica solo los campos existentes en la entidad (fail-fast al resto)."""
        for key, value in fields.items():
            if not hasattr(entity, key):
                raise ValueError(f"Campo desconocido para la entidad: {key}")
            setattr(entity, key, value)

    # ── CRUD ─────────────────────────────────────────────────────────────────
    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        name: str,
        order: int,
        default_probability: int,
        is_terminal: bool,
        outcome: str | None,
    ) -> CrmDealStage:
        stage = CrmDealStage(
            tenant_id=tenant_id,
            name=name,
            order=order,
            default_probability=default_probability,
            is_terminal=is_terminal,
            outcome=outcome,
        )
        self._session.add(stage)
        self._session.flush()
        return stage

    def get(self, *, tenant_id: uuid.UUID, stage_id: uuid.UUID) -> CrmDealStage | None:
        statement = select(CrmDealStage).where(
            CrmDealStage.id == stage_id,
            self._active_scope(tenant_id),
        )
        return self._session.scalars(statement).first()

    def get_by_name(self, *, tenant_id: uuid.UUID, name: str) -> CrmDealStage | None:
        statement = select(CrmDealStage).where(
            CrmDealStage.name == name,
            self._active_scope(tenant_id),
        )
        return self._session.scalars(statement).first()

    def list(self, *, tenant_id: uuid.UUID) -> list[CrmDealStage]:
        statement = (
            select(CrmDealStage)
            .where(self._active_scope(tenant_id))
            .order_by(CrmDealStage.order.asc())
        )
        return list(self._session.scalars(statement).all())

    def update(
        self, *, tenant_id: uuid.UUID, stage_id: uuid.UUID, fields: dict[str, Any]
    ) -> CrmDealStage | None:
        stage = self.get(tenant_id=tenant_id, stage_id=stage_id)
        if stage is None:
            return None
        self._apply_fields(stage, fields)
        self._session.flush()
        return stage

    def soft_delete(self, *, tenant_id: uuid.UUID, stage_id: uuid.UUID) -> bool:
        stage = self.get(tenant_id=tenant_id, stage_id=stage_id)
        if stage is None:
            return False
        stage.deleted = True
        self._session.flush()
        return True


class SqlAlchemyDealRepository(IDealRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    # ── Helpers ──────────────────────────────────────────────────────────────
    @staticmethod
    def _active_scope(tenant_id: uuid.UUID) -> Any:
        """Filtro común: tenant activo + sin soft-delete."""
        return (CrmDeal.tenant_id == tenant_id) & (CrmDeal.deleted.is_(False))

    @staticmethod
    def _apply_fields(entity: CrmDeal, fields: dict[str, Any]) -> None:
        """Aplica solo los campos existentes; mapea ``metadata`` → ``metadata_json``."""
        for key, value in fields.items():
            target = "metadata_json" if key == "metadata" else key
            if not hasattr(entity, target):
                raise ValueError(f"Campo desconocido para la entidad: {key}")
            setattr(entity, target, value)

    # ── CRUD ─────────────────────────────────────────────────────────────────
    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        title: str,
        stage_id: uuid.UUID,
        amount_minor: int,
        currency: str,
        probability: int,
        owner_id: uuid.UUID | None,
        contact_id: uuid.UUID | None,
        lead_id: uuid.UUID | None,
        quote_id: uuid.UUID | None,
        payment_id: uuid.UUID | None,
        expected_close_at: date | None,
        metadata_json: dict[str, Any] | None,
    ) -> CrmDeal:
        deal = CrmDeal(
            tenant_id=tenant_id,
            title=title,
            stage_id=stage_id,
            amount_minor=amount_minor,
            currency=currency,
            probability=probability,
            owner_id=owner_id,
            contact_id=contact_id,
            lead_id=lead_id,
            quote_id=quote_id,
            payment_id=payment_id,
            expected_close_at=expected_close_at,
            metadata_json=metadata_json or {},
        )
        self._session.add(deal)
        self._session.flush()
        return deal

    def get(self, *, tenant_id: uuid.UUID, deal_id: uuid.UUID) -> CrmDeal | None:
        statement = select(CrmDeal).where(
            CrmDeal.id == deal_id,
            self._active_scope(tenant_id),
        )
        return self._session.scalars(statement).first()

    def list(
        self,
        *,
        tenant_id: uuid.UUID,
        page: int,
        page_size: int,
        stage_id: uuid.UUID | None = None,
        owner_id: uuid.UUID | None = None,
        status: str | None = None,
    ) -> tuple[list[CrmDeal], int]:
        filters = [self._active_scope(tenant_id)]
        if stage_id is not None:
            filters.append(CrmDeal.stage_id == stage_id)
        if owner_id is not None:
            filters.append(CrmDeal.owner_id == owner_id)
        if status is not None:
            filters.append(CrmDeal.status == status)

        base = select(CrmDeal).where(*filters)
        total = self._session.scalar(select(func.count()).select_from(base.subquery())) or 0
        statement = (
            base.order_by(CrmDeal.updated_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        items = list(self._session.scalars(statement).all())
        return items, total

    def list_by_contact(self, *, tenant_id: uuid.UUID, contact_id: uuid.UUID) -> list[CrmDeal]:
        statement = (
            select(CrmDeal)
            .where(
                self._active_scope(tenant_id),
                CrmDeal.contact_id == contact_id,
            )
            .order_by(CrmDeal.updated_at.desc())
        )
        return list(self._session.scalars(statement).all())

    def update(
        self, *, tenant_id: uuid.UUID, deal_id: uuid.UUID, fields: dict[str, Any]
    ) -> CrmDeal | None:
        deal = self.get(tenant_id=tenant_id, deal_id=deal_id)
        if deal is None:
            return None
        self._apply_fields(deal, fields)
        self._session.flush()
        return deal

    def soft_delete(self, *, tenant_id: uuid.UUID, deal_id: uuid.UUID) -> bool:
        deal = self.get(tenant_id=tenant_id, deal_id=deal_id)
        if deal is None:
            return False
        deal.deleted = True
        self._session.flush()
        return True

    # ── Historial de movimientos (append-only) ───────────────────────────────
    def append_stage_change(
        self,
        *,
        tenant_id: uuid.UUID,
        deal_id: uuid.UUID,
        from_stage_id: uuid.UUID | None,
        to_stage_id: uuid.UUID | None,
        changed_by: str,
        note: str | None,
    ) -> CrmDealStageChange:
        change = CrmDealStageChange(
            tenant_id=tenant_id,
            deal_id=deal_id,
            from_stage_id=from_stage_id,
            to_stage_id=to_stage_id,
            changed_by=changed_by,
            note=note,
        )
        self._session.add(change)
        self._session.flush()
        return change

    def list_stage_changes(
        self, *, tenant_id: uuid.UUID, deal_id: uuid.UUID
    ) -> list[CrmDealStageChange]:
        statement = (
            select(CrmDealStageChange)
            .where(
                (CrmDealStageChange.tenant_id == tenant_id)
                & (CrmDealStageChange.deleted.is_(False)),
                CrmDealStageChange.deal_id == deal_id,
            )
            .order_by(CrmDealStageChange.created_at.asc())
        )
        return list(self._session.scalars(statement).all())


class SqlAlchemyTaskRepository(ITaskRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    # ── Helpers ──────────────────────────────────────────────────────────────
    @staticmethod
    def _active_scope(tenant_id: uuid.UUID) -> Any:
        """Filtro común: tenant activo + sin soft-delete."""
        return (CrmTask.tenant_id == tenant_id) & (CrmTask.deleted.is_(False))

    @staticmethod
    def _apply_fields(entity: CrmTask, fields: dict[str, Any]) -> None:
        """Aplica solo los campos existentes en la entidad (fail-fast al resto)."""
        for key, value in fields.items():
            if not hasattr(entity, key):
                raise ValueError(f"Campo desconocido para la entidad: {key}")
            setattr(entity, key, value)

    # ── CRUD ─────────────────────────────────────────────────────────────────
    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        deal_id: uuid.UUID | None,
        contact_id: uuid.UUID | None,
        title: str,
        due_at: datetime | None,
        status: str,
        priority: str,
        assignee_id: uuid.UUID | None,
    ) -> CrmTask:
        task = CrmTask(
            tenant_id=tenant_id,
            deal_id=deal_id,
            contact_id=contact_id,
            title=title,
            due_at=due_at,
            status=status,
            priority=priority,
            assignee_id=assignee_id,
        )
        self._session.add(task)
        self._session.flush()
        return task

    def get(self, *, tenant_id: uuid.UUID, task_id: uuid.UUID) -> CrmTask | None:
        statement = select(CrmTask).where(
            CrmTask.id == task_id,
            self._active_scope(tenant_id),
        )
        return self._session.scalars(statement).first()

    def list(
        self,
        *,
        tenant_id: uuid.UUID,
        page: int,
        page_size: int,
        deal_id: uuid.UUID | None = None,
    ) -> tuple[list[CrmTask], int]:
        filters = [self._active_scope(tenant_id)]
        if deal_id is not None:
            filters.append(CrmTask.deal_id == deal_id)

        base = select(CrmTask).where(*filters)
        total = self._session.scalar(select(func.count()).select_from(base.subquery())) or 0
        statement = (
            base.order_by(CrmTask.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        items = list(self._session.scalars(statement).all())
        return items, total

    def list_by_deal(self, *, tenant_id: uuid.UUID, deal_id: uuid.UUID) -> list[CrmTask]:
        statement = (
            select(CrmTask)
            .where(
                self._active_scope(tenant_id),
                CrmTask.deal_id == deal_id,
            )
            .order_by(CrmTask.due_at.asc().nulls_last(), CrmTask.created_at.asc())
        )
        return list(self._session.scalars(statement).all())

    def list_by_contact(self, *, tenant_id: uuid.UUID, contact_id: uuid.UUID) -> list[CrmTask]:
        statement = (
            select(CrmTask)
            .where(
                self._active_scope(tenant_id),
                CrmTask.contact_id == contact_id,
            )
            .order_by(CrmTask.due_at.asc().nulls_last(), CrmTask.created_at.asc())
        )
        return list(self._session.scalars(statement).all())

    def update(
        self, *, tenant_id: uuid.UUID, task_id: uuid.UUID, fields: dict[str, Any]
    ) -> CrmTask | None:
        task = self.get(tenant_id=tenant_id, task_id=task_id)
        if task is None:
            return None
        self._apply_fields(task, fields)
        # Estado "done" registra completed_at automáticamente.
        if getattr(task, "status", None) == "done" and task.completed_at is None:
            task.completed_at = datetime.now(timezone.utc)
        elif getattr(task, "status", None) != "done":
            task.completed_at = None
        self._session.flush()
        return task

    def soft_delete(self, *, tenant_id: uuid.UUID, task_id: uuid.UUID) -> bool:
        task = self.get(tenant_id=tenant_id, task_id=task_id)
        if task is None:
            return False
        task.deleted = True
        self._session.flush()
        return True


class SqlAlchemySlaRepository(ISlaRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    # ── Helpers ──────────────────────────────────────────────────────────────
    @staticmethod
    def _active_scope(tenant_id: uuid.UUID) -> Any:
        """Filtro común: tenant activo + sin soft-delete."""
        return (CrmSlaPolicy.tenant_id == tenant_id) & (CrmSlaPolicy.deleted.is_(False))

    # ── CRUD ─────────────────────────────────────────────────────────────────
    def upsert(
        self,
        *,
        tenant_id: uuid.UUID,
        stage_id: uuid.UUID,
        max_response_hours: int,
        max_stay_days: int,
    ) -> CrmSlaPolicy:
        policy = self.get_by_stage(tenant_id=tenant_id, stage_id=stage_id)
        if policy is None:
            policy = CrmSlaPolicy(
                tenant_id=tenant_id,
                stage_id=stage_id,
                max_response_hours=max_response_hours,
                max_stay_days=max_stay_days,
            )
            self._session.add(policy)
        else:
            policy.max_response_hours = max_response_hours
            policy.max_stay_days = max_stay_days
        self._session.flush()
        return policy

    def get_by_stage(self, *, tenant_id: uuid.UUID, stage_id: uuid.UUID) -> CrmSlaPolicy | None:
        statement = select(CrmSlaPolicy).where(
            CrmSlaPolicy.stage_id == stage_id,
            self._active_scope(tenant_id),
        )
        return self._session.scalars(statement).first()

    def list(self, *, tenant_id: uuid.UUID) -> list[CrmSlaPolicy]:
        statement = (
            select(CrmSlaPolicy)
            .where(self._active_scope(tenant_id))
            .order_by(CrmSlaPolicy.created_at.asc())
        )
        return list(self._session.scalars(statement).all())

    def soft_delete(self, *, tenant_id: uuid.UUID, sla_id: uuid.UUID) -> bool:
        policy = self.get_by_stage(tenant_id=tenant_id, stage_id=sla_id)
        if policy is None:
            return False
        policy.deleted = True
        self._session.flush()
        return True


class SqlAlchemyFunnelRepository(IFunnelRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    def funnel(self, *, tenant_id: uuid.UUID) -> FunnelAggregate:
        """Agrega el embudo del tenant: conteo/montos por etapa + cierres.

        El valor ponderado (monto × probabilidad) y el tiempo de ciclo medio se
        calculan con operadores portables (SQLAlchemy core), sin SQL propietario.
        """
        # ── Por etapa (deals abiertos) ───────────────────────────────────────
        stage_statement = (
            select(
                CrmDealStage.id,
                CrmDealStage.name,
                CrmDealStage.order,
                func.count(CrmDeal.id).label("count"),
                func.coalesce(func.sum(CrmDeal.amount_minor), 0).label("total_amount_minor"),
                func.coalesce(
                    cast(
                        func.round(CrmDeal.amount_minor * CrmDeal.probability / 100.0),
                        Integer,
                    ),
                    0,
                ).label("weighted_value_minor"),
            )
            .join(
                CrmDeal,
                (CrmDeal.stage_id == CrmDealStage.id)
                & (CrmDeal.deleted.is_(False))
                & (CrmDeal.status == DealStatus.OPEN),
            )
            .where(
                CrmDealStage.tenant_id == tenant_id,
                CrmDealStage.deleted.is_(False),
            )
            .group_by(CrmDealStage.id, CrmDealStage.name, CrmDealStage.order)
            .order_by(CrmDealStage.order.asc())
        )
        stages = [
            FunnelStageAggregate(
                stage_id=row.id,
                stage_name=row.name,
                order=row.order,
                count=int(row.count),
                total_amount_minor=int(row.total_amount_minor),
                weighted_value_minor=int(row.weighted_value_minor or 0),
            )
            for row in self._session.execute(stage_statement).all()
        ]

        # ── Cierres y totales ────────────────────────────────────────────────
        won_row = self._session.execute(
            select(
                func.count(CrmDeal.id).label("count"),
                func.coalesce(func.sum(CrmDeal.amount_minor), 0).label("amount"),
            ).where(
                CrmDeal.tenant_id == tenant_id,
                CrmDeal.deleted.is_(False),
                CrmDeal.status == DealStatus.WON,
            )
        ).one()
        won_count = int(won_row.count)
        won_amount_minor = int(won_row.amount)

        lost_count = (
            self._session.scalar(
                select(func.count(CrmDeal.id)).where(
                    CrmDeal.tenant_id == tenant_id,
                    CrmDeal.deleted.is_(False),
                    CrmDeal.status == DealStatus.LOST,
                )
            )
            or 0
        )

        total_deals = (
            self._session.scalar(
                select(func.count(CrmDeal.id)).where(
                    CrmDeal.tenant_id == tenant_id,
                    CrmDeal.deleted.is_(False),
                )
            )
            or 0
        )
        open_count = total_deals - won_count - lost_count

        # ── Tiempo de ciclo medio (días) sobre deals cerrados ────────────────
        closed_rows = self._session.execute(
            select(CrmDeal.created_at, CrmDeal.closed_at).where(
                CrmDeal.tenant_id == tenant_id,
                CrmDeal.deleted.is_(False),
                CrmDeal.closed_at.is_not(None),
            )
        ).all()
        avg_cycle_days: float | None = None
        cycle_days = [
            (row.closed_at - row.created_at).total_seconds() / 86400.0
            for row in closed_rows
            if row.created_at is not None and row.closed_at is not None
        ]
        if cycle_days:
            avg_cycle_days = round(sum(cycle_days) / len(cycle_days), 2)

        return FunnelAggregate(
            stages=stages,
            total_deals=total_deals,
            open_count=open_count,
            won_count=won_count,
            lost_count=lost_count,
            won_amount_minor=won_amount_minor,
            avg_cycle_days=avg_cycle_days,
        )
