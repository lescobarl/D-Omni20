"""Esquemas comunes: paginación y campos sync (regla CLAUDE tupla sync)."""

from __future__ import annotations

from datetime import datetime
from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")


class ORMModel(BaseModel):
    """Base para esquemas de lectura construidos desde objetos ORM."""

    model_config = ConfigDict(from_attributes=True)


class SyncFields(BaseModel):
    """Tupla sync ``[revision, updated_at, deleted]`` expuesta al cliente."""

    revision: int
    updated_at: datetime
    deleted: bool


class Pagination(BaseModel):
    """Parámetros de paginación validados (1-based)."""

    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=100)


class Page(BaseModel, Generic[T]):
    """Envoltorio de página: items + total + metadatos de paginación."""

    items: list[T]
    total: int
    page: int
    page_size: int
