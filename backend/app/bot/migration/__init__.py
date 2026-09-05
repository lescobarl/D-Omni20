"""Migración de datos de OmniBot_IA hacia D-Omni2.0 (Fase M).

Paquete autocontenido para importar de forma idempotente un export versionado
(JSON, ``schema_version`` 1.0) hacia las tablas de contenido, catálogo, canales,
proveedores de IA, conversaciones y mensajes del bot; y validar la paridad de
los datos importados.

Uso desde CLI:

    python -m app.bot.migration --export-file export.json --tenant-slug acme
"""

from app.bot.migration.schema import SCHEMA_VERSION, OmniBotExport

__all__ = ["SCHEMA_VERSION", "OmniBotExport"]
