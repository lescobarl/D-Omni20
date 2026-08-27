/**
 * OmniBotIA Embed (Fase C) — SDK del lado del cliente para landings PSEO.
 *
 * Contrato (plans/omnibotia_pseo_prompt_v2.md, Fase C):
 * - Lee la configuración desde <script id="omnibotia-config" type="application/json">,
 *   que el backend inyecta en el <head> al persistir la matriz PSEO:
 *     {"tenantId": "uuid-del-tenant", "apiBaseUrl": "https://cdn.example.com"}
 * - Expone window.OmniBotIAEmbed con los 4 workflows reales del backend:
 *   checkout, lead, quote, appointment → POST {apiBaseUrl}/api/v1/workflows/{wf}.
 * - Envía la cabecera X-Tenant-Id en cada request (sin cookies → CORS con
 *   orígenes explícitos; el backend añade el origen CDN a cors_origins).
 * - Binding declarativo: un elemento con [data-omni-workflow] dispara el
 *   workflow al hacer click; [data-omni-payload] (JSON opcional) es el body.
 * - Sin secretos y sin canales de mensajería externa: solo se comunica con la
 *   API pública v1 (nunca con pasarelas de chat/WhatsApp).
 * - El archivo es idéntico para todos los tenants (el tenant vive en la config).
 *
 * Uso programático:
 *   OmniBotIAEmbed.lead({name, email, phone, metadata: {...}});
 *   OmniBotIAEmbed.checkout({amount, currency, customer_email, metadata});
 *   OmniBotIAEmbed.quote({customer_name, services: [{name, unit_price, ...}]});
 *   OmniBotIAEmbed.appointment({service, starts_at, customer_name, ...});
 */
(function () {
  "use strict";

  var CONFIG_ID = "omnibotia-config";
  var WORKFLOWS_PATH = "/api/v1/workflows/";
  var WORKFLOWS = ["checkout", "lead", "quote", "appointment"];

  // Config inyectada por el backend (tenant_id + base del CDN). Nunca secretos.
  var config = (function readConfig() {
    var el = document.getElementById(CONFIG_ID);
    if (!el) {
      return null;
    }
    var raw = el.textContent || el.innerText || "";
    try {
      var parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === "object" &&
        typeof parsed.tenantId === "string" &&
        parsed.tenantId
      ) {
        return parsed;
      }
    } catch (_err) {
      // Config ausente/malformada: el embed se desactiva silenciosamente.
    }
    return null;
  })();

  if (!config || !config.tenantId) {
    return;
  }

  function buildUrl(workflow) {
    var base = String(config.apiBaseUrl || "").replace(/\/+$/, "");
    return base + WORKFLOWS_PATH + encodeURIComponent(workflow);
  }

  /**
   * Dispara un workflow vía fetch() a la API pública.
   * @param {string} workflow  checkout | lead | quote | appointment
   * @param {object} [payload] Body JSON; vacío → {}
   * @returns {Promise<object>} Respuesta JSON del backend.
   */
  function submit(workflow, payload) {
    var body =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? payload
        : {};

    return fetch(buildUrl(workflow), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tenant-Id": config.tenantId,
      },
      body: JSON.stringify(body),
    })
      .then(function (response) {
        return response.json().catch(function () {
          return null;
        });
      })
      .then(function (data) {
        var ok = responseOk(data);
        window.dispatchEvent(
          new CustomEvent(ok ? "omnibotia:success" : "omnibotia:error", {
            detail: { workflow: workflow, data: data },
          })
        );
        return data;
      });
  }

  function responseOk(data) {
    return !(data && data.error && data.error.status_code && data.error.status_code >= 400);
  }

  var api = {
    submit: submit,
  };

  WORKFLOWS.forEach(function (name) {
    api[name] = function (payload) {
      return submit(name, payload);
    };
  });

  // Exposición pública (idéntica para todos los tenants).
  window.OmniBotIAEmbed = api;

  // Binding declarativo: [data-omni-workflow] → click → submit.
  function bindWorkflows() {
    var nodes = document.querySelectorAll("[data-omni-workflow]");
    for (var i = 0; i < nodes.length; i += 1) {
      (function (node) {
        if (node.__omniBound) {
          return;
        }
        node.__omniBound = true;
        node.addEventListener("click", function (event) {
          var workflow = String(node.getAttribute("data-omni-workflow") || "").trim();
          if (WORKFLOWS.indexOf(workflow) === -1) {
            return;
          }
          var rawPayload = node.getAttribute("data-omni-payload");
          var payload = null;
          if (rawPayload) {
            try {
              payload = JSON.parse(rawPayload);
            } catch (_err) {
              payload = null;
            }
          }
          event.preventDefault();
          submit(workflow, payload);
        });
      })(nodes[i]);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindWorkflows);
  } else {
    bindWorkflows();
  }
})();
