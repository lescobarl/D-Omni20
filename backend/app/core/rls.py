"""Row Level Security (RLS) multi-tenant (regla CLAUDE: aislamiento por tenant).

Contrato:
- Genera SQL idempotente (a prueba de múltiples ejecuciones) para:
  ``ENABLE ROW LEVEL SECURITY``, ``FORCE RLS`` y la política de aislamiento
  basada en ``current_setting('app.current_tenant_id')::UUID``.
- La política se aplica en ``USING`` y ``WITH CHECK`` para que ni lectura ni
  escritura crucen límites de tenant.
- Solo se emite para PostgreSQL (dialect guardado en la migración Alembic);
  SQLite (dev/tests) delega el aislamiento al repositorio.
"""

from __future__ import annotations


class RLSManager:
    """Fábrica de sentencias SQL de RLS idempotentes."""

    def __init__(self, schema: str = "public") -> None:
        self.schema = schema

    def qualified_table(self, table: str) -> str:
        return f"{self.schema}.{table}"

    def enable_rls_sql(self, table: str) -> str:
        """Activa RLS en la tabla (no restringe a superusuarios)."""
        return f"ALTER TABLE {self.qualified_table(table)} ENABLE ROW LEVEL SECURITY;"

    def force_rls_sql(self, table: str) -> str:
        """Aplica RLS también al dueño de la tabla (defensa en profundidad)."""
        return f"ALTER TABLE {self.qualified_table(table)} FORCE ROW LEVEL SECURITY;"

    def revoke_table_privileges_sql(self, table: str) -> str:
        """Revoca privilegios directos de la tabla al rol de la app.

        El acceso solo ocurre vía la política RLS (nunca tablas a pelo).
        """
        return f"REVOKE ALL ON {self.qualified_table(table)} FROM PUBLIC;"

    def tenant_isolation_policy_sql(
        self,
        table: str,
        tenant_column: str = "tenant_id",
        policy_name: str = "tenant_isolation_policy",
    ) -> str:
        """Crea la política de aislamiento por tenant de forma idempotente.

        :param table: Nombre de la tabla.
        :param tenant_column: Columna que identifica al tenant (UUID).
        :param policy_name: Nombre canónico de la política.
        """
        table_ref = self.qualified_table(table)
        expression = f"{tenant_column} = current_setting('app.current_tenant_id')::UUID"
        return f"""
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policy p
        JOIN pg_class c ON c.oid = p.polrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = '{self.schema}'
          AND c.relname = '{table}'
          AND p.polname = '{policy_name}'
    ) THEN
        CREATE POLICY {policy_name} ON {table_ref}
            USING ({expression})
            WITH CHECK ({expression});
    END IF;
END $$;
"""
