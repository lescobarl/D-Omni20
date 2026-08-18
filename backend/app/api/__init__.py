"""Capa de API — router raíz que agrega la versión v1."""

from fastapi import APIRouter

from app.api.v1 import v1_router

api_router = APIRouter()
api_router.include_router(v1_router)

__all__ = ["api_router"]
