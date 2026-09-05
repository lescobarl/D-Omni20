"""Pruebas del generador de SQL de Row Level Security (regla CLAUDE: RLS)."""

from __future__ import annotations

import pytest

from app.core.rls import RLSManager
from app.models.base import Base


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


# Tablas de configuración del tenant creadas en la migración ``b2c3d4e5f6a7``.
# Se validan vía ``Base.metadata`` (no importando el módulo de migración, que
# no es un paquete Python) y contra el generador de RLS para las 4 tablas.
TENANT_CONFIG_TABLES = (
    "tenant_appearance",
    "content_items",
    "catalog_items",
    "tenant_channels",
)

# Tablas núcleo con alcance por tenant y RLS, creadas en la migración base
# ``0a1b2c3d4e5f``. ``tenants`` y ``audit_logs`` se excluyen a propósito:
# la primera es bootstrap (sin RLS) y la segunda tiene ``tenant_id`` nulo sin FK.
CORE_TABLES = (
    "tenant_oauth_tokens",
    "developer_schemas",
    "schema_versions",
    "marketplace_templates",
    "analytics_events",
    "tenant_landings",
    "cdn_deployments",
    "workflow_payments",
    "workflow_leads",
    "workflow_quotes",
    "workflow_appointments",
    "workflow_appointment_reminders",
)


def _assert_rls_sql(manager: RLSManager, table: str) -> None:
    assert f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY;" in manager.enable_rls_sql(table)
    assert f"ALTER TABLE public.{table} FORCE ROW LEVEL SECURITY;" in manager.force_rls_sql(table)
    assert f"REVOKE ALL ON public.{table} FROM PUBLIC;" in manager.revoke_table_privileges_sql(table)
    policy = manager.tenant_isolation_policy_sql(table)
    assert f"CREATE POLICY tenant_isolation_policy ON public.{table}" in policy
    assert "USING (tenant_id = current_setting('app.current_tenant_id')::UUID)" in policy
    assert "WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::UUID)" in policy
    assert "IF NOT EXISTS" in policy


@pytest.mark.parametrize("table", TENANT_CONFIG_TABLES)
def test_tenant_config_table_registered_in_metadata(table: str) -> None:
    assert table in Base.metadata.tables


@pytest.mark.parametrize("table", TENANT_CONFIG_TABLES)
def test_rls_sql_generation_for_tenant_config_tables(table: str) -> None:
    _assert_rls_sql(RLSManager(schema="public"), table)


@pytest.mark.parametrize("table", CORE_TABLES)
def test_core_table_registered_in_metadata(table: str) -> None:
    assert table in Base.metadata.tables


@pytest.mark.parametrize("table", CORE_TABLES)
def test_rls_sql_generation_for_core_tables(table: str) -> None:
    _assert_rls_sql(RLSManager(schema="public"), table)


def test_bootstrap_tables_excluded_from_rls() -> None:
    """``tenants`` (bootstrap) y ``audit_logs`` no pueden llevar RLS por tenant.

    ``tenants`` no tiene columna ``tenant_id`` (es la raíz de bootstrap que se
    resuelve ANTES de fijar ``app.current_tenant_id``); ``audit_logs`` la tiene
    pero NULA y sin FK (lo escribe el middleware fuera del aislamiento). El
    generador de RLS emite la política para cualquier nombre; la exclusión es
    una decisión de migración, que se valida aquí estructuralmente.
    """
    tenants = Base.metadata.tables["tenants"]
    assert "tenant_id" not in tenants.columns

    audit_logs = Base.metadata.tables["audit_logs"]
    assert "tenant_id" in audit_logs.columns
    assert audit_logs.columns["tenant_id"].nullable is True
