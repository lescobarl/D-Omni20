#!/usr/bin/env node
/**
 * Corrector de documentación JSDoc (obligación CLAUDE 2).
 *
 * Recorre el AST con la misma lógica que `validate-jsdoc.mjs`, captura el
 * contexto del padre (interfaz) para generar descripciones en español
 * precisas y aplica docblocks de forma segura respecto a los saltos de línea:
 * cada archivo conserva su EOL original (CRLF en componentes, LF en
 * `types.ts`/`config.ts`).
 *
 * Los docblocks se insertan de abajo hacia arriba (por línea descendente)
 * para no desplazar los índices de inserciones pendientes. Las descripciones
 * se resuelven desde tablas curadas por `archivo#interfaz.propiedad`,
 * `archivo#funcion` y `archivo#declaración`; si falta alguna, el script
 * aborta señalando la clave exacta.
 *
 * Uso:
 *   node scripts/fix-jsdoc.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';
import { collectSourceFiles, FRONTEND_ROOT } from './lib/scanner.mjs';
import { validateFile } from './validate-jsdoc.mjs';

/**
 * ¿El archivo debe excluirse del análisis (tests/fixtures)?
 * @param {string} file - Ruta absoluta del archivo.
 * @returns {boolean} `true` si es un archivo de prueba o fixture.
 */
function isFixture(file) {
  const base = path.basename(file);
  return /\.(?:test|spec)\.(?:ts|tsx)$/.test(base) || file.includes(`${path.sep}test${path.sep}`);
}

/** ¿El nodo es una declaración de nivel superior que exige JSDoc? */
function requiresJsdoc(node) {
  switch (node.kind) {
    case ts.SyntaxKind.FunctionDeclaration:
    case ts.SyntaxKind.ClassDeclaration:
    case ts.SyntaxKind.InterfaceDeclaration:
    case ts.SyntaxKind.TypeAliasDeclaration:
    case ts.SyntaxKind.EnumDeclaration:
    case ts.SyntaxKind.VariableStatement:
      return true;
    default:
      return false;
  }
}

/** ¿El nodo es un miembro de clase que exige JSDoc? (constructores excluidos). */
function isClassMember(node) {
  switch (node.kind) {
    case ts.SyntaxKind.MethodDeclaration:
    case ts.SyntaxKind.PropertyDeclaration:
    case ts.SyntaxKind.GetAccessor:
    case ts.SyntaxKind.SetAccessor:
      return true;
    default:
      return false;
  }
}

/** ¿El nodo es un miembro de interfaz que exige JSDoc? */
function isInterfaceMember(node) {
  switch (node.kind) {
    case ts.SyntaxKind.MethodSignature:
    case ts.SyntaxKind.PropertySignature:
    case ts.SyntaxKind.GetAccessor:
    case ts.SyntaxKind.SetAccessor:
      return true;
    default:
      return false;
  }
}

/** ¿La declaración está exportada (`export` o `export default`)? */
function isExported(node) {
  const flags = ts.getCombinedModifierFlags(node);
  return (flags & ts.ModifierFlags.Export) !== 0 || (flags & ts.ModifierFlags.Default) !== 0;
}

/** ¿El nodo tiene JSDoc asociado por el compilador? */
function hasJsdoc(node) {
  return ts.getJSDocCommentsAndTags(node).length > 0;
}

/** Nombre legible de un nodo. */
function nameOf(node) {
  const name = node.name;
  return name ? name.getText() : '(anónimo)';
}

/**
 * Recorre el AST acumulando las declaraciones sin JSDoc, con el nombre de la
 * interfaz/clase padre para resolver descripciones contextuales.
 * @param {ts.Node} node - Nodo actual.
 * @param {ts.SourceFile} sourceFile - Archivo fuente.
 * @param {Array<{ line: number; nodeKind: number; name: string; parentName: string | undefined }>} findings
 * @returns {void}
 */
function walk(node, sourceFile, findings) {
  const parentKind = node.parent ? node.parent.kind : undefined;
  const parentName = node.parent && node.parent.name ? node.parent.name.getText() : undefined;
  const isInsideClass =
    parentKind === ts.SyntaxKind.ClassDeclaration || parentKind === ts.SyntaxKind.ClassExpression;
  const isInsideInterface = parentKind === ts.SyntaxKind.InterfaceDeclaration;

  let needsJsdoc = false;
  if (requiresJsdoc(node) && isExported(node)) {
    needsJsdoc = true;
  } else if (isInsideClass && isClassMember(node)) {
    needsJsdoc = true;
  } else if (isInsideInterface && isInterfaceMember(node)) {
    needsJsdoc = true;
  }

  if (needsJsdoc && !hasJsdoc(node)) {
    const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    findings.push({
      line: pos.line + 1,
      nodeKind: node.kind,
      name: nameOf(node),
      parentName,
    });
  }

  ts.forEachChild(node, (child) => walk(child, sourceFile, findings));
}

// ── Tablas curadas de descripciones (español) ────────────────────────────────

/** Descripciones de miembros de interfaz por `archivo#interfaz.propiedad`. */
const MEMBER = {};

/** Descripciones de funciones exportadas por `archivo#función` (texto multilínea). */
const FUNC = {};

/** Descripciones de declaraciones de nivel superior por `archivo#declaración`. */
const TOP = {};

// types.ts — sección CRM (LF).
MEMBER['src/api/types.ts'] = {
  IStageUpdate: {
    name: 'Nombre de la etapa (1-64 caracteres).',
    order: 'Orden de presentación (>= 0).',
    default_probability: 'Probabilidad por defecto 0-100.',
    is_terminal: 'Indica si la etapa cierra la oportunidad.',
    outcome: 'Resultado estructural del cierre; exigido si `is_terminal` es `true`.',
  },
  IStageRead: {
    id: 'Identificador único de la etapa.',
    tenant_id: 'Identificador del tenant al que pertenece.',
    name: 'Nombre de la etapa (1-64 caracteres).',
    order: 'Orden de presentación (>= 0).',
    default_probability: 'Probabilidad por defecto 0-100.',
    is_terminal: 'Indica si la etapa cierra la oportunidad.',
    outcome: 'Resultado estructural del cierre (`won` | `lost`) o `null`.',
    created_at: 'Fecha de creación (ISO 8601).',
    revision: 'Revisión optimista (concurrency control).',
    updated_at: 'Fecha de última actualización (ISO 8601).',
  },
  IDealUpdate: {
    title: 'Título de la oportunidad (1-255 caracteres).',
    stage_id: 'Etapa actual de la oportunidad.',
    amount_minor: 'Importe en unidades menores (>= 0).',
    currency: 'Moneda (por defecto `USD`).',
    probability: 'Probabilidad 0-100.',
    owner_id: 'Vendedor responsable (opcional).',
    contact_id: 'Contacto vinculado (opcional).',
    lead_id: 'Lead de origen (opcional).',
    quote_id: 'Cotización vinculada (opcional).',
    payment_id: 'Pago vinculado (opcional).',
    expected_close_at: 'Fecha esperada de cierre (ISO 8601 `YYYY-MM-DD`, opcional).',
    metadata: 'Metadatos libres (por defecto `{}`).',
  },
  IDealRead: {
    id: 'Identificador único de la oportunidad.',
    tenant_id: 'Identificador del tenant al que pertenece.',
    title: 'Título de la oportunidad (1-255 caracteres).',
    stage_id: 'Etapa actual de la oportunidad.',
    amount_minor: 'Importe en unidades menores (>= 0).',
    currency: 'Moneda del importe (`USD` | `MXN`).',
    probability: 'Probabilidad 0-100.',
    status: 'Estado del pipeline (`open` | `won` | `lost`).',
    owner_id: 'Vendedor responsable o `null`.',
    contact_id: 'Contacto vinculado o `null`.',
    lead_id: 'Lead de origen o `null`.',
    quote_id: 'Cotización vinculada o `null`.',
    payment_id: 'Pago vinculado o `null`.',
    expected_close_at: 'Fecha esperada de cierre (ISO 8601 `YYYY-MM-DD`) o `null`.',
    metadata: 'Metadatos libres.',
    closed_at: 'Fecha de cierre (ISO 8601) o `null`.',
    won_at: 'Fecha de ganada (ISO 8601) o `null`.',
    lost_at: 'Fecha de perdida (ISO 8601) o `null`.',
    lost_reason: 'Razón de cierre perdido o `null`.',
    created_at: 'Fecha de creación (ISO 8601).',
    revision: 'Revisión optimista (concurrency control).',
    updated_at: 'Fecha de última actualización (ISO 8601).',
  },
  ICrmDealsQuery: {
    page: 'Página solicitada (1-based).',
    page_size: 'Tamaño de página (por defecto 20).',
    stage_id: 'Filtro por etapa.',
    owner_id: 'Filtro por vendedor responsable.',
    status: 'Filtro por estado del pipeline.',
  },
  IStageChangeRead: {
    id: 'Identificador único del movimiento.',
    tenant_id: 'Identificador del tenant al que pertenece.',
    deal_id: 'Oportunidad afectada (obligatoria).',
    from_stage_id: 'Etapa de origen o `null` (creación).',
    to_stage_id: 'Etapa de destino o `null`.',
    changed_by: 'Actor que registró el movimiento (`bot` | `vendedor` | `sistema`).',
    note: 'Nota del movimiento o `null`.',
    created_at: 'Fecha de creación (ISO 8601).',
    revision: 'Revisión optimista (concurrency control).',
    updated_at: 'Fecha de última actualización (ISO 8601).',
  },
  ITaskUpdate: {
    deal_id: 'Oportunidad vinculada (opcional).',
    contact_id: 'Contacto vinculado (opcional).',
    title: 'Título de la tarea (1-255 caracteres).',
    due_at: 'Fecha límite (ISO 8601, opcional).',
    status: 'Estado (por defecto `pending`).',
    priority: 'Prioridad (por defecto `medium`).',
    assignee_id: 'Responsable (opcional).',
  },
  ITaskRead: {
    id: 'Identificador único de la tarea.',
    tenant_id: 'Identificador del tenant al que pertenece.',
    deal_id: 'Oportunidad vinculada o `null`.',
    contact_id: 'Contacto vinculado o `null`.',
    title: 'Título de la tarea (1-255 caracteres).',
    due_at: 'Fecha límite (ISO 8601) o `null`.',
    status: 'Estado de la tarea.',
    priority: 'Prioridad de la tarea.',
    assignee_id: 'Responsable o `null`.',
    completed_at: 'Fecha de completado (ISO 8601) o `null`.',
    created_at: 'Fecha de creación (ISO 8601).',
    revision: 'Revisión optimista (concurrency control).',
    updated_at: 'Fecha de última actualización (ISO 8601).',
  },
  ICrmTasksQuery: {
    page: 'Página solicitada (1-based).',
    page_size: 'Tamaño de página (por defecto 20).',
    deal_id: 'Filtro por oportunidad vinculada.',
  },
  ISlaUpsert: {
    stage_id: 'Etapa a la que aplica la política (obligatoria).',
  },
  ISlaRead: {
    id: 'Identificador único de la política.',
    tenant_id: 'Identificador del tenant al que pertenece.',
    stage_id: 'Etapa a la que aplica la política.',
    max_response_hours: 'Horas máximas para responder (>= 0).',
    max_stay_days: 'Días máximos de permanencia en la etapa (>= 0).',
    created_at: 'Fecha de creación (ISO 8601).',
    revision: 'Revisión optimista (concurrency control).',
    updated_at: 'Fecha de última actualización (ISO 8601).',
  },
  IFunnelStageRead: {
    stage_id: 'Etapa del embudo.',
    stage_name: 'Nombre de la etapa.',
    count: 'Número de oportunidades en la etapa.',
    total_amount_minor: 'Importe total en unidades menores.',
    weighted_value_minor: 'Valor ponderado por probabilidad (unidades menores).',
    conversion_rate: 'Tasa de conversión 0-1 o `null`.',
    avg_cycle_days: 'Días promedio de permanencia o `null`.',
  },
  IFunnelRead: {
    stages: 'Agregación por etapa del embudo.',
    total_deals: 'Total de oportunidades.',
    won_count: 'Oportunidades ganadas.',
    lost_count: 'Oportunidades perdidas.',
    open_count: 'Oportunidades abiertas.',
    won_amount_minor: 'Importe ganado en unidades menores.',
    close_rate: 'Tasa de cierre 0-1.',
    avg_cycle_days: 'Días promedio del ciclo completo o `null`.',
  },
  ICrmSummaryRead: {
    deals: 'Oportunidades del cliente (filtradas por email).',
    tasks: 'Tareas del cliente (filtradas por email).',
    total_deals: 'Total de oportunidades del cliente.',
    open_deals: 'Oportunidades abiertas del cliente.',
    won_deals: 'Oportunidades ganadas del cliente.',
  },
};

// AdsSection.tsx (CRLF).
MEMBER['src/components/Ads/AdsSection.tsx'] = {
  IAdCampaignFormState: {
    name: 'Nombre de la campaña (obligatorio).',
    status: 'Estado de la campaña.',
    enabled: 'Indica si la campaña está habilitada.',
    utmSource: 'Parámetro UTM `utm_source`.',
    utmMedium: 'Parámetro UTM `utm_medium`.',
    utmCampaign: 'Parámetro UTM `utm_campaign`.',
    utmContent: 'Parámetro UTM `utm_content`.',
    utmTerm: 'Parámetro UTM `utm_term`.',
    landingId: 'Landing de destino (opcional).',
    budgetMinor: 'Presupuesto en unidades menores.',
    startAt: 'Fecha de inicio (ISO 8601, opcional).',
    endAt: 'Fecha de fin (ISO 8601, opcional).',
    notes: 'Notas internas (opcional).',
  },
};

// Crm/ (CRLF).
MEMBER['src/components/Crm/DealCard.tsx'] = {
  IDealCardProps: {
    deal: 'Oportunidad a mostrar.',
    onOpen: 'Callback al abrir el detalle de la oportunidad.',
  },
};

MEMBER['src/components/Crm/DealDrawer.tsx'] = {
  IDealDrawerProps: {
    dealId: 'Identificador de la oportunidad a mostrar.',
    onClose: 'Callback al cerrar el panel.',
  },
  ITaskFormState: {
    title: 'Título de la tarea.',
    dueAt: 'Fecha límite de la tarea.',
    priority: 'Prioridad de la tarea (`low` | `medium` | `high`).',
  },
};

MEMBER['src/components/Crm/PipelineBoard.tsx'] = {
  IPipelineBoardProps: {
    stages: 'Etapas del pipeline (ordenadas).',
    deals: 'Oportunidades a agrupar por etapa.',
    onOpenDeal: 'Callback al abrir una oportunidad (recibe su id).',
  },
  IStageColumn: {
    stage: 'Etapa de la columna.',
    stageDeals: 'Oportunidades de la columna (ordenadas por creación).',
  },
};

MEMBER['src/components/Crm/SlaSettings.tsx'] = {
  ISlaDraft: {
    maxResponseHours: 'Horas máximas para responder (borrador local).',
    maxStayDays: 'Días máximos de permanencia en la etapa (borrador local).',
  },
};

MEMBER['src/components/Crm/TasksSection.tsx'] = {
  ITaskFormState: {
    title: 'Título de la tarea.',
    dueAt: 'Fecha límite de la tarea.',
    priority: 'Prioridad de la tarea (`low` | `medium` | `high`).',
    assigneeId: 'Responsable de la tarea.',
  },
};

TOP['src/components/Crm/crmFormat.ts'] = {
  ISlaBadge: 'Insignia de SLA de una oportunidad (etiqueta + clases de color para `Badge`).',
};
MEMBER['src/components/Crm/crmFormat.ts'] = {
  ISlaBadge: {
    label: 'Etiqueta legible de la insignia.',
    className: 'Clases de color aplicadas a la insignia.',
  },
};

// ui/ (CRLF).
TOP['src/components/ui/Badge.tsx'] = {
  IBadgeProps: 'Propiedades de la insignia compartida `ui/` (plan §4.2-D).',
};
MEMBER['src/components/ui/Badge.tsx'] = {
  IBadgeProps: {
    tone: 'Tono de la insignia; si no se define NO se aplican clases de color.',
    mono: 'Tipografía monoespaciada (por defecto `false`).',
    className: 'Clases adicionales para el contenedor.',
    children: 'Contenido de la insignia.',
  },
};
FUNC['src/components/ui/Badge.tsx'] = {
  Badge: [
    'Renderiza una insignia con el tono y estilo indicados.',
    '',
    'Cuando `tone` no está definido NO se aplican clases de color, permitiendo',
    'inyectar estilos externos vía `className`.',
  ],
};

TOP['src/components/ui/Button.tsx'] = {
  IButtonProps: 'Propiedades del botón compartido `ui/` (plan §4.2-F).',
};
MEMBER['src/components/ui/Button.tsx'] = {
  IButtonProps: {
    variant: 'Variante visual (por defecto `primary`).',
    size: 'Tamaño (por defecto `md`).',
    loading: 'Muestra «Cargando…» y deshabilita el control.',
    children: 'Contenido del botón.',
  },
};
FUNC['src/components/ui/Button.tsx'] = {
  Button: [
    'Renderiza un botón accesible con variante, tamaño y estado de carga.',
    '',
    'La variante `tab` solo aporta el anillo de foco; el estilo visual se',
    'inyecta vía `className`.',
  ],
};

MEMBER['src/components/ui/EmptyState.tsx'] = {
  IEmptyStateProps: {
    icon: 'Icono decorativo opcional (`aria-hidden`).',
    title: 'Texto principal (leído por `role="status"`).',
    description: 'Descripción secundaria (opcional).',
    actionLabel: 'Texto del CTA (opcional; requiere `onAction`).',
    onAction: 'Callback del CTA (opcional).',
  },
};
FUNC['src/components/ui/EmptyState.tsx'] = {
  EmptyState: [
    'Renderiza el estado vacío con icono decorativo, texto `role="status"` y CTA opcional.',
  ],
};

MEMBER['src/components/ui/ErrorState.tsx'] = {
  IErrorStateProps: {
    message: 'Mensaje principal del error.',
    detail: 'Detalle técnico colapsable (opcional).',
    onRetry: 'Callback del botón de reintento (opcional).',
    retryLabel: 'Texto del botón de reintento (por defecto «Reintentar»).',
  },
};
FUNC['src/components/ui/ErrorState.tsx'] = {
  ErrorState: ['Renderiza el estado de error con botón «Reintentar» y detalle técnico colapsable.'],
};

MEMBER['src/components/ui/Input.tsx'] = {
  IInputProps: {
    label: 'Etiqueta accesible del campo (`htmlFor`/`id`).',
    hint: 'Ayuda accesible vía `aria-describedby` (opcional).',
    error: 'Mensaje de error: añade `aria-invalid` y `aria-describedby`.',
  },
};
FUNC['src/components/ui/Input.tsx'] = {
  Input: ['Renderiza un campo de texto con etiqueta accesible, ayuda y error (plan §4.2-C).'],
};

MEMBER['src/components/ui/Modal.tsx'] = {
  IModalProps: {
    open: 'Controla la visibilidad; `false` devuelve `null`.',
    onClose: 'Callback al cerrar (Escape o botón de cierre).',
    title: 'Título del diálogo (`aria-labelledby`).',
    children: 'Contenido del diálogo.',
    closeLabel: 'Texto del botón de cierre (por defecto «Cerrar»).',
  },
};
FUNC['src/components/ui/Modal.tsx'] = {
  Modal: [
    'Renderiza un diálogo modal accesible: foco atrapado, cierre por `Escape` y',
    'restauración del foco previo.',
  ],
};

TOP['src/components/ui/Toast.tsx'] = {
  IToastItem: 'Item individual de la región de notificaciones toast.',
  IToastProps: 'Propiedades de la región de notificaciones toast.',
};
MEMBER['src/components/ui/Toast.tsx'] = {
  IToastItem: {
    id: 'Identificador único del item (key de React).',
    tone: 'Tono del indicador de color.',
    message: 'Mensaje de la notificación.',
  },
  IToastProps: {
    items: 'Items a mostrar; con lista vacía se devuelve `null`.',
  },
};
FUNC['src/components/ui/Toast.tsx'] = {
  Toast: ['Renderiza la región de notificaciones toast (`role="status"` + `aria-live="polite"`).'],
};

// DominiosSection.tsx (CRLF).
FUNC['src/components/Dominios/DominiosSection.tsx'] = {
  DominiosSection: [
    'Sección de dominios personalizados del tenant (PSEO hosts).',
    '',
    'Registra un dominio propio, verifica su propiedad por DNS (TXT',
    '`_omni2-verify.{host}`) y lo activa para el serving público. Consume el',
    'store `useHostsStore` (servicio `IPseoHostService` inyectado cuando la',
    'feature flag `hosts` está habilitada).',
  ],
};

// AdsSection.tsx — docblock de función.
FUNC['src/components/Ads/AdsSection.tsx'] = {
  AdsSection: [
    'Sección de campañas publicitarias del tenant con atribución UTM.',
    '',
    'Lista, crea, edita y elimina campañas consumiendo el store `useAdsStore`',
    '(servicio `IAdsService` inyectado cuando la feature flag `ads` está activa).',
  ],
};

/** Genera un bloque JSDoc multilínea a partir de las líneas de texto. */
function toMultiline(lines, indent) {
  const out = [`${indent}/**`];
  for (const line of lines) {
    out.push(`${indent} *${line ? ` ${line}` : ''}`);
  }
  out.push(`${indent} */`);
  return out;
}

/**
 * Construye el bloque JSDoc de una declaración sin documentar.
 * @param {{ line: number; nodeKind: number; name: string; parentName: string | undefined; indent: string }} f
 * @param {string} rel - Ruta relativa del archivo.
 * @returns {string[]} Líneas del docblock (sin EOL).
 */
function buildDocblock(f, rel) {
  const { nodeKind, name, parentName, indent } = f;

  if (
    nodeKind === ts.SyntaxKind.PropertySignature ||
    nodeKind === ts.SyntaxKind.MethodSignature ||
    nodeKind === ts.SyntaxKind.GetAccessor ||
    nodeKind === ts.SyntaxKind.SetAccessor
  ) {
    const desc = MEMBER[rel]?.[parentName]?.[name];
    if (desc === undefined) {
      throw new Error(`Falta descripción de miembro: ${rel}#${parentName}.${name}`);
    }
    return [`${indent}/** ${desc} */`];
  }

  if (nodeKind === ts.SyntaxKind.FunctionDeclaration) {
    const text = FUNC[rel]?.[name];
    if (!text) {
      throw new Error(`Falta descripción de función: ${rel}#func:${name}`);
    }
    return toMultiline(text, indent);
  }

  if (
    nodeKind === ts.SyntaxKind.InterfaceDeclaration ||
    nodeKind === ts.SyntaxKind.TypeAliasDeclaration ||
    nodeKind === ts.SyntaxKind.EnumDeclaration ||
    nodeKind === ts.SyntaxKind.ClassDeclaration ||
    nodeKind === ts.SyntaxKind.VariableStatement
  ) {
    const desc = TOP[rel]?.[name];
    if (desc === undefined) {
      throw new Error(`Falta descripción de declaración: ${rel}#${name}`);
    }
    return [`${indent}/** ${desc} */`];
  }

  throw new Error(`Tipo de nodo sin soporte: ${ts.SyntaxKind[nodeKind]} en ${rel}`);
}

/**
 * Corrige un archivo: detecta EOL, inserta docblocks de abajo hacia arriba y
 * conserva los saltos de línea originales.
 * @param {string} filePath - Ruta absoluta del archivo.
 * @returns {number} Cantidad de docblocks insertados.
 */
function fixFile(filePath) {
  // Normaliza a separadores `/` para que las claves de MEMBER/FUNC/TOP
  // coincidan en cualquier sistema operativo (path.relative usa `\` en Windows).
  const rel = path.relative(FRONTEND_ROOT, filePath).split(path.sep).join('/');
  const code = fs.readFileSync(filePath, 'utf8');
  const eol = code.includes('\r\n') ? '\r\n' : '\n';
  const scriptKind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, true, scriptKind);

  const findings = [];
  walk(sourceFile, sourceFile, findings);
  if (findings.length === 0) {
    return 0;
  }

  const lines = code.split(/\r?\n/);
  const insertions = findings.map((f) => {
    const lineText = lines[f.line - 1] ?? '';
    const indent = lineText.match(/^\s*/)?.[0] ?? '';
    return { line: f.line, block: buildDocblock({ ...f, indent }, rel) };
  });

  insertions.sort((a, b) => b.line - a.line);
  for (const ins of insertions) {
    lines.splice(ins.line - 1, 0, ...ins.block);
  }

  const out = lines.join(eol);
  if (out !== code) {
    fs.writeFileSync(filePath, out, 'utf8');
  }

  // Verificación inmediata: el archivo corregido debe quedar sin hallazgos.
  const remaining = validateFile(filePath, out);
  if (remaining.length > 0) {
    const first = remaining[0];
    throw new Error(
      `Tras corregir ${rel} aún falta JSDoc en ${ts.SyntaxKind[first.nodeKind] ?? first.kind} \`${first.name}\` (línea ${first.line}).`,
    );
  }

  return findings.length;
}

/** Punto de entrada de la CLI. */
function main() {
  const files = collectSourceFiles([]).filter((file) => !isFixture(file));
  let totalFixed = 0;
  const touched = [];

  for (const file of files) {
    const fixed = fixFile(file);
    if (fixed > 0) {
      totalFixed += fixed;
      touched.push(`${path.relative(FRONTEND_ROOT, file)}: ${fixed} docblock(s)`);
    }
  }

  if (touched.length > 0) {
    console.log('📝 JSDoc corregido:');
    for (const line of touched) {
      console.log(`  - ${line}`);
    }
  }
  console.log(
    `\n✅ fix-jsdoc — ${totalFixed} docblock(s) insertados en ${touched.length} archivo(s) de producto.`,
  );
}

main();
