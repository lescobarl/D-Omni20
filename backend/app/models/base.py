"""Modelos base con reglas CLAUDE adaptadas.

Reglas implementadas:
- PK ``UUIDv4`` (no secuencial, no adivinable) — :class:`UUIDPrimaryKeyMixin`.
- Tupla sync ``[revision, updated_at, deleted]`` como estado fuente de verdad
  para sincronización — :class:`SyncTupleMixin`.
- ``revision`` se incrementa en cada UPDATE:
  - SQLite/dev/tests: evento Python ``before_update``.
  - PostgreSQL/prod: trigger en la migración (evita doble incremento).
- ``eager_defaults`` refresca los valores del trigger de PostgreSQL tras flush.
- ``deleted`` (soft-delete) indexado; las queries de repositorio lo filtran.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import Boolean, DateTime, Integer, JSON, Uuid, event
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


_last_utcnow: datetime | None = None


def utcnow() -> datetime:
    """Timestamp UTC timezone-aware (nunca naive), estrictamente monótono.

    En sistemas con reloj de baja resolución (p. ej. Windows, tick ~15.6 ms),
    ``datetime.now()`` puede devolver el mismo instante en llamadas consecutivas,
    rompiendo los ordenamientos "más reciente primero" por ``created_at`` (la
    base SQLite cae entonces al rowid, es decir, orden de inserción). Para
    preservar el orden de creación dentro del proceso, cuando el reloj no avanza
    se devuelve el último valor incrementado 1 µs.
    """
    global _last_utcnow
    now = datetime.now(timezone.utc)
    if _last_utcnow is not None and now <= _last_utcnow:
        now = _last_utcnow + timedelta(microseconds=1)
    _last_utcnow = now
    return now


# Tipo JSON portable: ``JSON`` en SQLite, ``JSONB`` en PostgreSQL.
JSONType = JSON().with_variant(JSONB(), "postgresql")


class Base(DeclarativeBase):
    """Base declarativa de todos los modelos ORM de la aplicación."""


class UUIDPrimaryKeyMixin:
    """PK UUIDv4 generada en Python."""

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )


class TimestampsMixin:
    """Marcas de tiempo de creación (append-only) en UTC."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
    )


class SyncTupleMixin:
    """Tupla sync ``[revision, updated_at, deleted]`` — estado fuente de verdad.

    La columna ``updated_at`` se auto-actualiza por SQLAlchemy (``onupdate``);
    ``revision`` la incrementa :func:`_bump_revision` (no-PostgreSQL) o el
    trigger de la migración (PostgreSQL).
    """

    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
        onupdate=utcnow,
    )
    deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)

    __mapper_args__ = {"eager_defaults": True}


@event.listens_for(SyncTupleMixin, "before_update", propagate=True)
def _bump_revision(mapper: object, connection: object, target: SyncTupleMixin) -> None:
    """Incrementa ``revision`` en cada UPDATE (solo dialectos no-PostgreSQL).

    En PostgreSQL el incremento lo hace el trigger de la migración; el guard
    por dialecto evita el doble incremento.
    """
    if getattr(connection, "dialect", None) is not None and connection.dialect.name != "postgresql":
        target.revision = (target.revision or 0) + 1


class TenantScopedMixin:
    """Columna ``tenant_id`` que habilita RLS y filtrado por repositorio."""

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        nullable=False,
        index=True,
    )
