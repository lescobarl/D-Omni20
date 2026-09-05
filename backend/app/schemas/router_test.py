"""Esquemas del motor de prueba del router del bot (Fase 4).

Contrato público de ``POST /bot/router/test`` (regla CLAUDE: schema público
validado). Permite escribir un mensaje crudo y ver qué rama del router decide
y por qué, sin contaminar datos (no persiste, no encola, no llama workflows ni
al proveedor de IA).

Notas de diseño:
- ``RouterTestRequest`` usa ``extra="forbid"`` para rechazar campos
  desconocidos (contrato estricto).
- ``RouterTraceRead``/``RouterStepRead`` son :class:`BaseModel` simples (no
  ``ORMModel``): la traza no es una entidad persistida, es un snapshot
  computado en memoria por :meth:`ConversationService.route_for_test`.
- ``confidence`` es la fracción de score de la intención ganadora sobre el
  total (0.0–1.0); en la rama ``keyword`` es siempre 1.0 y en
  ``general_chat`` 0.0.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

# Límites del dominio (contrato público validado).
_MAX_MESSAGE_LENGTH = 4000


class RouterTestRequest(BaseModel):
    """Payload para probar el router con un mensaje crudo."""

    model_config = ConfigDict(extra="forbid")

    message: str = Field(min_length=1, max_length=_MAX_MESSAGE_LENGTH)


class RouterStepRead(BaseModel):
    """Un paso evaluado por el motor de ruteo (traza de prueba)."""

    order: int
    branch: str
    outcome: str
    detail: str


class RouterTraceRead(BaseModel):
    """Resultado del motor de prueba: qué rama decide y por qué.

    Reproduce la jerarquía real del bot (keyword → intent → general_chat)
    reutilizando las mismas ramas, pero sin efectos colaterales.
    """

    matched_route: str
    branch: str
    keyword: str | None
    keyword_priority: int | None
    intent: str | None
    response: str | None
    confidence: float
    steps: list[RouterStepRead]
