/**
 * Portal del Cliente (C-3) — widget autónomo para landings compiladas.
 *
 * Contrato:
 * - Es agnóstico del tenant: la API pública del portal resuelve el cliente desde
 *   el Bearer token (claim ``email``); no depende de encabezados de tenant.
 * - Lo inyecta el compilador (bloque ``portal``) cargando este script desde
 *   ``{apiBaseUrl}/static/portal.js`` con ``defer`` dentro del contenedor
 *   ``[data-omni-portal]``.
 * - Lee la configuración del embed desde ``#omnibotia-config`` (mismo contrato
 *   que ``embed.js``) para descubrir ``apiBaseUrl``.
 *
 * Flujo:
 *  1. Login por email  → POST /api/v1/portal/login → token (sessionStorage).
 *  2. Resumen          → GET  /api/v1/portal/summary → pagos/leads/cotizaciones/citas.
 *  3. ARCO             → GET  /api/v1/portal/privacy/export (descarga JSON).
 *                       → DELETE /api/v1/portal/privacy/data (baja).
 */
(function () {
  'use strict';

  var CONFIG_ID = 'omnibotia-config';
  var CONTAINER_SELECTOR = '[data-omni-portal]';
  var TOKEN_KEY = 'omnibotia_portal_token';
  var EMAIL_KEY = 'omnibotia_portal_email';

  /**
   * Normaliza el apiBaseUrl quitando la barra final para componer rutas.
   * @param {string} value - URL base cruda (puede venir con "/").
   * @returns {string} URL base normalizada.
   */
  function buildBaseUrl(value) {
    return String(value || '').replace(/\/+$/, '');
  }

  /**
   * Lee y parsea la configuración del embed (nunca lanza).
   * @returns {object} Configuración; vacío si no existe o no es JSON válido.
   */
  function readConfig() {
    var configEl = document.getElementById(CONFIG_ID);
    if (!configEl) { return {}; }
    try {
      return JSON.parse(configEl.textContent || configEl.innerText || '{}');
    } catch (err) {
      return {};
    }
  }

  /**
   * Ejecuta una petición a la API pública del portal con el Bearer si existe.
   * @param {string} apiBaseUrl - Base normalizada del backend.
   * @param {string} path - Ruta de la API (p. ej. "/api/v1/portal/summary").
   * @param {object} [options] - Opciones de fetch (method, body, headers).
   * @returns {Promise<Response>} Respuesta de fetch.
   */
  function apiRequest(apiBaseUrl, path, options) {
    var headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    var token = sessionStorage.getItem(TOKEN_KEY);
    if (token) {
      headers.Authorization = 'Bearer ' + token;
    }
    return fetch(apiBaseUrl + path, Object.assign({}, options, { headers: headers }));
  }

  /**
   * Da formato a un monto en minor units (enteros) usando la moneda dada.
   * @param {number|string} amountMinor - Monto en centavos/unidades menores.
   * @param {string} [currency] - Código ISO 4217 (p. ej. "MXN").
   * @returns {string} Monto formateado; "—" si no es un número.
   */
  function formatAmount(amountMinor, currency) {
    var amount = Number(amountMinor);
    if (Number.isNaN(amount)) { return '—'; }
    var major = amount / 100;
    try {
      return new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: currency || 'MXN',
        minimumFractionDigits: 2
      }).format(major);
    } catch (err) {
      return major.toFixed(2) + ' ' + (currency || '');
    }
  }

  /**
   * Da formato legible a una fecha ISO (o devuelve "—" si no aplica).
   * @param {string|undefined} value - Fecha ISO o vacío.
   * @returns {string} Fecha local legible.
   */
  function formatDate(value) {
    if (!value) { return '—'; }
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) { return String(value); }
    return date.toLocaleDateString('es-MX', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  }

  /**
   * Construye un elemento HTML seguro a partir de un tag y atributos.
   * @param {string} tag - Nombre del tag (p. ej. "h3", "li").
   * @param {object} [attrs] - Atributos (className, textContent).
   * @returns {HTMLElement} Elemento creado.
   */
  function el(tag, attrs) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    if (attrs.className) { node.className = attrs.className; }
    if (attrs.textContent) { node.textContent = attrs.textContent; }
    return node;
  }

  /**
   * Renderiza una sección de resumen con título y lista de filas.
   * @param {HTMLElement} root - Contenedor donde insertar.
   * @param {string} title - Título de la sección.
   * @param {string[]} rows - Filas de texto ya formateadas.
   */
  function renderSection(root, title, rows) {
    var heading = el('h4', { className: 'omni-portal-section', textContent: title });
    root.appendChild(heading);
    if (!rows.length) {
      root.appendChild(el('p', { className: 'omni-portal-empty', textContent: 'Sin registros.' }));
      return;
    }
    var list = document.createElement('ul');
    rows.forEach(function (row) {
      list.appendChild(el('li', { textContent: row }));
    });
    root.appendChild(list);
  }

  /**
   * Muestra la sección de Pagos con filas pulsables (detalle por pago).
   * @param {string} apiBaseUrl - Base normalizada del backend.
   * @param {HTMLElement} container - Contenedor del portal.
   * @param {Array} payments - Pagos del resumen.
   */
  function renderPayments(apiBaseUrl, container, payments) {
    container.appendChild(el('h4', { className: 'omni-portal-section', textContent: 'Pagos' }));
    if (!payments.length) {
      container.appendChild(el('p', { className: 'omni-portal-empty', textContent: 'Sin registros.' }));
      return;
    }
    var list = document.createElement('ul');
    payments.forEach(function (payment) {
      var row = document.createElement('li');
      var button = el('button', {
        className: 'omni-portal-link',
        textContent:
          'Pago ' + formatAmount(payment.amount_minor, payment.currency) +
          ' · ' + (payment.status || '—') + ' · ' + formatDate(payment.created_at)
      });
      button.addEventListener('click', function () {
        fetchPaymentDetail(apiBaseUrl, payment.id, row);
      });
      row.appendChild(button);
      list.appendChild(row);
    });
    container.appendChild(list);
  }

  /**
   * Carga el detalle de un pago (GET /api/v1/portal/payments/{id}) y lo muestra.
   * @param {string} apiBaseUrl - Base normalizada del backend.
   * @param {string} paymentId - Identificador del pago.
   * @param {HTMLElement} row - Fila pulsada donde se inserta el detalle.
   */
  function fetchPaymentDetail(apiBaseUrl, paymentId, row) {
    var existing = row.parentNode.querySelector('.omni-portal-detail');
    if (existing) { existing.remove(); return; }
    apiRequest(apiBaseUrl, '/api/v1/portal/payments/' + encodeURIComponent(paymentId))
      .then(function (response) {
        if (!response.ok) { throw new Error('Detalle no disponible (' + response.status + ')'); }
        return response.json();
      })
      .then(function (detail) {
        var box = el('div', { className: 'omni-portal-detail' });
        box.appendChild(el('p', {
          textContent: 'Estado: ' + (detail.status || '—') +
            ' · Total: ' + formatAmount(detail.amount_minor, detail.currency) +
            ' · Creado: ' + formatDate(detail.created_at)
        }));
        if (detail.payment_method) {
          box.appendChild(el('p', { textContent: 'Método: ' + detail.payment_method }));
        }
        if (detail.metadata && detail.metadata.items) {
          box.appendChild(el('p', { textContent: 'Items: ' + JSON.stringify(detail.metadata.items) }));
        }
        row.appendChild(box);
      })
      .catch(function (error) {
        console.warn('[omni-portal] error en detalle de pago', error);
      });
  }

  /**
   * Muestra el panel de resumen del cliente (pagos, leads, cotizaciones, citas).
   * @param {string} apiBaseUrl - Base normalizada del backend.
   * @param {HTMLElement} container - Contenedor del portal.
   * @param {object} summary - Respuesta de ``/api/v1/portal/summary``.
   */
  function renderSummary(apiBaseUrl, container, summary) {
    container.textContent = '';
    var email = sessionStorage.getItem(EMAIL_KEY) || summary.email || '';
    var header = el('div', { className: 'omni-portal-head' });
    header.appendChild(el('p', { className: 'omni-portal-welcome', textContent: 'Hola, ' + email }));
    var logoutButton = el('button', {
      className: 'omni-portal-btn',
      textContent: 'Salir'
    });
    logoutButton.addEventListener('click', function () {
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(EMAIL_KEY);
      window.location.reload();
    });
    header.appendChild(logoutButton);
    container.appendChild(header);

    renderPayments(apiBaseUrl, container, summary.payments || []);

    var leads = (summary.leads || []).map(function (lead) {
      return (lead.name || '—') + ' · ' + (lead.email || '—') +
        ' · ' + (lead.status || '—') + ' · ' + formatDate(lead.created_at);
    });
    renderSection(container, 'Solicitudes', leads);

    var quotes = (summary.quotes || []).map(function (quote) {
      return 'Cotización ' + formatAmount(quote.total_minor, quote.currency) +
        ' · ' + (quote.status || '—') + ' · ' + formatDate(quote.created_at);
    });
    renderSection(container, 'Cotizaciones', quotes);

    var appointments = (summary.appointments || []).map(function (appointment) {
      return (appointment.service || '—') + ' · ' +
        formatDate(appointment.starts_at) + ' · ' + (appointment.status || '—');
    });
    renderSection(container, 'Citas', appointments);

    var opportunities = (summary.opportunities || []).map(function (deal) {
      return (deal.title || '—') + ' · ' + (deal.stage_name || '—') + ' · ' +
        formatAmount(deal.amount_minor, deal.currency);
    });
    renderSection(container, 'Mis oportunidades', opportunities);

    var nextSteps = (summary.next_steps || []).map(function (task) {
      return (task.title || '—') + ' · ' + (task.status || '—') + ' · ' +
        formatDate(task.due_at);
    });
    renderSection(container, 'Próximos pasos', nextSteps);

    renderArco(apiBaseUrl, container);
  }

  /**
   * Renderiza las acciones ARCO (exportación y baja de datos personales).
   * @param {string} apiBaseUrl - Base normalizada del backend.
   * @param {HTMLElement} container - Contenedor del portal.
   */
  function renderArco(apiBaseUrl, container) {
    var actions = el('div', { className: 'omni-portal-arco' });

    var exportButton = el('button', {
      className: 'omni-portal-btn',
      textContent: 'Descargar mis datos (ARCO)'
    });
    exportButton.addEventListener('click', function () {
      apiRequest(apiBaseUrl, '/api/v1/portal/privacy/export')
        .then(function (response) {
          if (!response.ok) { throw new Error('Export no disponible (' + response.status + ')'); }
          return response.json();
        })
        .then(function (payload) {
          var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
          var url = URL.createObjectURL(blob);
          var link = document.createElement('a');
          link.href = url;
          link.download = 'mis-datos-omnibotia.json';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        })
        .catch(function (error) {
          console.warn('[omni-portal] error en export ARCO', error);
        });
    });

    var deleteButton = el('button', {
      className: 'omni-portal-btn omni-portal-danger',
      textContent: 'Solicitar baja de mis datos (ARCO)'
    });
    deleteButton.addEventListener('click', function () {
      if (!window.confirm('Se eliminarán tus conversaciones y mensajes. ¿Continuar?')) { return; }
      apiRequest(apiBaseUrl, '/api/v1/portal/privacy/data', { method: 'DELETE' })
        .then(function (response) {
          if (!response.ok) { throw new Error('Baja no disponible (' + response.status + ')'); }
          return response.json();
        })
        .then(function (result) {
          var message = 'Se eliminaron ' + result.deleted_conversations +
            ' conversaciones y ' + result.deleted_messages + ' mensajes.';
          container.appendChild(el('p', { className: 'omni-portal-result', textContent: message }));
        })
        .catch(function (error) {
          console.warn('[omni-portal] error en baja ARCO', error);
        });
    });

    actions.appendChild(exportButton);
    actions.appendChild(deleteButton);
    container.appendChild(actions);
  }

  /**
   * Renderiza el formulario de acceso (email) y enlaza el login.
   * @param {string} apiBaseUrl - Base normalizada del backend.
   * @param {HTMLElement} container - Contenedor del portal.
   */
  function renderLogin(apiBaseUrl, container) {
    container.textContent = '';
    var form = document.createElement('form');
    form.className = 'omni-portal-login';

    var label = document.createElement('label');
    label.textContent = 'Correo electrónico';
    var input = document.createElement('input');
    input.type = 'email';
    input.name = 'email';
    input.required = true;
    input.placeholder = 'tu@correo.com';
    label.appendChild(input);

    var button = document.createElement('button');
    button.type = 'submit';
    button.className = 'omni-portal-btn';
    button.textContent = 'Entrar a mi portal';

    form.appendChild(label);
    form.appendChild(button);
    container.appendChild(form);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var email = input.value.trim();
      if (!email) { return; }
      button.disabled = true;
      apiRequest(apiBaseUrl, '/api/v1/portal/login', {
        method: 'POST',
        body: JSON.stringify({ email: email })
      })
        .then(function (response) {
          if (!response.ok) {
            throw new Error('No encontramos un cliente con ese correo (' + response.status + ')');
          }
          return response.json();
        })
        .then(function (payload) {
          sessionStorage.setItem(TOKEN_KEY, payload.token);
          sessionStorage.setItem(EMAIL_KEY, payload.email || email);
          return apiRequest(apiBaseUrl, '/api/v1/portal/summary');
        })
        .then(function (response) {
          if (!response.ok) { throw new Error('Resumen no disponible (' + response.status + ')'); }
          return response.json();
        })
        .then(function (summary) {
          renderSummary(apiBaseUrl, container, summary);
        })
        .catch(function (error) {
          button.disabled = false;
          container.appendChild(el('p', { className: 'omni-portal-error', textContent: error.message }));
        });
    });
  }

  /**
   * Renderiza la barra de navegación multipágina del portal.
   * Las páginas vienen de ``config.pages`` (configuradas en el configurador de
   * Omni2.0 como ``content_items`` con ``kind="portal"``). La primera página es
   * la activa por defecto. Al hacer clic se muestra el contenido de la página.
   * @param {HTMLElement} nav - Contenedor ``[data-omni-nav]``.
   * @param {HTMLElement} container - Contenedor ``[data-omni-portal]``.
   * @param {object} config - Configuración leída de ``#omnibotia-config``.
   */
  function renderNav(nav, container, config) {
    if (!nav) { return; }
    var pages = config.pages || [];
    if (!pages.length) { return; }
    nav.textContent = '';
    var active = pages[0].slug;
    var pageContent = el('div', { className: 'portal-page-content' });
    container.parentNode.appendChild(pageContent);

    function showPage(slug) {
      var page = null;
      pages.forEach(function (p) { if (p.slug === slug) { page = p; } });
      if (!page) { return; }
      active = slug;
      Array.prototype.forEach.call(nav.children, function (btn) {
        btn.classList.toggle('active', btn.getAttribute('data-slug') === slug);
      });
      pageContent.textContent = page.content || '';
      // El contenido del portal (login/resumen) se mantiene en su sección.
      container.style.display = (slug === 'inicio') ? '' : 'none';
    }

    pages.forEach(function (page) {
      var btn = el('button', { textContent: page.title });
      btn.setAttribute('data-slug', page.slug);
      if (page.slug === active) { btn.className = 'active'; }
      btn.addEventListener('click', function () { showPage(page.slug); });
      nav.appendChild(btn);
    });
    showPage(active);
  }

  /**
   * Inicializa el widget: descubrimiento de config y render inicial.
   */
  function init() {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) { return; }
    var config = readConfig();
    var apiBaseUrl = buildBaseUrl(config.apiBaseUrl);
    if (!apiBaseUrl) {
      console.warn('[omni-portal] apiBaseUrl ausente en omnibotia-config; portal desactivado');
      return;
    }
    var nav = document.querySelector('[data-omni-nav]');
    renderNav(nav, container, config);
    if (sessionStorage.getItem(TOKEN_KEY)) {
      apiRequest(apiBaseUrl, '/api/v1/portal/summary')
        .then(function (response) {
          if (!response.ok) { throw new Error('Sesión no válida (' + response.status + ')'); }
          return response.json();
        })
        .then(function (summary) {
          renderSummary(apiBaseUrl, container, summary);
        })
        .catch(function () {
          sessionStorage.removeItem(TOKEN_KEY);
          sessionStorage.removeItem(EMAIL_KEY);
          renderLogin(apiBaseUrl, container);
        });
      return;
    }
    renderLogin(apiBaseUrl, container);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
