/**
 * Catálogo central y tipado de los textos de ayuda del módulo de configuración.
 *
 * Contrato (única fuente de verdad para el mantenimiento):
 * - Cada entrada corresponde a UN campo de configuración identificado por su
 *   clave (`fieldKey`). Los componentes NO escriben texto de ayuda inline:
 *   resuelven la clave vía {@link fieldHelpText} y la entregan a `<FieldHelp>`.
 * - La clave es un union tipado derivado del propio catálogo (`FieldHelpKey`):
 *   si un campo deja de existir o se renombra, el compilador falla en el punto
 *   de uso, evitando texto huérfano o referencias rotas.
 * - El guard `fieldHelp.test.ts` verifica que toda clave del catálogo esté en
 *   uso por al menos un componente (cero entradas muertas).
 */

/**
 * Entrada de ayuda de un campo del módulo de configuración.
 */
export interface IFieldHelpEntry {
  /** Texto de ayuda mostrado en el globo y anunciado por lectores de pantalla. */
  text: string;
}

/**
 * Catálogo de ayuda por campo del módulo de configuración.
 *
 * Convención de claves: `<sección>.<campo>` (p. ej. `catalog.sku`). El texto
 * se redacta en imperativo descriptivo breve; si cambia, se edita SOLO aquí.
 */
export const FIELD_HELP = {
  'appearance.branding_url': {
    text: 'URL pública de una marca: el sistema extrae de ahí su paleta, tipografía y logo para aplicarlos al tema.',
  },
  'appearance.branding_name': {
    text: 'Nombre identificador para guardar esta configuración de marca como reutilizable.',
  },
  'content.document_file': {
    text: 'Sube un archivo PDF, TXT o CSV para incorporarlo a la base de conocimiento del bot.',
  },
  'content.document_url': {
    text: 'URL de un documento alojado en internet para incorporarlo a la base de conocimiento.',
  },
  'content.synonym_term': {
    text: 'Término canónico al que apuntan los sinónimos: es la variante que el bot reconoce como oficial.',
  },
  'content.synonym_items': {
    text: 'Sinónimos separados por comas: cualquier variante escrita por el cliente resolverá al término canónico.',
  },
  'content.synonym_import': {
    text: 'Pega contenido en formato CSV o JSON (término, sinónimos) para importar varios sinónimos de una sola vez.',
  },
  'channels.external_id': {
    text: 'Identificador externo opcional del canal (referencia interna o de tu CRM).',
  },
  'channels.phone_number_id': {
    text: 'ID del número de teléfono asignado por Meta Cloud API.',
  },
  'channels.access_token': {
    text: 'Token de acceso permanente (system user token) generado en Meta Business Manager.',
  },
  'channels.webhook_secret': {
    text: 'Secreto de verificación del webhook de WhatsApp. Se guarda cifrado y solo se muestra al crear el canal.',
  },
  'channels.enabled': {
    text: 'Deja el canal conectado y habilitado para recibir y enviar mensajes.',
  },
  'bots.provider_kind': {
    text: 'Tipo de proveedor de IA (por ejemplo, openai). Solo se admite un proveedor por tipo.',
  },
  'bots.provider_order': {
    text: 'Orden de prioridad del proveedor: los de menor orden se intentan primero.',
  },
  'bots.provider_model': {
    text: 'Identificador del modelo a usar (por ejemplo, gpt-4o-mini).',
  },
  'bots.provider_temperature': {
    text: 'Creatividad de las respuestas: valores bajos son más deterministas; valores altos, más variados.',
  },
  'bots.provider_prompt_base': {
    text: 'Instrucciones base del sistema que definen la personalidad y las reglas del bot.',
  },
  'bots.provider_enabled': {
    text: 'Habilita o deshabilita este proveedor sin eliminar su configuración.',
  },
  'operations.contact_state': {
    text: 'Estado crudo del contacto (por ejemplo, new). El bot lo usa para segmentar y priorizar la conversación.',
  },
  'operations.contact_source': {
    text: 'Origen crudo del contacto (por ejemplo, manual, wa o una campaña). Registra dónde se captó.',
  },
  'operations.contact_external_id': {
    text: 'Identificador externo del contacto en tu CRM o canal (por ejemplo, wa:521234567890). Úsalo solo si sincronizas con otra herramienta.',
  },
  'operations.intervention_conversation': {
    text: 'Identificador UUID de la conversación que requiere intervención humana. Copia el id de la conversación del chat.',
  },
  'operations.intervention_state': {
    text: 'Estado de la intervención: pending (sin atender), assigned (en curso) o resolved (resuelta).',
  },
  'operations.intervention_assignment': {
    text: 'Marca de tiempo (ISO 8601) de cuándo se asignó la intervención a un operador.',
  },
  'operations.intervention_resolution': {
    text: 'Marca de tiempo (ISO 8601) de cuándo se resolvió la intervención.',
  },
  'operations.maintenance_schedule': {
    text: 'Expresión cron de 5 campos (minuto hora día-mes mes día-semana). Por ejemplo, 0 3 * * * ejecuta el mantenimiento a las 03:00 todos los días.',
  },
  'ads.status': {
    text: 'Estado crudo de la campaña (por ejemplo, active). Déjalo en active para que la campaña esté operativa.',
  },
  'ads.utm_source': {
    text: 'UTM Fuente: la plataforma de donde viene el clic (por ejemplo, meta, google, instagram).',
  },
  'ads.utm_medium': {
    text: 'UTM Medio: el tipo de tráfico (por ejemplo, cpc para anuncios de pago, email o social).',
  },
  'ads.utm_campaign': {
    text: 'UTM Campaña: nombre de la campaña publicitaria (por ejemplo, tequesquitengo-lago).',
  },
  'ads.utm_content': {
    text: 'UTM Contenido: identifica la pieza concreta del anuncio que se pulsó (por ejemplo, banner o video).',
  },
  'ads.utm_term': {
    text: 'UTM Término: la palabra clave o búsqueda asociada al anuncio (por ejemplo, lago).',
  },
  'ads.budget_cents': {
    text: 'Presupuesto de la campaña en unidades menores (centavos). Por ejemplo, 150000 = 1,500.00 en la moneda del tenant.',
  },
  'ads.start_at': {
    text: 'Fecha y hora de inicio de la campaña en formato ISO 8601 (por ejemplo, 2026-08-18T00:00:00Z).',
  },
  'ads.end_at': {
    text: 'Fecha y hora de fin de la campaña en formato ISO 8601 (por ejemplo, 2026-08-25T23:59:59Z). Déjalo vacío para que sea indefinida.',
  },
  'workflows.tax_basis_points': {
    text: 'Tasa de impuesto en puntos base: 1600 equivale a 16 %. El rango permitido es de 0 a 10000 (0–100 %).',
  },
  'operations.campaign_template': {
    text: 'Identificador UUID de la plantilla que enviará la campaña. Cópialo de la sección de plantillas de Operación.',
  },
  'operations.campaign_schedule': {
    text: 'Fecha y hora de envío programado en formato ISO 8601 (por ejemplo, 2026-08-20T10:00:00Z).',
  },
  'operations.campaign_trigger_event': {
    text: 'Evento del widget o integración que dispara la campaña (por ejemplo, checkout.created o payment.completed).',
  },
  'editor.prop_key': {
    text: 'Clave de la propiedad en el JSON del contenido. Usa minúsculas y guiones bajos; identifica el dato en el schema.',
  },
  'editor.prop_type': {
    text: 'Tipo de dato JSON de la propiedad (string, number, boolean, array u object). Define cómo se edita y valida.',
  },
  'editor.prop_format': {
    text: 'Formato semántico de una cadena (por ejemplo, email o uri). Aplica validación extra al contenido.',
  },
  'editor.prop_items_type': {
    text: 'Tipo de dato de los elementos dentro de una lista (array).',
  },
  'editor.slug': {
    text: 'Slug de la página: define su URL pública (minúsculas y guiones). Por ejemplo, servicios → /servicios.',
  },
  'editor.schema_version': {
    text: 'Versión semver del schema (mayor.menor.parche). Se sugiere incrementar el parche; los cambios incompatibles suben la versión mayor.',
  },
  'crm.task_assignee': {
    text: 'Identificador UUID del usuario responsable de la tarea. Cópialo de la sección Usuarios (id del usuario).',
  },
  'operations.campaign_recipient_contact': {
    text: 'Identificador UUID del contacto del directorio que recibirá la campaña. Cópialo de la sección Contactos.',
  },
  'operations.campaign_recipients_csv': {
    text: 'Pega el CSV de destinatarios con cabecera (contact_id,estado,resultado,intentos). Solo se añaden los contactos existentes del tenant.',
  },
  'operations.campaign_recipient_file_csv': {
    text: 'Pega el CSV con cabecera (phone,name) o sube un archivo .csv: crea los contactos y los añade a la campaña.',
  },
  'operations.template_type': {
    text: 'Tipo crudo de la plantilla (por ejemplo, text). No lo cambies salvo que la integración lo requiera.',
  },
  'operations.template_variables': {
    text: 'Variables declaradas del cuerpo, separadas por comas. Cada una debe existir entre dobles llaves en el cuerpo (por ejemplo, {{nombre}}).',
  },
  'operations.tree_options': {
    text: 'Opciones del menú en formato clave: etiqueta, una por línea (por ejemplo, saludar: Saludar). El bot reconoce la clave y muestra la etiqueta.',
  },
  'sla.max_response_hours': {
    text: 'Horas máximas para responder por primera vez dentro de esta etapa antes de marcar el SLA como vencido.',
  },
  'sla.max_stay_days': {
    text: 'Días máximos que una oportunidad puede permanecer en esta etapa sin avanzar.',
  },
} as const satisfies Readonly<Record<string, IFieldHelpEntry>>;

/**
 * Clave tipada de un campo del módulo de configuración. Se deriva del catálogo
 * para que el compilador valide cada uso contra una entrada existente.
 */
export type FieldHelpKey = keyof typeof FIELD_HELP;

/**
 * Resuelve el texto de ayuda de un campo desde el catálogo central.
 * @param key - Clave del campo (derivada del catálogo).
 * @returns El texto de ayuda listo para mostrar en un `<FieldHelp>`.
 */
export function fieldHelpText(key: FieldHelpKey): string {
  return FIELD_HELP[key].text;
}
