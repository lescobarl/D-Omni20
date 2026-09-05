"""Servicio de generación IA de landings (DeepSeek) con caché y errores con contexto.

Contrato:
- :class:`DeepSeekGenerationService` implementa el puerto :class:`IAiService`.
  El cliente HTTP (``httpx``) es inyectable para tests o se crea internamente
  con timeouts desde ``Settings`` (regla CLAUDE: nunca timeout ``None``).
- La caché (:class:`LruAiResponseCache`) es *app-scoped* (compartida entre
  requests) y se compone a nivel de :class:`Container` para que realmente acierte.
- Fail-closed: sin API key → :class:`ConfigValidationError`; errores HTTP o de
  parseo → :class:`DependencyError` con contexto y causa (regla CLAUDE: errores
  con contexto, sin try/except vacío).
- La clave de caché incluye el tenant y un hash determinista de ``brand_voice``
  (aislamiento multi-tenant + variación de voz de marca sin colisión de caché).
"""

from __future__ import annotations

import hashlib
import json
import re
import threading
import time
import uuid
from collections import OrderedDict
from typing import Any

import httpx

from app.config.settings import Settings
from app.core.errors import ConfigValidationError, DependencyError
from app.core.logging import ILogger
from app.services.interfaces import (
    AiGenerationResult,
    IAiResponseCache,
    IAiService,
)

_SUPPORTED_WORKFLOWS = frozenset(
    {"direct_checkout", "lead_capture", "quote_generator", "appointment_scheduler"}
)

_BLOCK_TYPES = frozenset(
    {
        "hero",
        "services_grid",
        "calculator",
        "testimonials",
        "faq",
        "lead_form",
        "conversion_floating",
    }
)

_SYSTEM_PROMPT = (
    "Eres un generador de landing pages de alto rendimiento. "
    "Devuelve SOLO un objeto JSON válido (sin texto, sin markdown) con esta forma: "
    '{"title": "Título", "workflowType": "direct_checkout | lead_capture | '
    'quote_generator | appointment_scheduler", "blocks": [{"type": "<tipo>", '
    '"name": "Etiqueta", "config": { ... }}]}. '
    "Tipos de bloque permitidos: hero, services_grid, calculator, testimonials, "
    "faq, lead_form, conversion_floating. Rellena el config de cada bloque con los "
    "campos que correspondan (títulos, subtítulos, servicios, testimonios, preguntas "
    "frecuentes, campos de formulario, textos CTA...). No inventes tipos de bloque ni "
    "campos fuera de los permitidos."
)

# Whitelist de la extensión PSEO+GEO+Brand Voice (Fase A): únicos sub-dicts de
# configuración extendida que el LLM puede aportar; el resto se descarta.
_EXTENDED_CONFIG_KEYS = frozenset(
    {"brand_voice", "seo_programmatic", "geo_optimization", "metadata_template"}
)

# Tipos de bloque permitidos en las páginas del Portal del Cliente (C-3). El
# portal comparte el mismo motor de generación que la landing (UN configurador),
# pero con bloques orientados a autoservicio del cliente.
_PORTAL_BLOCK_TYPES = frozenset(
    {
        "hero",
        "services_grid",
        "testimonials",
        "faq",
        "contact_form",
        "appointment_scheduler",
        "payment_status",
        "quote_request",
        "privacy_policy",
        "about",
        "mission_vision",
    }
)

_PORTAL_SYSTEM_PROMPT = (
    "Eres un generador de páginas del Portal del Cliente de alto rendimiento. "
    "Devuelve SOLO un objeto JSON válido (sin texto, sin markdown) con esta forma: "
    '{"slug": "inicio", "title": "Título", "blocks": [{"type": "<tipo>", '
    '"name": "Etiqueta", "config": { ... }}]}. '
    "Tipos de bloque permitidos: hero, services_grid, testimonials, faq, "
    "contact_form, appointment_scheduler, payment_status, quote_request, "
    "privacy_policy, about, mission_vision. El slug debe ser en minúsculas con "
    "guiones (solo a-z, 0-9 y '-'). Rellena el config de cada bloque con los "
    "campos que correspondan (títulos, subtítulos, servicios, testimonios, "
    "preguntas frecuentes, textos CTA...). No inventes tipos de bloque ni campos "
    "fuera de los permitidos."
)


def _build_system_prompt(
    brand_voice: dict[str, Any] | None,
    *,
    base_prompt: str | None = None,
) -> str:
    """Parámetriza el prompt de sistema con la voz de marca (Fase A).

    Si no hay ``brand_voice`` (o no es un dict con ``tone``/``custom_instructions``)
    devuelve el prompt base sin cambios. Cada voz distinta produce una instrucción
    distinta y, gracias a ``_cache_key``, una clave de caché distinta.
    ``base_prompt`` permite reutilizar el mismo motor para el Portal del Cliente
    (UN configurador basado en IA generativa).
    """
    base = base_prompt or _SYSTEM_PROMPT
    if not isinstance(brand_voice, dict) or not brand_voice:
        return base
    instructions: list[str] = [base]
    tone = brand_voice.get("tone")
    if isinstance(tone, str) and tone.strip():
        instructions.append(
            "Tono de marca obligatorio: "
            f"{tone.strip()}. "
            "Adapta todos los textos (titulares, CTA, descripciones) a ese tono."
        )
    custom = brand_voice.get("custom_instructions")
    if isinstance(custom, str) and custom.strip():
        instructions.append(
            f"Instrucciones de marca adicionales: {custom.strip()}."
        )
    return " ".join(instructions)


class LruAiResponseCache(IAiResponseCache):
    """Caché LRU thread-safe con expiración por TTL (``time.monotonic``).

    La clave es un string y el valor se guarda junto a su instante de expiración.
    Al leer, los ítems caducados se descartan; al insertar, si la caché alcanza
    ``max_entries`` se expulsa la entrada menos recientemente usada (LRU).
    """

    def __init__(self, *, max_entries: int = 512) -> None:
        if max_entries < 1:
            raise ValueError("max_entries debe ser >= 1")
        self._max_entries = max_entries
        self._store: OrderedDict[str, tuple[float, Any]] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: str) -> Any | None:
        """Devuelve el valor en caché o ``None`` si no existe / caducó."""
        with self._lock:
            item = self._store.get(key)
            if item is None:
                return None
            expires_at, value = item
            if expires_at <= time.monotonic():
                del self._store[key]
                return None
            self._store.move_to_end(key)
            return value

    def set(self, key: str, value: Any, *, ttl_seconds: float | None = None) -> None:
        """Guarda un valor con TTL opcional (``None`` = sin expiración)."""
        with self._lock:
            if key in self._store:
                del self._store[key]
            if ttl_seconds is None:
                expires_at = float("inf")
            else:
                expires_at = time.monotonic() + ttl_seconds
            self._store[key] = (expires_at, value)
            while len(self._store) > self._max_entries:
                self._store.popitem(last=False)


class DeepSeekGenerationService(IAiService):
    """Generador de landings vía la API de DeepSeek (compatible OpenAI).

    - Si se inyecta ``client`` (tests), la instancia NO lo cierra (no lo posee);
      si no, crea ``httpx.Client(timeout=httpx.Timeout(...))`` y lo cierra en
      ``close()`` (regla CLAUDE: timeout explícito, nunca ``None``).
    - ``_cache_key``: sha256 de ``tenant_id|workflow_type|brand_voice_hash|prompt``
      (tenant-aware y sensible a la voz de marca).
    - El payload cacheado es el dict normalizado + metadatos para reconstruir
      :class:`AiGenerationResult` sin repetir el costo del LLM.
    """

    def __init__(
        self,
        *,
        settings: Settings,
        cache: IAiResponseCache,
        logger: ILogger,
        client: httpx.Client | None = None,
    ) -> None:
        self._settings = settings
        self._cache = cache
        self._logger = logger
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

    def generate_landing(
        self,
        *,
        tenant_id: uuid.UUID,
        prompt: str,
        workflow_type: str | None = None,
        brand_voice: dict[str, Any] | None = None,
    ) -> AiGenerationResult:
        """Genera la configuración de una landing a partir de un prompt."""
        api_key = self._settings.deepseek_api_key
        if not api_key or not api_key.strip():
            raise ConfigValidationError(
                "No se configuró DEEPSEEK_API_KEY",
                operation="ai.generate",
                context={"reason": "api_key_missing"},
            )

        cache_key = _cache_key(
            tenant_id=tenant_id,
            prompt=prompt,
            workflow_type=workflow_type,
            brand_voice=brand_voice,
        )
        cached = self._cache.get(cache_key)
        if cached is not None:
            self._logger.info(
                "ai.cache_hit",
                message="Respuesta IA servida desde caché",
                tenant_id=str(tenant_id),
                workflow_type=workflow_type or "none",
            )
            return AiGenerationResult(
                config=cached["config"],
                model=cached["model"],
                cached=True,
                prompt_tokens=cached.get("prompt_tokens", 0),
                completion_tokens=cached.get("completion_tokens", 0),
            )

        content, prompt_tokens, completion_tokens = self._call_deepseek(
            api_key=api_key,
            prompt=prompt,
            workflow_type=workflow_type,
            brand_voice=brand_voice,
        )
        try:
            parsed = _extract_json(content)
        except ValueError as exc:
            raise DependencyError(
                "La IA devolvió contenido no parseable como JSON",
                operation="ai.generate",
                context={"stage": "json"},
                cause=exc,
            ) from exc
        config = _validate_config(parsed)

        model = self._settings.deepseek_model
        self._cache.set(
            cache_key,
            {
                "config": config,
                "model": model,
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
            },
            ttl_seconds=self._settings.deepseek_cache_ttl_seconds,
        )
        self._logger.info(
            "ai.generated",
            message="Landing generada con IA",
            tenant_id=str(tenant_id),
            workflow_type=workflow_type or "none",
            model=model,
        )
        return AiGenerationResult(
            config=config,
            model=model,
            cached=False,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
        )

    def generate_portal(
        self,
        *,
        tenant_id: uuid.UUID,
        prompt: str,
        brand_voice: dict[str, Any] | None = None,
    ) -> AiGenerationResult:
        """Genera la configuración de una página del Portal del Cliente a partir de un prompt.

        Reutiliza el mismo motor de generación que la landing (UN configurador
        basado en IA generativa), pero produce ``{slug, title, blocks[]}`` en
        lugar de ``{title, workflowType, blocks[]}``.
        """
        api_key = self._settings.deepseek_api_key
        if not api_key or not api_key.strip():
            raise ConfigValidationError(
                "No se configuró DEEPSEEK_API_KEY",
                operation="ai.generate_portal",
                context={"reason": "api_key_missing"},
            )

        cache_key = _cache_key(
            tenant_id=tenant_id,
            prompt=prompt,
            workflow_type="portal",
            brand_voice=brand_voice,
        )
        cached = self._cache.get(cache_key)
        if cached is not None:
            self._logger.info(
                "ai.portal_cache_hit",
                message="Página de portal servida desde caché",
                tenant_id=str(tenant_id),
            )
            return AiGenerationResult(
                config=cached["config"],
                model=cached["model"],
                cached=True,
                prompt_tokens=cached.get("prompt_tokens", 0),
                completion_tokens=cached.get("completion_tokens", 0),
            )

        content, prompt_tokens, completion_tokens = self._call_deepseek(
            api_key=api_key,
            prompt=prompt,
            workflow_type=None,
            brand_voice=brand_voice,
            system_prompt=_PORTAL_SYSTEM_PROMPT,
        )
        try:
            parsed = _extract_json(content)
        except ValueError as exc:
            raise DependencyError(
                "La IA devolvió contenido no parseable como JSON",
                operation="ai.generate_portal",
                context={"stage": "json"},
                cause=exc,
            ) from exc
        config = _validate_portal_config(parsed)

        model = self._settings.deepseek_model
        self._cache.set(
            cache_key,
            {
                "config": config,
                "model": model,
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
            },
            ttl_seconds=self._settings.deepseek_cache_ttl_seconds,
        )
        self._logger.info(
            "ai.portal_generated",
            message="Página de portal generada con IA",
            tenant_id=str(tenant_id),
            model=model,
        )
        return AiGenerationResult(
            config=config,
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
        workflow_type: str | None,
        brand_voice: dict[str, Any] | None = None,
        system_prompt: str | None = None,
    ) -> tuple[str, int, int]:
        """Invoca ``/chat/completions`` y devuelve (contenido, tokens prompt, tokens completados)."""
        workflow_instruction = ""
        if workflow_type:
            workflow_instruction = (
                f"\nEl workflow objetivo es '{workflow_type}'; adapta los bloques "
                "y el texto CTA a ese flujo de conversión."
            )
        base_prompt = system_prompt or _SYSTEM_PROMPT
        payload = {
            "model": self._settings.deepseek_model,
            "messages": [
                {
                    "role": "system",
                    "content": _build_system_prompt(brand_voice, base_prompt=base_prompt),
                },
                {"role": "user", "content": prompt + workflow_instruction},
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
                operation="ai.generate",
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
                operation="ai.generate",
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
                operation="ai.generate",
                context={"stage": "shape", "status_code": response.status_code},
                cause=exc,
            ) from exc
        return content, prompt_tokens, completion_tokens


def _cache_key(
    *,
    tenant_id: uuid.UUID,
    prompt: str,
    workflow_type: str | None,
    brand_voice: dict[str, Any] | None = None,
) -> str:
    """Clave sha256 de la caché (tenant-aware y sensible a ``brand_voice``).

    ``brand_voice`` se serializa de forma determinista (claves ordenadas, sin
    espacios) para que dos dicts equivalentes compartan clave y dos voces
    distintas nunca colisionen (regla: variación de marca NO reutiliza caché).
    """
    brand_voice_hash = ""
    if isinstance(brand_voice, dict) and brand_voice:
        serialized = json.dumps(
            brand_voice,
            sort_keys=True,
            ensure_ascii=True,
            separators=(",", ":"),
        )
        brand_voice_hash = hashlib.sha256(serialized.encode("utf-8")).hexdigest()
    raw = (
        f"{tenant_id}|{workflow_type or ''}|{brand_voice_hash}|{prompt}"
    ).strip().lower()
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _extract_json(content: str) -> Any:
    """Extrae el primer objeto JSON del texto tolerando cercas markdown (```)."""
    text = content.strip()
    fenced = re.search(
        r"```(?:json)?\s*(.*?)```", text, flags=re.DOTALL | re.IGNORECASE
    )
    if fenced:
        text = fenced.group(1).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("no JSON object found")
    return json.loads(text[start : end + 1])


def _validate_config(raw: Any) -> dict[str, Any]:
    """Normaliza la salida del LLM a un dict de configuración seguro.

    Descarta bloques con tipos no soportados y garantiza siempre un ``config``
    dict por bloque (nunca campos inesperados ni estructuras rotas).
    """
    if not isinstance(raw, dict):
        raise DependencyError(
            "La IA no devolvió un objeto JSON",
            operation="ai.generate",
            context={"reason": "not_object"},
        )

    title = str(raw.get("title") or "Landing generada").strip() or "Landing generada"

    workflow_type = raw.get("workflowType") or "direct_checkout"
    if workflow_type not in _SUPPORTED_WORKFLOWS:
        workflow_type = "direct_checkout"

    blocks: list[dict[str, Any]] = []
    raw_blocks = raw.get("blocks") or []
    if isinstance(raw_blocks, list):
        for block in raw_blocks:
            if not isinstance(block, dict):
                continue
            block_type = block.get("type")
            if not isinstance(block_type, str) or block_type not in _BLOCK_TYPES:
                continue
            block_config = block.get("config")
            if not isinstance(block_config, dict):
                block_config = {}
            blocks.append(
                {
                    "type": block_type,
                    "name": str(block.get("name") or block_type),
                    "config": block_config,
                }
            )

    config: dict[str, Any] = {
        "title": title,
        "workflowType": workflow_type,
        "blocks": blocks,
    }
    # Whitelist de la extensión PSEO+GEO+Brand Voice (Fase A): solo se propagan
    # los sub-dicts permitidos; cualquier campo inventado por el LLM se descarta.
    for key in _EXTENDED_CONFIG_KEYS:
        value = raw.get(key)
        if isinstance(value, dict):
            config[key] = value
    return config


def _validate_portal_config(raw: Any) -> dict[str, Any]:
    """Normaliza la salida del LLM a un dict de configuración de página de portal.

    Descarta bloques con tipos no soportados y garantiza siempre un ``config``
    dict por bloque (nunca campos inesperados ni estructuras rotas). El slug se
    normaliza a minúsculas con guiones (solo a-z, 0-9 y '-').
    """
    if not isinstance(raw, dict):
        raise DependencyError(
            "La IA no devolvió un objeto JSON",
            operation="ai.generate_portal",
            context={"reason": "not_object"},
        )

    title = str(raw.get("title") or "Página del portal").strip() or "Página del portal"

    raw_slug = str(raw.get("slug") or "inicio").strip().lower()
    slug = re.sub(r"[^a-z0-9-]+", "-", raw_slug).strip("-") or "inicio"

    blocks: list[dict[str, Any]] = []
    raw_blocks = raw.get("blocks") or []
    if isinstance(raw_blocks, list):
        for block in raw_blocks:
            if not isinstance(block, dict):
                continue
            block_type = block.get("type")
            if not isinstance(block_type, str) or block_type not in _PORTAL_BLOCK_TYPES:
                continue
            block_config = block.get("config")
            if not isinstance(block_config, dict):
                block_config = {}
            blocks.append(
                {
                    "type": block_type,
                    "name": str(block.get("name") or block_type),
                    "config": block_config,
                }
            )

    config: dict[str, Any] = {
        "slug": slug,
        "title": title,
        "blocks": blocks,
    }
    # Whitelist de la extensión PSEO+GEO+Brand Voice: solo se propagan los
    # sub-dicts permitidos; cualquier campo inventado por el LLM se descarta.
    for key in _EXTENDED_CONFIG_KEYS:
        value = raw.get(key)
        if isinstance(value, dict):
            config[key] = value
    return config
