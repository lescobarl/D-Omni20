"""E2E del ciclo CRM integral (P6 §6 del plan PLAN_CRM_E2E_Y_UX.md) contra el
runtime vivo.

Valida el ciclo completo del pipeline sobre un tenant NUEVO por ejecución
(aislamiento determinista vía ``RUN_TENANT``): seed del pipeline (6 etapas) y
SLA, captura de lead con UTM + ``needs_human`` (auto-creación de la oportunidad
y tarea con SLA), avance del deal a Cotización (con DealStageChange registrado)
y cotización vinculada, confirmación de pago (sugerencia ``Ganado``), cierre a
la etapa terminal Ganado, embudo con montos/valor ponderado/conversión/ciclo,
Portal del Cliente (login + resumen autoservicio), soft-delete de un deal
(persistencia en BD + baja de listados) y aislamiento multi-tenant (RLS 404/403).

Uso:
    python -m scripts.e2e_crm_scenario

Requisitos (se verifican en tiempo de ejecución):
    - Backend vivo en http://127.0.0.1:8000  (run_dev.py)

Criterio de aceptación (gate §P6):
    E2E GREEN exit 0 con estado persistido verificable (no-dummy) + cobertura
    backend ≥95%.
"""

from __future__ import annotations

import sys
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

# Consolas Windows (cp1252) no pueden imprimir ①/⑧/⑥/④; forzamos UTF-8.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

API = "http://127.0.0.1:8000"

# Tenant NUEVO por ejecución: cada run aísla su estado (funnel/resumen/RLS
# deterministas) sin colisiones con corridas previas ni con el tenant dev.
RUN_TENANT = str(uuid.uuid4())
OTHER_TENANT = str(uuid.uuid4())
TENANT_HEADERS = {"X-Tenant-Id": RUN_TENANT}
OTHER_HEADERS = {"X-Tenant-Id": OTHER_TENANT}

# Contacto único por ejecución (el ciclo ⑤→⑥→⑩ es repetible con evidencia limpia).
RUN_ID = str(uuid.uuid4().int % 10_000).zfill(4)
CLIENT_NAME = "Ana García"
CLIENT_EMAIL = f"ana.garcia.{RUN_ID}@example.com"
CLIENT_PHONE = f"+52 55 7700 {RUN_ID}"

# Metadatos planos del lead (los UTM se guardan en raíz, no anidados). Al
# auto-crear la oportunidad, estos metadatos fluyen al deal (``metadata``).
UTM_LEAD_METADATA: dict[str, Any] = {
    "needs_human": True,
    "utm_source": "meta",
    "utm_medium": "cpc",
    "utm_campaign": "escobar-crm-e2e",
    "utm_content": "lead-crm-e2e",
    "utm_term": "crm-e2e",
}

# Pipeline del tenant (nombre, order, default_probability, terminal, outcome).
PIPELINE: list[tuple[str, int, int, bool, str | None]] = [
    ("Nuevo", 0, 20, False, None),
    ("Calificado", 1, 40, False, None),
    ("Cotización", 2, 60, False, None),
    ("Negociación", 3, 80, False, None),
    ("Ganado", 4, 90, True, "won"),
    ("Perdido", 5, 10, True, "lost"),
]

PASS = "PASS"
FAIL = "FAIL"


def banner(text: str) -> None:
    print(f"\n{'=' * 72}\n{text}\n{'=' * 72}")


def check(label: str, ok: bool, detail: str = "") -> None:
    status = PASS if ok else FAIL
    print(f"  [{status}] {label}" + (f" — {detail}" if detail else ""))
    if not ok:
        raise SystemExit(f"ABORT: {label} {detail}")


def get_json(client: httpx.Client, path: str, *, headers: dict[str, str] | None = None) -> Any:
    resp = client.get(API + path, headers=headers)
    resp.raise_for_status()
    return resp.json()


def list_page(client: httpx.Client, path: str, *, headers: dict[str, str] | None = None) -> list[dict[str, Any]]:
    """Itera una respuesta ``Page`` (items/total/page/page_size) completa."""
    items: list[dict[str, Any]] = []
    page = 1
    page_size = 100
    while True:
        sep = "&" if "?" in path else "?"
        data = get_json(client, f"{path}{sep}page={page}&page_size={page_size}", headers=headers)
        items.extend(data.get("items", []))
        total = int(data.get("total", 0))
        if len(items) >= total or not data.get("items"):
            break
        page += 1
    return items


def post_json(
    client: httpx.Client,
    path: str,
    *,
    headers: dict[str, str] | None = None,
    payload: dict[str, Any] | None = None,
) -> Any:
    resp = client.post(API + path, headers=headers, json=payload)
    resp.raise_for_status()
    return resp.json()


def put_json(
    client: httpx.Client,
    path: str,
    *,
    headers: dict[str, str] | None = None,
    payload: dict[str, Any] | None = None,
) -> Any:
    resp = client.put(API + path, headers=headers, json=payload)
    resp.raise_for_status()
    return resp.json()


def patch_json(
    client: httpx.Client,
    path: str,
    *,
    headers: dict[str, str] | None = None,
    payload: dict[str, Any] | None = None,
) -> Any:
    resp = client.patch(API + path, headers=headers, json=payload)
    resp.raise_for_status()
    return resp.json()


def delete_ok(client: httpx.Client, path: str, *, headers: dict[str, str] | None = None) -> None:
    resp = client.delete(API + path, headers=headers)
    resp.raise_for_status()


def find_by_title(items: list[dict[str, Any]], title: str) -> dict[str, Any] | None:
    for item in items:
        if str(item.get("title", "")).strip() == title:
            return item
    return None


def stage_payload(*, name: str, order: int, dp: int, terminal: bool, outcome: str | None) -> dict[str, Any]:
    return {
        "name": name,
        "order": order,
        "default_probability": dp,
        "is_terminal": terminal,
        "outcome": outcome,
    }


def main() -> None:
    banner("P6 — CICLO CRM INTEGRAL (lead → pipeline → pago → embudo → portal → RLS)")
    with httpx.Client(timeout=20.0) as client:
        # 0. Preflight del runtime.
        health = get_json(client, "/api/v1/health")
        check("backend /api/v1/health", health.get("status") == "ok", str(health.get("app_version")))

        # 1. Pipeline (6 etapas) + SLA en "Nuevo".
        banner("1. PIPELINE (6 ETAPAS) + SLA EN 'Nuevo'")
        stages: dict[str, dict[str, Any]] = {}
        for name, order, dp, terminal, outcome in PIPELINE:
            created = post_json(
                client,
                "/api/v1/crm/stages",
                headers=TENANT_HEADERS,
                payload=stage_payload(name=name, order=order, dp=dp, terminal=terminal, outcome=outcome),
            )
            stages[name] = created
            print(f"  [create] etapa '{name}' (id={created['id']}, order={created['order']})")
        check("6 etapas creadas", len(stages) == 6, f"len={len(stages)}")
        check("terminal Ganado outcome=won", stages["Ganado"]["outcome"] == "won")
        check("terminal Perdido outcome=lost", stages["Perdido"]["outcome"] == "lost")

        sla = put_json(
            client,
            "/api/v1/crm/sla",
            headers=TENANT_HEADERS,
            payload={
                "stage_id": stages["Nuevo"]["id"],
                "max_response_hours": 24,
                "max_stay_days": 7,
            },
        )
        check("SLA upsert en 'Nuevo'", sla.get("max_response_hours") == 24, f"hours={sla.get('max_response_hours')}")

        # 2. Lead con UTM + needs_human → auto-creación de Deal + Task con SLA.
        banner("2. LEAD CON UTM → AUTO-CREACIÓN DE OPORTUNIDAD + TAREA CON SLA")
        lead = post_json(
            client,
            "/api/v1/workflows/lead",
            headers=TENANT_HEADERS,
            payload={
                "name": CLIENT_NAME,
                "email": CLIENT_EMAIL,
                "phone": CLIENT_PHONE,
                "source": "landing",
                "metadata": UTM_LEAD_METADATA,
            },
        )
        check("lead capturado 201", str(lead.get("email")) == CLIENT_EMAIL, f"id={lead.get('id')}")

        deals = list_page(client, "/api/v1/crm/deals", headers=TENANT_HEADERS)
        deal = find_by_title(deals, f"Oportunidad: {CLIENT_NAME}")
        check("deal auto-creado 'Oportunidad: Ana García'", deal is not None)
        assert deal is not None
        deal_id = deal["id"]
        check("deal en etapa 'Nuevo'", str(deal["stage_id"]) == str(stages["Nuevo"]["id"]))
        check("deal abierto (status=open)", deal["status"] == "open", f"status={deal['status']}")
        check("deal probability=20 (default de Nuevo)", deal["probability"] == 20, f"p={deal['probability']}")
        check("deal amount_minor=0 al auto-crear", deal["amount_minor"] == 0, f"amount={deal['amount_minor']}")
        check("deal currency=USD", deal["currency"] == "USD", f"currency={deal['currency']}")
        check("deal metadata.origin=lead_needs_human", deal.get("metadata", {}).get("origin") == "lead_needs_human")
        check("deal metadata.lead_source=landing", deal.get("metadata", {}).get("lead_source") == "landing")
        check("deal metadata.needs_human=True", deal.get("metadata", {}).get("needs_human") is True)
        check("UTM plano propagado al deal (utm_source=meta)", deal.get("metadata", {}).get("utm_source") == "meta")
        check("deal ligado al lead", str(deal["lead_id"]) == str(lead["id"]))
        check("deal con contact_id", deal.get("contact_id") is not None)
        check("deal revision=1", deal["revision"] == 1, f"rev={deal['revision']}")

        tasks = list_page(client, "/api/v1/crm/tasks", headers=TENANT_HEADERS)
        task = find_by_title(tasks, "Contactar al lead")
        check("tarea 'Contactar al lead' auto-creada", task is not None)
        assert task is not None
        check("tarea ligada al deal", str(task["deal_id"]) == str(deal_id))
        check("tarea ligada al contacto", task.get("contact_id") is not None)
        check("tarea pendiente", task["status"] == "pending", f"status={task['status']}")
        check("tarea prioridad alta", task["priority"] == "high", f"priority={task['priority']}")
        due_at = datetime.fromisoformat(task["due_at"])
        # El runtime serializa datetimes en UTC; si emite naive, lo normalizamos
        # para poder compararlo contra un reloj timezone-aware.
        if due_at.tzinfo is None:
            due_at = due_at.replace(tzinfo=timezone.utc)
        delta = due_at - datetime.now(timezone.utc)
        check(
            "tarea con SLA ~24h",
            timedelta(hours=23) < delta < timedelta(hours=25),
            f"delta={delta}",
        )

        history = get_json(client, f"/api/v1/crm/deals/{deal_id}/history", headers=TENANT_HEADERS)
        check("historial inicial de 1 movimiento", len(history) == 1, f"len={len(history)}")
        first = history[0]
        check("historial[0] desde sin etapa", first.get("from_stage_id") is None)
        check("historial[0] hacia 'Nuevo'", str(first["to_stage_id"]) == str(stages["Nuevo"]["id"]))
        check("historial[0] changed_by=sistema", first["changed_by"] == "sistema", f"by={first['changed_by']}")
        check(
            "historial[0] nota de creación",
            first["note"] == "Creación automática desde lead con atención humana",
            f"note={first.get('note')!r}",
        )

        # 3. Avance a Cotización + generación de quote vinculada.
        banner("3. AVANCE A 'COTIZACIÓN' + QUOTE VINCULADA")
        moved = patch_json(
            client,
            f"/api/v1/crm/deals/{deal_id}",
            headers=TENANT_HEADERS,
            payload={
                "stage_id": stages["Cotización"]["id"],
                "note": "Cotización solicitada",
                "amount_minor": 9950,
            },
        )
        check("deal movido a 'Cotización'", str(moved["stage_id"]) == str(stages["Cotización"]["id"]))
        check("deal amount_minor=9950 tras PATCH", moved["amount_minor"] == 9950, f"amount={moved['amount_minor']}")

        history = get_json(client, f"/api/v1/crm/deals/{deal_id}/history", headers=TENANT_HEADERS)
        check("historial con 2 movimientos", len(history) == 2, f"len={len(history)}")
        second = history[1]
        check("historial[1] hacia 'Cotización'", str(second["to_stage_id"]) == str(stages["Cotización"]["id"]))
        check("historial[1] changed_by=vendedor", second["changed_by"] == "vendedor", f"by={second['changed_by']}")
        check("historial[1] nota 'Cotización solicitada'", second["note"] == "Cotización solicitada")

        quote = post_json(
            client,
            "/api/v1/workflows/quote",
            headers=TENANT_HEADERS,
            payload={
                "customer_name": CLIENT_NAME,
                "customer_email": CLIENT_EMAIL,
                "currency": "usd",
                "services": [{"name": "Apto centro", "quantity": 1, "unit_price": "100.00"}],
                "tax_rate_bps": 0,
            },
        )
        quote_id = quote["quote_id"]
        check("quote generada", bool(quote_id), f"id={quote_id}")
        check("quote total=$100.00 USD", float(quote["total"]) == 100.0, f"total={quote['total']}")

        linked = patch_json(
            client,
            f"/api/v1/crm/deals/{deal_id}",
            headers=TENANT_HEADERS,
            payload={"quote_id": quote_id},
        )
        check("deal.quote_id vinculado", str(linked["quote_id"]) == str(quote_id), f"quote={linked.get('quote_id')}")

        # 4. Confirmación de pago → sugerencia Ganado → cierre a terminal Ganado.
        banner("4. PAGO CONFIRMADO → SUGERENCIA 'GANADO' → CIERRE GANADO")
        checkout = post_json(
            client,
            "/api/v1/workflows/checkout",
            headers=TENANT_HEADERS,
            payload={
                "amount": "99.50",
                "currency": "usd",
                "customer_email": CLIENT_EMAIL,
                "customer_name": CLIENT_NAME,
                "metadata": {},
            },
        )
        payment_id = checkout["payment_id"]
        check("checkout creado", bool(payment_id), f"id={payment_id}")

        paid = post_json(client, f"/api/v1/workflows/checkout/{payment_id}/confirm", headers=TENANT_HEADERS)
        check("pago confirmado (succeeded)", paid.get("status") == "succeeded", f"status={paid.get('status')}")

        suggested = get_json(client, f"/api/v1/crm/deals/{deal_id}", headers=TENANT_HEADERS)
        suggestion = suggested.get("metadata", {}).get("crm_suggestion", {})
        check("deal sigue abierto tras sugerencia", suggested["status"] == "open", f"status={suggested['status']}")
        check("sugerencia type=won", suggestion.get("type") == "won", f"type={suggestion.get('type')}")
        check("sugerencia source=payment:*", str(suggestion.get("source", "")).startswith("payment:"), f"src={suggestion.get('source')}")
        check("sugerencia suggested_at presente", bool(suggestion.get("suggested_at")))

        won = patch_json(
            client,
            f"/api/v1/crm/deals/{deal_id}",
            headers=TENANT_HEADERS,
            payload={"stage_id": stages["Ganado"]["id"], "note": "Cliente pagó (cierre Ganado)"},
        )
        check("deal cerrado como ganado", won["status"] == "won", f"status={won['status']}")
        check("won_at fijado", won.get("won_at") is not None)
        check("closed_at fijado", won.get("closed_at") is not None)

        history = get_json(client, f"/api/v1/crm/deals/{deal_id}/history", headers=TENANT_HEADERS)
        third = history[-1]
        check("historial[último] hacia 'Ganado'", str(third["to_stage_id"]) == str(stages["Ganado"]["id"]))
        check("historial[último] changed_by=vendedor", third["changed_by"] == "vendedor", f"by={third['changed_by']}")

        # 5. Embudo: montos, valor ponderado, conversión y ciclo.
        banner("5. EMBUDO (montos, ponderado, conversión y ciclo)")
        funnel = get_json(client, "/api/v1/crm/funnel", headers=TENANT_HEADERS)
        check("funnel total_deals=1", funnel["total_deals"] == 1, f"total={funnel['total_deals']}")
        check("funnel won_count=1", funnel["won_count"] == 1, f"won={funnel['won_count']}")
        check("funnel lost_count=0", funnel["lost_count"] == 0, f"lost={funnel['lost_count']}")
        check("funnel open_count=0 (deals abiertos)", funnel["open_count"] == 0, f"open={funnel['open_count']}")
        check("funnel won_amount_minor=9950", funnel["won_amount_minor"] == 9950, f"amount={funnel['won_amount_minor']}")
        check("funnel close_rate=1.0", funnel["close_rate"] == 1.0, f"rate={funnel['close_rate']}")
        check("funnel avg_cycle_days calculado", funnel.get("avg_cycle_days") is not None, f"days={funnel.get('avg_cycle_days')}")
        check("funnel sin etapas abiertas (stages=[])", funnel["stages"] == [], f"stages={len(funnel['stages'])}")

        # 6. Portal del Cliente: login + resumen autoservicio.
        banner("6. PORTAL DEL CLIENTE (login + resumen autoservicio)")
        login = post_json(
            client,
            "/api/v1/portal/login",
            headers=TENANT_HEADERS,
            payload={"email": CLIENT_EMAIL},
        )
        check("portal login devuelve token", bool(login.get("token")), f"email={login.get('email')}")
        check("portal login email normalizado", str(login.get("email")) == CLIENT_EMAIL)

        summary = get_json(client, f"/api/v1/crm/summary?email={CLIENT_EMAIL}", headers=TENANT_HEADERS)
        check("resumen total_deals=1", summary["total_deals"] == 1, f"total={summary['total_deals']}")
        check("resumen open_deals=0", summary["open_deals"] == 0, f"open={summary['open_deals']}")
        check("resumen won_deals=1", summary["won_deals"] == 1, f"won={summary['won_deals']}")
        check("resumen incluye la oportunidad ganada", len(summary["deals"]) == 1 and str(summary["deals"][0]["id"]) == str(deal_id))
        summary_titles = [t.get("title") for t in summary["tasks"]]
        check("resumen incluye tarea 'Contactar al lead'", "Contactar al lead" in summary_titles, f"titles={summary_titles}")

        # 7. Soft-delete de un deal abierto → baja de listados, persiste en BD.
        banner("7. SOFT-DELETE DE UN DEAL ABIERTO (persistencia verificable)")
        extra = post_json(
            client,
            "/api/v1/crm/deals",
            headers=TENANT_HEADERS,
            payload={
                "title": f"Deal soft-delete {RUN_ID}",
                "stage_id": stages["Calificado"]["id"],
                "amount_minor": 5000,
                "currency": "USD",
                "probability": 40,
            },
        )
        extra_id = extra["id"]
        check("deal extra creado en 'Calificado'", str(extra["stage_id"]) == str(stages["Calificado"]["id"]))

        deals = list_page(client, "/api/v1/crm/deals", headers=TENANT_HEADERS)
        check("deal extra visible en listado", find_by_title(deals, f"Deal soft-delete {RUN_ID}") is not None)

        funnel = get_json(client, "/api/v1/crm/funnel", headers=TENANT_HEADERS)
        check("funnel total_deals=2", funnel["total_deals"] == 2, f"total={funnel['total_deals']}")
        check("funnel open_count=1", funnel["open_count"] == 1, f"open={funnel['open_count']}")
        check("funnel won_count=1", funnel["won_count"] == 1, f"won={funnel['won_count']}")
        check("funnel stages=1 ('Calificado')", len(funnel["stages"]) == 1 and funnel["stages"][0]["stage_name"] == "Calificado")
        if funnel["stages"]:
            stage = funnel["stages"][0]
            check("embudo count=1", stage["count"] == 1, f"count={stage['count']}")
            check("embudo total_amount_minor=5000", stage["total_amount_minor"] == 5000, f"amount={stage['total_amount_minor']}")
            check("embudo weighted_value_minor=2000 (5000×40%)", stage["weighted_value_minor"] == 2000, f"weighted={stage['weighted_value_minor']}")

        delete_ok(client, f"/api/v1/crm/deals/{extra_id}", headers=TENANT_HEADERS)
        resp = client.get(API + f"/api/v1/crm/deals/{extra_id}", headers=TENANT_HEADERS)
        check("deal soft-eliminado → GET 404", resp.status_code == 404, f"status={resp.status_code}")
        deals = list_page(client, "/api/v1/crm/deals", headers=TENANT_HEADERS)
        check("deal soft-eliminado fuera del listado", find_by_title(deals, f"Deal soft-delete {RUN_ID}") is None)
        funnel = get_json(client, "/api/v1/crm/funnel", headers=TENANT_HEADERS)
        check("funnel vuelve a total_deals=1", funnel["total_deals"] == 1, f"total={funnel['total_deals']}")
        check("funnel vuelve a open_count=0", funnel["open_count"] == 0, f"open={funnel['open_count']}")

        # 8. Aislamiento multi-tenant (RLS): lectura cruzada 404 y sin header 403.
        banner("8. AISLAMIENTO MULTI-TENANT (RLS 404/403)")
        resp = client.get(API + f"/api/v1/crm/deals/{deal_id}", headers=OTHER_HEADERS)
        check("RLS: deal del tenant activo leído por otro tenant → 404", resp.status_code == 404, f"status={resp.status_code}")
        resp = client.post(
            API + "/api/v1/crm/deals",
            headers=OTHER_HEADERS,
            json={
                "title": f"Cross-tenant {RUN_ID}",
                "stage_id": stages["Nuevo"]["id"],
                "amount_minor": 1000,
                "currency": "USD",
                "probability": 20,
            },
        )
        check("RLS: crear deal con etapa de otro tenant → 404", resp.status_code == 404, f"status={resp.status_code}")
        resp = client.get(API + "/api/v1/crm/deals")
        check("RLS: sin X-Tenant-Id → 403", resp.status_code == 403, f"status={resp.status_code}")

    banner("RESULTADO")
    print(
        "Ciclo CRM integral validado de punta a punta sobre tenant nuevo "
        f"({RUN_TENANT[:8]}…): pipeline 6 etapas + SLA, lead UTM → oportunidad + "
        "tarea con SLA, avance a Cotización con historial (vendedor), quote "
        "vinculada, pago confirmado → sugerencia Ganado → cierre won, embudo "
        "(montos/ponderado/conversión/ciclo), Portal del Cliente (login + "
        "resumen), soft-delete persistente y aislamiento RLS (404/403). "
        "Estado persistido verificable vía API (no-dummy)."
    )


if __name__ == "__main__":
    try:
        main()
    except httpx.HTTPError as exc:  # pragma: no cover
        print(f"\nERROR HTTP: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
