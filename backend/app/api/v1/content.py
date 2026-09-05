"""Endpoints de contenido estructurado del bot (saludos, menús, FAQs, reglas).

CRUD acotado al tenant activo (``X-Tenant-Id`` vía ``get_current_tenant``) y
delegado en :class:`IContentItemRepository` (puerto por ``Depends``). Los
borrados son *soft-delete* (nunca borrado físico — regla CLAUDE: tupla sync).
"""

from __future__ import annotations

import csv
import io
import json
import uuid
from typing import Any, Literal
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup
from fastapi import (
    APIRouter,
    Depends,
    File,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import StreamingResponse
from pypdf import PdfReader

from app.api.deps import (
    get_content_item_repository,
    get_current_tenant,
    get_document_repository,
    get_synonym_repository,
    require_role,
)
from app.core.errors import InputValidationError, NotFoundError
from app.models.user import Role
from app.repositories.interfaces import (
    IContentItemRepository,
    IDocumentRepository,
    ISynonymRepository,
)
from app.schemas.common import Page, Pagination
from app.schemas.documents import (
    DocumentContentRead,
    DocumentRead,
    DocumentSearchRequest,
    DocumentSearchResult,
    IngestRequest,
    IngestResultRead,
)
from app.schemas.synonyms import (
    SynonymCreate,
    SynonymImportRequest,
    SynonymImportResultRead,
    SynonymRead,
    SynonymUpdate,
)
from app.schemas.tenant_config import ContentItemCreate, ContentItemRead, ContentItemUpdate

router = APIRouter(
    prefix="/content",
    tags=["content"],
    dependencies=[Depends(require_role(Role.ADMIN, Role.CONFIGURADOR))],
)

_MAX_FILE_BYTES = 10 * 1024 * 1024  # Límite de ingesta por archivo (10 MB).
_CHUNK_SIZE = 1200  # Palabras por chunk (RAG).
_CHUNK_OVERLAP = 100  # Palabras de solapamiento entre chunks.


def _detect_source_type(filename: str) -> str:
    """Deriva el ``source_type`` a partir de la extensión del archivo."""
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if extension == "pdf":
        return "pdf"
    if extension == "csv":
        return "csv"
    if extension in {"txt", "md", "text"}:
        return "txt"
    raise InputValidationError(
        "Formato no soportado: solo PDF, TXT o CSV",
        operation="documents.ingest_file",
        context={"filename": filename},
    )


def _decode_text(raw: bytes) -> str:
    """Decodifica texto plano probando codificaciones comunes."""
    for encoding in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _extract_pdf(raw: bytes) -> str:
    """Extrae el texto de un PDF página a página (pypdf)."""
    try:
        reader = PdfReader(io.BytesIO(raw))
    except Exception as exc:  # PDF corrupto o no parseable.
        raise InputValidationError(
            "No se pudo leer el archivo PDF",
            operation="documents.ingest_file",
        ) from exc
    pages: list[str] = []
    for page in reader.pages:
        try:
            pages.append(page.extract_text() or "")
        except Exception:  # Página ilegible: se omite sin abortar la ingesta.
            pages.append("")
    return "\n\n".join(pages)


def _extract_csv(raw: bytes) -> str:
    """Convierte un CSV a texto plano (columnas separadas por ``|``)."""
    rows = csv.reader(io.StringIO(_decode_text(raw)))
    lines: list[str] = []
    for row in rows:
        cells = [cell.strip() for cell in row]
        if any(cells):
            lines.append(" | ".join(cells))
    return "\n".join(lines)


def _chunk_content(
    content: str, size: int = _CHUNK_SIZE, overlap: int = _CHUNK_OVERLAP
) -> list[tuple[int, str]]:
    """Divide el contenido en chunks solapados ``(ordinal, texto)`` para RAG."""
    words = content.split()
    chunks: list[tuple[int, str]] = []
    start = 0
    ordinal = 0
    while start < len(words):
        chunks.append((ordinal, " ".join(words[start : start + size])))
        ordinal += 1
        start += size - overlap
    return chunks


def _display_title(filename: str | None) -> str:
    """Título legible a partir del nombre del archivo (sin extensión)."""
    if not filename:
        return "documento"
    return (filename.rsplit(".", 1)[0].strip() or "documento")[:255]


def _title_from_url(url: str) -> str:
    """Título por defecto derivado de la última parte de la URL."""
    parsed = urlparse(url)
    last = parsed.path.rstrip("/").rsplit("/", 1)[-1]
    return (last or parsed.netloc or "documento")[:255]


async def _extract_file(file: UploadFile) -> tuple[str, str]:
    """Lee y normaliza un archivo subido a ``(source_type, contenido)``."""
    raw = await file.read()
    if len(raw) > _MAX_FILE_BYTES:
        raise InputValidationError(
            "El archivo supera el límite de 10 MB",
            operation="documents.ingest_file",
            context={"filename": file.filename},
        )
    filename = file.filename or "documento"
    source_type = _detect_source_type(filename)
    if source_type == "pdf":
        content = _extract_pdf(raw)
    elif source_type == "csv":
        content = _extract_csv(raw)
    else:
        content = _decode_text(raw)
    if not content.strip():
        raise InputValidationError(
            "El archivo no contiene texto extraíble",
            operation="documents.ingest_file",
            context={"filename": file.filename},
        )
    return source_type, content


async def _fetch_url(url: str) -> str:
    """Descarga una URL y extrae su texto visible (BeautifulSoup)."""
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=15.0) as client:
            response = await client.get(url)
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise InputValidationError(
            f"No se pudo acceder a la URL: {exc}",
            operation="documents.ingest_url",
            context={"url": url},
        ) from exc
    soup = BeautifulSoup(response.text, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg", "nav", "footer", "header"]):
        tag.decompose()
    text = " ".join(soup.get_text(separator=" ").split())
    if not text:
        raise InputValidationError(
            "La URL no contiene texto extraíble",
            operation="documents.ingest_url",
            context={"url": url},
        )
    return text


@router.get("", response_model=Page[ContentItemRead])
def list_content_items(
    pagination: Pagination = Depends(),
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IContentItemRepository = Depends(get_content_item_repository),
) -> Page[ContentItemRead]:
    """Lista el contenido estructurado del tenant activo (paginado)."""
    items, total = repository.list(
        tenant_id=tenant_id, page=pagination.page, page_size=pagination.page_size
    )
    return Page(
        items=[ContentItemRead.model_validate(item) for item in items],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.post("", response_model=ContentItemRead, status_code=status.HTTP_201_CREATED)
def create_content_item(
    data: ContentItemCreate,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IContentItemRepository = Depends(get_content_item_repository),
) -> ContentItemRead:
    """Crea un ítem de contenido (faq | document | rule | product)."""
    row = repository.create(
        tenant_id=tenant_id,
        kind=data.kind,
        title=data.title,
        content=data.content,
        tags=data.tags,
    )
    return ContentItemRead.model_validate(row)


# ---------------------------------------------------------------------------
# Base de conocimiento (gap ①): documentos ingeridos PDF/TXT/CSV/URL (RAG).
# ---------------------------------------------------------------------------


@router.post(
    "/documents/ingest-file",
    response_model=IngestResultRead,
    status_code=status.HTTP_201_CREATED,
)
async def ingest_document_file(
    file: UploadFile = File(...),
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IDocumentRepository = Depends(get_document_repository),
) -> IngestResultRead:
    """Ingiere un archivo PDF/TXT/CSV como documento de conocimiento (RAG)."""
    source_type, content = await _extract_file(file)
    chunks = _chunk_content(content)
    size_bytes = len(content.encode("utf-8"))
    row = repository.create(
        tenant_id=tenant_id,
        title=_display_title(file.filename),
        source_type=source_type,
        source_ref=file.filename,
        content=content,
        size_bytes=size_bytes,
        metadata={"filename": file.filename, "content_type": file.content_type},
        chunks=chunks,
    )
    return IngestResultRead(
        document=DocumentContentRead.model_validate(row),
        chunks_created=len(chunks),
    )


@router.post(
    "/documents/ingest-url",
    response_model=IngestResultRead,
    status_code=status.HTTP_201_CREATED,
)
async def ingest_document_url(
    data: IngestRequest,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IDocumentRepository = Depends(get_document_repository),
) -> IngestResultRead:
    """Ingiere el texto visible de una URL como documento de conocimiento."""
    content = await _fetch_url(data.url)
    chunks = _chunk_content(content)
    size_bytes = len(content.encode("utf-8"))
    row = repository.create(
        tenant_id=tenant_id,
        title=data.title or _title_from_url(data.url),
        source_type="url",
        source_ref=data.url,
        content=content,
        size_bytes=size_bytes,
        metadata={"url": data.url},
        chunks=chunks,
    )
    return IngestResultRead(
        document=DocumentContentRead.model_validate(row),
        chunks_created=len(chunks),
    )


@router.get("/documents", response_model=Page[DocumentRead])
def list_documents(
    pagination: Pagination = Depends(),
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IDocumentRepository = Depends(get_document_repository),
) -> Page[DocumentRead]:
    """Lista los documentos ingeridos del tenant activo (paginado)."""
    items, total = repository.list(
        tenant_id=tenant_id, page=pagination.page, page_size=pagination.page_size
    )
    return Page(
        items=[DocumentRead.model_validate(item) for item in items],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.post("/documents/search", response_model=list[DocumentSearchResult])
def search_documents(
    data: DocumentSearchRequest,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IDocumentRepository = Depends(get_document_repository),
) -> list[DocumentSearchResult]:
    """Busca por texto en documentos/chunks del tenant activo."""
    results = repository.search(tenant_id=tenant_id, query=data.query, limit=data.limit)
    return [
        DocumentSearchResult(
            document_id=document.id,
            title=document.title,
            snippet=snippet,
            score=score,
        )
        for document, snippet, score in results
    ]


@router.get("/documents/{document_id}", response_model=DocumentContentRead)
def get_document(
    document_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IDocumentRepository = Depends(get_document_repository),
) -> DocumentContentRead:
    """Devuelve un documento ingerido (incluye el contenido completo)."""
    row = repository.get(tenant_id=tenant_id, document_id=document_id)
    if row is None:
        raise NotFoundError(
            "Documento no encontrado para el tenant activo",
            operation="documents.get",
            context={"tenant_id": str(tenant_id), "document_id": str(document_id)},
        )
    return DocumentContentRead.model_validate(row)


@router.delete("/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(
    document_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IDocumentRepository = Depends(get_document_repository),
) -> Response:
    """Soft-delete de un documento ingerido (nunca borrado físico)."""
    deleted = repository.soft_delete(tenant_id=tenant_id, document_id=document_id)
    if not deleted:
        raise NotFoundError(
            "Documento no encontrado para el tenant activo",
            operation="documents.delete",
            context={"tenant_id": str(tenant_id), "document_id": str(document_id)},
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/synonyms", response_model=Page[SynonymRead])
def list_synonyms(
    pagination: Pagination = Depends(),
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: ISynonymRepository = Depends(get_synonym_repository),
) -> Page[SynonymRead]:
    """Lista los sinónimos del tenant activo (paginado, agrupado por término)."""
    items, total = repository.list(
        tenant_id=tenant_id, page=pagination.page, page_size=pagination.page_size
    )
    return Page(
        items=[SynonymRead.model_validate(item) for item in items],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.post("/synonyms", response_model=SynonymRead, status_code=status.HTTP_201_CREATED)
def create_synonym(
    data: SynonymCreate,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: ISynonymRepository = Depends(get_synonym_repository),
) -> SynonymRead:
    """Crea un término canónico con sus sinónimos (único por tenant)."""
    term = data.term.strip()
    if repository.get_by_term(tenant_id=tenant_id, term=term) is not None:
        raise InputValidationError(
            "Ya existe un sinónimo para ese término",
            operation="synonyms.create",
            context={"tenant_id": str(tenant_id), "term": term},
        )
    row = repository.create(
        tenant_id=tenant_id,
        term=term,
        synonyms=[s.strip() for s in data.synonyms if s.strip()],
    )
    return SynonymRead.model_validate(row)


@router.put("/synonyms/{synonym_id}", response_model=SynonymRead)
def update_synonym(
    synonym_id: uuid.UUID,
    data: SynonymUpdate,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: ISynonymRepository = Depends(get_synonym_repository),
) -> SynonymRead:
    """Actualiza un sinónimo (solo los campos enviados)."""
    existing = repository.get(tenant_id=tenant_id, synonym_id=synonym_id)
    if existing is None:
        raise NotFoundError(
            "Sinónimo no encontrado para el tenant activo",
            operation="synonyms.update",
            context={"tenant_id": str(tenant_id), "synonym_id": str(synonym_id)},
        )
    fields: dict[str, Any] = {}
    if data.term is not None:
        term = data.term.strip()
        conflict = repository.get_by_term(tenant_id=tenant_id, term=term)
        if conflict is not None and conflict.id != synonym_id:
            raise InputValidationError(
                "Ya existe un sinónimo para ese término",
                operation="synonyms.update",
                context={"tenant_id": str(tenant_id), "term": term},
            )
        fields["term"] = term
    if data.synonyms is not None:
        fields["synonyms"] = [s.strip() for s in data.synonyms if s.strip()]
    row = repository.update(tenant_id=tenant_id, synonym_id=synonym_id, fields=fields)
    assert row is not None  # La existencia ya se verificó arriba.
    return SynonymRead.model_validate(row)


@router.delete("/synonyms/{synonym_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_synonym(
    synonym_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: ISynonymRepository = Depends(get_synonym_repository),
) -> Response:
    """Soft-delete de un sinónimo (nunca borrado físico)."""
    deleted = repository.soft_delete(tenant_id=tenant_id, synonym_id=synonym_id)
    if not deleted:
        raise NotFoundError(
            "Sinónimo no encontrado para el tenant activo",
            operation="synonyms.delete",
            context={"tenant_id": str(tenant_id), "synonym_id": str(synonym_id)},
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _parse_synonym_csv_import(content: str, delimiter: str) -> list[tuple[str, list[str]]]:
    """Lee un CSV de sinónimos con cabecera ``term,synonyms`` (``|`` separa variantes)."""
    reader = csv.DictReader(io.StringIO(content), delimiter=delimiter)
    if reader.fieldnames is None or "term" not in reader.fieldnames or "synonyms" not in reader.fieldnames:
        raise ValueError('El CSV debe incluir las columnas "term" y "synonyms"')
    rows: list[tuple[str, list[str]]] = []
    for raw in reader:
        term = (raw.get("term") or "").strip()
        synonyms_raw = (raw.get("synonyms") or "").strip()
        synonyms = [part.strip() for part in synonyms_raw.split("|") if part.strip()]
        if term:
            rows.append((term, synonyms))
    return rows


def _parse_synonym_json_import(content: str) -> list[tuple[str, list[str]]]:
    """Lee un JSON de sinónimos: lista de objetos ``{term, synonyms}``."""
    payload = json.loads(content)
    if not isinstance(payload, list):
        raise ValueError("El JSON debe ser una lista de objetos con 'term' y 'synonyms'")
    rows: list[tuple[str, list[str]]] = []
    for raw in payload:
        if not isinstance(raw, dict):
            raise ValueError("Cada elemento del JSON debe ser un objeto con 'term' y 'synonyms'")
        term = str(raw.get("term") or "").strip()
        synonyms_raw = raw.get("synonyms") or []
        if not isinstance(synonyms_raw, list):
            raise ValueError("El campo 'synonyms' debe ser una lista de cadenas")
        synonyms = [str(part).strip() for part in synonyms_raw if str(part).strip()]
        if term:
            rows.append((term, synonyms))
    return rows


_MAX_SYNONYM_IMPORT_ERRORS = 50


def _append_synonym_import_error(result: SynonymImportResultRead, message: str) -> None:
    """Acumula un error de importación acotando la lista (evita respuestas enormes)."""
    if len(result.errors) < _MAX_SYNONYM_IMPORT_ERRORS:
        result.errors.append(message)
    result.failed += 1


@router.post("/synonyms/import", response_model=SynonymImportResultRead)
def import_synonyms(
    data: SynonymImportRequest,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: ISynonymRepository = Depends(get_synonym_repository),
) -> SynonymImportResultRead:
    """Importa sinónimos en lote (CSV o JSON, texto crudo en el cuerpo)."""
    result = SynonymImportResultRead()
    try:
        rows = (
            _parse_synonym_csv_import(data.content, data.delimiter)
            if data.format == "csv"
            else _parse_synonym_json_import(data.content)
        )
    except ValueError as exc:
        raise InputValidationError(
            str(exc),
            operation="synonyms.import",
            context={"tenant_id": str(tenant_id), "format": data.format},
        ) from exc
    for term, synonyms in rows:
        if repository.get_by_term(tenant_id=tenant_id, term=term) is not None:
            result.skipped += 1
            continue
        repository.create(tenant_id=tenant_id, term=term, synonyms=synonyms)
        result.imported += 1
    return result


@router.get("/synonyms/export")
def export_synonyms(
    file_format: Literal["csv", "json"] = "csv",
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: ISynonymRepository = Depends(get_synonym_repository),
) -> StreamingResponse:
    """Descarga los sinónimos del tenant activo como CSV o JSON."""
    rows = repository.list_all(tenant_id=tenant_id)
    if file_format == "json":
        body = json.dumps(
            [{"term": row.term, "synonyms": row.synonyms} for row in rows],
            ensure_ascii=False,
            indent=2,
        )
        media_type = "application/json"
        filename = "synonyms.json"
    else:
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(["term", "synonyms"])
        for row in rows:
            writer.writerow([row.term, "|".join(row.synonyms)])
        body = buffer.getvalue()
        media_type = "text/csv"
        filename = "synonyms.csv"
    return StreamingResponse(
        iter([body]),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{item_id}", response_model=ContentItemRead)
def get_content_item(
    item_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IContentItemRepository = Depends(get_content_item_repository),
) -> ContentItemRead:
    """Devuelve un ítem de contenido del tenant activo (404 si no existe)."""
    row = repository.get(tenant_id=tenant_id, item_id=item_id)
    if row is None:
        raise NotFoundError(
            "Contenido no encontrado para el tenant activo",
            operation="content.get",
            context={"tenant_id": str(tenant_id), "item_id": str(item_id)},
        )
    return ContentItemRead.model_validate(row)


@router.put("/{item_id}", response_model=ContentItemRead)
def update_content_item(
    item_id: uuid.UUID,
    data: ContentItemUpdate,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IContentItemRepository = Depends(get_content_item_repository),
) -> ContentItemRead:
    """Actualiza un ítem de contenido (solo los campos enviados)."""
    fields = data.model_dump(exclude_unset=True)
    if not fields:
        raise InputValidationError(
            "No se recibieron campos para actualizar",
            operation="content.update",
            context={"tenant_id": str(tenant_id), "item_id": str(item_id)},
        )
    row = repository.update(tenant_id=tenant_id, item_id=item_id, fields=fields)
    if row is None:
        raise NotFoundError(
            "Contenido no encontrado para el tenant activo",
            operation="content.update",
            context={"tenant_id": str(tenant_id), "item_id": str(item_id)},
        )
    return ContentItemRead.model_validate(row)


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_content_item(
    item_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IContentItemRepository = Depends(get_content_item_repository),
) -> Response:
    """Soft-delete de un ítem de contenido (nunca borrado físico)."""
    deleted = repository.soft_delete(tenant_id=tenant_id, item_id=item_id)
    if not deleted:
        raise NotFoundError(
            "Contenido no encontrado para el tenant activo",
            operation="content.delete",
            context={"tenant_id": str(tenant_id), "item_id": str(item_id)},
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
