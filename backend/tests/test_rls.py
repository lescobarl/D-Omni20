"""Pruebas del generador de SQL de Row Level Security (regla CLAUDE: RLS)."""

from __future__ import annotations

from app.core.rls import RLSManager


def test_qualified_table() -> None:
    assert RLSManager().qualified_table("tenant_landings") == "public.tenant_landings"


def test_enable_rls_sql() -> None:
    sql = RLSManager().enable_rls_sql("tenant_landings")
    assert "ALTER TABLE public.tenant_landings ENABLE ROW LEVEL SECURITY;" in sql


def test_force_rls_sql() -> None:
    sql = RLSManager().force_rls_sql("tenant_landings")
    assert "ALTER TABLE public.tenant_landings FORCE ROW LEVEL SECURITY;" in sql


def test_revoke_table_privileges_sql() -> None:
    sql = RLSManager().revoke_table_privileges_sql("tenant_landings")
    assert "REVOKE ALL ON public.tenant_landings FROM PUBLIC;" in sql


def test_tenant_isolation_policy_sql() -> None:
    sql = RLSManager().tenant_isolation_policy_sql("tenant_landings")
    assert "CREATE POLICY tenant_isolation_policy ON public.tenant_landings" in sql
    assert "USING (tenant_id = current_setting('app.current_tenant_id')::UUID)" in sql
    assert "WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::UUID)" in sql


def test_tenant_isolation_policy_idempotent() -> None:
    sql = RLSManager().tenant_isolation_policy_sql("tenants")
    assert "IF NOT EXISTS" in sql
    assert "pg_policy" in sql
    assert "tenant_isolation_policy" in sql


def test_custom_policy_name_and_schema() -> None:
    manager = RLSManager(schema="app")
    sql = manager.tenant_isolation_policy_sql("tenant_landings", policy_name="mi_politica")
    assert "CREATE POLICY mi_politica ON app.tenant_landings" in sql
    assert "n.nspname = 'app'" in sql
