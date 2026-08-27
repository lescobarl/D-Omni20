"""Servicio de generación IA de JSON Schemas (DeepSeek) con caché y validación.

Contrato:
- :class:`SchemaGenerationService` implementa el puerto :class:`ISchemaGenerationService`.
  El cliente HTTP (``httpx``) es inyectable para tests o se crea internamente con
  timeouts desde ``Settings`` (regla CLAUDE: nunca timeout ``None``).
- La caché (:class:`LruAiResponseCache`) es *app-scoped* y se compone a nivel de
  :class:`Container` para que realmente acierte (mismo patrón que landings).
- Fail-closed: sin API key → :class:`ConfigValidationError`; errores HTTP o de
  parseo → :class:`DependencyError` con contexto y causa.
- La salida se valida como **JSON Schema Draft 2020-12** con ``jsonschema`` y se
  persiste vía :class:`ISchemaRepository` (acotado al tenant).
- La clave de caché incluye el tenant y el nombre (aislamiento multi-tenant).
"""

from __future__ import annotations

import hashlib
import uuid
from typing import Any

import httpx
from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError

from app.config.settings import Settings
from app.core.errors import ConfigValidationError, DependencyError
from app.core.logging import ILogger
from app.repositories.interfaces import ISchemaRepository
from app.services.ai_service import _extract_json
from app.services.interfaces import (
    IAiResponseCache,
    ISchemaGenerationService,
    SchemaGenerationResult,
)

_SCHEMA_SYSTEM_PROMPT = (
    "Eres un generador de JSON Schemas (Draft 2020-12) para formularios y layouts "
    "del editor visual. Devuelve SOLO un objeto JSON válido (sin texto, sin markdown) "
    "que sea un JSON Schema válido con esta forma: "
    '{"$schema": "https://json-schema.org/draft/2020-12/schema", "$id": "https://'
    'ejemplo.com/schema.json", "type": "object", "title": "Título", "description": '
    '"Descripción", "properties": {"campo": {"type": "string", "title": "Campo", '
    '"minLength": 1}}, "required": ["campo"], "additionalProperties": false}. '
    "Usa solo tipos y keywords estándar del Draft 2020-12 (string, number, integer, "
    "boolean, array, object; minLength, maxLength, minimum, maximum, enum, items, "
    "pattern, format). No inventes keywords fuera del estándar."
)


def _schema_cache_key(*, tenant_id: uuid.UUID, prompt: str, name: str | None) -> str:
    """Clave sha256 de la caché (tenant-aware, incluye el nombre opcional)."""
    raw = f"schema|{tenant_id}|{name or ''}|{prompt}".strip().lower()
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _normalize_schema(raw: Any) -> dict[str, Any]:
    """Valida que la salida sea un JSON Schema Draft 2020-12 y la normaliza."""
    if not isinstance(raw, dict):
        raise DependencyError(
            "La IA no devolvió un objeto JSON",
            operation="ai.generate_schema",
            context={"stage": "shape", "reason": "not_object"},
        )
    try:
        Draft202012Validator.check_schema(raw)
    except SchemaError as exc:
        raise DependencyError(
            "La IA devolvió un JSON Schema inválido (Draft 2020-12)",
            operation="ai.generate_schema",
            context={"stage": "schema_validation", "reason": str(exc)[:500]},
            cause=exc,
        ) from exc

    schema = dict(raw)
    schema.setdefault("$schema", "https://json-schema.org/draft/2020-12/schema")
    schema.setdefault("title", "Esquema generado")
    return schema


class SchemaGenerationService(ISchemaGenerationService):
    """Generador de JSON Schemas vía la API de DeepSeek (compatible OpenAI).

    - Si se inyecta ``client`` (tests), la instancia NO lo cierra (no lo posee);
      si no, crea ``httpx.Client(timeout=httpx.Timeout(...))`` y lo cierra en
      ``close()`` (regla CLAUDE: timeout explícito, nunca ``None``).
    - ``_schema_cache_key``: sha256 de ``tenant_id|name|prompt`` (tenant-aware).
    - El payload cacheado es el schema normalizado + metadatos para reconstruir
      :class:`SchemaGenerationResult` sin repetir el costo del LLM.
    """

    def __init__(
        self,
        *,
        settings: Settings,
        cache: IAiResponseCache,
        logger: ILogger,
        repository: ISchemaRepository,
        client: httpx.Client | None = None,
    ) -> None:
        self._settings = settings
        self._cache = cache
        self._logger = logger
        self._repository = repository
        self._client = client
        self._owns_client = client is None

    def _get_client(self) -> httpx.Client:
        """Devuelve el cliente HTTP (creándolo con timeout explícito si hace falta)."""
        if self._client is None:
            self._client = httpx.Client(
                timeout=httpx.Timeout(self._settings.deepseek_timeout_seconds)
            )
        return self._client

    def close(self) -> None:
        """Cierra el cliente HTTP solo si la instancia lo posee (regla DI)."""
        if self._owns_client and self._client is not None:
            self._client.close()
            self._client = None

    def generate_schema(
        self,
        *,
        tenant_id: uuid.UUID,
        prompt: str,
        name: str | None = None,
    ) -> SchemaGenerationResult:
        """Genera un JSON Schema (Draft 2020-12) a partir de un prompt y lo persiste."""
        api_key = self._settings.deepseek_api_key
        if not api_key or not api_key.strip():
            raise ConfigValidationError(
                "No se configuró DEEPSEEK_API_KEY",
                operation="ai.generate_schema",
                context={"reason": "api_key_missing"},
            )

        cache_key = _schema_cache_key(tenant_id=tenant_id, prompt=prompt, name=name)
        cached = self._cache.get(cache_key)
        if cached is not None:
            self._logger.info(
                "ai.schema_cache_hit",
                message="JSON Schema servido desde caché",
                tenant_id=str(tenant_id),
                name=name or "none",
            )
            return SchemaGenerationResult(
                schema=cached["schema"],
                model=cached["model"],
                cached=True,
                prompt_tokens=cached.get("prompt_tokens", 0),
                completion_tokens=cached.get("completion_tokens", 0),
            )

        content, prompt_tokens, completion_tokens = self._call_deepseek(
            api_key=api_key,
            prompt=prompt,
            name=name,
        )
        try:
            parsed = _extract_json(content)
        except ValueError as exc:
            raise DependencyError(
                "La IA devolvió contenido no parseable como JSON",
                operation="ai.generate_schema",
                context={"stage": "json"},
                cause=exc,
            ) from exc
        schema = _normalize_schema(parsed)

        schema_name = (name or "").strip() or str(schema.get("title") or "Esquema generado")
        self._repository.save(
            tenant_id=tenant_id,
            name=schema_name[:255],
            schema_json=schema,
        )

        model = self._settings.deepseek_model
        self._cache.set(
            cache_key,
            {
                "schema": schema,
                "model": model,
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
            },
            ttl_seconds=self._settings.deepseek_cache_ttl_seconds,
        )
        self._logger.info(
            "ai.schema_generated",
            message="JSON Schema generado con IA",
            tenant_id=str(tenant_id),
            name=schema_name,
            model=model,
        )
        return SchemaGenerationResult(
            schema=schema,
            model=model,
            cached=False,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
        )

    def _call_deepseek(
        self,
        *,
        api_key: str,
        prompt: str,
        name: str | None,
    ) -> tuple[str, int, int]:
        """Invoca ``/chat/completions`` y devuelve (contenido, tokens prompt, tokens completados)."""
        user_content = prompt
        if name:
            user_content = (
                f"Genera un JSON Schema para '{name}'.\n\n" + prompt
            )
        payload = {
            "model": self._settings.deepseek_model,
            "messages": [
                {"role": "system", "content": _SCHEMA_SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
            "temperature": self._settings.deepseek_temperature,
            "max_tokens": self._settings.deepseek_max_tokens,
        }
        url = f"{self._settings.deepseek_base_url.rstrip('/')}/chat/completions"
        try:
            response = self._get_client().post(
                url,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise DependencyError(
                f"Fallo al llamar a la API de DeepSeek: {exc}",
                operation="ai.generate_schema",
                context={
                    "stage": "http",
                    "model": self._settings.deepseek_model,
                    "status_code": getattr(getattr(exc, "response", None), "status_code", None),
                },
                cause=exc,
            ) from exc

        try:
            data = response.json()
        except ValueError as exc:
            raise DependencyError(
                "La API de DeepSeek devolvió una respuesta no JSON",
                operation="ai.generate_schema",
                context={"stage": "parse", "status_code": response.status_code},
                cause=exc,
            ) from exc

        try:
            content = data["choices"][0]["message"]["content"]
            usage = data.get("usage") or {}
            prompt_tokens = int(usage.get("prompt_tokens", 0))
            completion_tokens = int(usage.get("completion_tokens", 0))
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise DependencyError(
                "La API de DeepSeek devolvió una estructura inesperada",
                operation="ai.generate_schema",
                context={"stage": "shape", "status_code": response.status_code},
                cause=exc,
            ) from exc
        return content, prompt_tokens, completion_tokens
