#!/usr/bin/env node
/**
 * Generador del reporte de métricas de calidad de OmniBotIA Studio (Fase 4.3).
 *
 * Contrato:
 * - Ejecuta la suite de cobertura del frontend (Vitest + v8) y parsea
 *   `coverage-summary.json` para obtener stmts/lines/branches/functions.
 * - Ejecuta los validadores CLAUDE (hardcode, trycatch, jsdoc, formato) y el
 *   build de producción, registrando el estado de cada uno.
 * - Si existe el entorno virtual del backend (`.venv`), ejecuta pytest y
 *   parsea la cobertura total desde la salida de texto.
 * - Genera `docs/metrics/report-<timestamp>.json`, `report-<timestamp>.md` y
 *   actualiza `docs/metrics/history.json` con la tendencia histórica.
 * - Los umbrales de cobertura son configurables por variables de entorno
 *   (`METRICS_MIN_COVERAGE`, valor por defecto 80) — sin hardcode.
 *
 * Uso:
 *   node scripts/generate-metrics-report.mjs
 *
 * Exit codes:
 *   0 - generación exitosa (aunque alguna métrica esté por debajo del umbral).
 *   1 - error de ejecución de la propia suite (no se pudo generar el reporte).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = resolve(SCRIPT_DIR, '..');
const REPO_ROOT = resolve(FRONTEND_DIR, '..');
const METRICS_DIR = join(REPO_ROOT, 'docs', 'metrics');
const HISTORY_FILE = join(METRICS_DIR, 'history.json');

/** Umbral mínimo de cobertura por tipo (configurable, default 80). */
function coverageThresholds() {
  const min = Number(process.env.METRICS_MIN_COVERAGE ?? 80);
  return { statements: min, lines: min, branches: min, functions: min };
}

/** Ejecuta un comando y captura salida/estado sin lanzar excepción. */
function run(cmd, args, cwd) {
  try {
    const stdout = execFileSync(cmd, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      // En Windows, los shims `.cmd` (p.ej. `npx.cmd`) requieren ejecutarse a
      // través del shell (cmd.exe); sin `shell: true` fallan con
      // `spawnSync ... EINVAL` y toda la suite reporta error.
      shell: process.platform === 'win32',
    });
    return { ok: true, stdout, stderr: '', status: 0 };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? String(error.message),
      status: error.status ?? 1,
    };
  }
}

/** Devuelve la ruta al binario de npx de la plataforma (compatible Windows). */
function npxCommand() {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

/** Devuelve la ruta al binario de npm de la plataforma (compatible Windows). */
function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

/**
 * Ejecuta la cobertura del frontend y devuelve el resumen por tipo.
 * @returns Resumen `{ statements, lines, branches, functions }` con `total/covered/pct`.
 */
function runFrontendCoverage() {
  const result = run(
    npxCommand(),
    ['vitest', 'run', '--coverage', '--coverage.reporter=json-summary', '--coverage.reporter=text'],
    FRONTEND_DIR,
  );
  if (!result.ok) {
    return {
      summary: null,
      failed: true,
      detail: result.stderr.slice(0, 2000),
    };
  }
  const summaryPath = join(FRONTEND_DIR, 'coverage', 'coverage-summary.json');
  if (!existsSync(summaryPath)) {
    return { summary: null, failed: true, detail: 'coverage-summary.json no generado' };
  }
  const raw = JSON.parse(readFileSync(summaryPath, 'utf8'));
  const total = raw.total;
  const pick = (key) => ({
    total: total[key].total,
    covered: total[key].covered,
    pct: total[key].pct,
  });
  return {
    summary: {
      statements: pick('statements'),
      lines: pick('lines'),
      branches: pick('branches'),
      functions: pick('functions'),
    },
    failed: false,
    detail: '',
  };
}

/** Ejecuta los 4 validadores CLAUDE y reporta el estado de cada uno. */
function runValidators() {
  const validators = [
    { id: 'hardcode', script: 'validate:hardcode', description: 'Sin valores hardcodeados' },
    { id: 'trycatch', script: 'validate:trycatch', description: 'Sin try-catch vacíos' },
    { id: 'jsdoc', script: 'validate:jsdoc', description: 'JSDoc completo en componentes' },
    { id: 'format', script: 'validate:format', description: 'Formato Prettier consistente' },
  ];
  return validators.map((validator) => {
    // `npx` no tiene un subcomando `run` (es `npm run`); usamos npm para scripts.
    const result = run(npmCommand(), ['run', validator.script], FRONTEND_DIR);
    return {
      id: validator.id,
      description: validator.description,
      ok: result.ok,
      detail: result.ok ? '' : result.stderr.slice(0, 500),
    };
  });
}

/** Ejecuta el build de producción del frontend. */
function runBuild() {
  // `npx` no tiene un subcomando `run` (es `npm run`); usamos npm para scripts.
  const result = run(npmCommand(), ['run', 'build'], FRONTEND_DIR);
  return { ok: result.ok, detail: result.ok ? '' : result.stderr.slice(0, 500) };
}

/**
 * Ejecuta pytest del backend si existe el entorno virtual.
 * @returns Métricas del backend o `null` si no hay entorno configurado.
 */
function runBackend() {
  const venvPython =
    process.platform === 'win32'
      ? join(REPO_ROOT, 'backend', '.venv', 'Scripts', 'python.exe')
      : join(REPO_ROOT, 'backend', '.venv', 'bin', 'python');
  if (!existsSync(venvPython)) {
    return null;
  }
  const result = run(
    venvPython,
    ['-m', 'pytest', '--cov=app', '--cov-report=term-missing'],
    join(REPO_ROOT, 'backend'),
  );
  // La línea TOTAL de `--cov-report=term-missing` tiene el formato:
  //   TOTAL  <stmts>  <miss>  <cover>%
  const totalMatch = result.stdout.match(/^TOTAL\s+\d+\s+\d+\s+(\d+)%/m);
  const pct = totalMatch ? Number(totalMatch[1]) : null;
  return { ok: result.ok, totalPct: pct, detail: result.ok ? '' : result.stderr.slice(0, 500) };
}

/** Calcula la puntuación global de cumplimiento (0-100). */
function computeScore(coverage, validators, build) {
  let score = 0;
  const thresholds = coverageThresholds();
  if (coverage && !coverage.failed) {
    const types = ['statements', 'lines', 'branches', 'functions'];
    const avg = types.reduce((sum, type) => sum + coverage.summary[type].pct, 0) / types.length;
    score += avg * 0.6; // 60% de peso: cobertura
  }
  const okValidators = validators.filter((validator) => validator.ok).length;
  score += (okValidators / validators.length) * 30; // 30% de peso: validadores CLAUDE
  if (build.ok) {
    score += 10; // 10% de peso: build de producción
  }
  return Math.round(score * 10) / 10;
}

/** Evalúa cada métrica contra su umbral y devuelve el estado `ok`. */
function evaluateThresholds(coverage, backend) {
  const thresholds = coverageThresholds();
  const result = {};
  if (coverage && !coverage.failed) {
    for (const type of ['statements', 'lines', 'branches', 'functions']) {
      result[`frontend_${type}`] = coverage.summary[type].pct >= thresholds[type];
    }
  }
  if (backend) {
    result.backend_total = backend.totalPct !== null && backend.totalPct >= thresholds.statements;
  }
  return result;
}

/** Devuelve la marca de tiempo actual en formato ISO UTC. */
function nowIso() {
  return new Date().toISOString();
}

/** Devuelve el timestamp compacto para nombrar archivos de reporte. */
function timestampCompact(iso) {
  return iso.replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

/** Escribe los artefactos del reporte (json, markdown, historial). */
function writeArtifacts(report, historyEntry) {
  mkdirSync(METRICS_DIR, { recursive: true });
  const stamp = timestampCompact(report.generated_at);
  writeFileSync(join(METRICS_DIR, `report-${stamp}.json`), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(METRICS_DIR, `report-${stamp}.md`), renderMarkdown(report));

  const history = existsSync(HISTORY_FILE)
    ? JSON.parse(readFileSync(HISTORY_FILE, 'utf8'))
    : { entries: [] };
  history.entries.push(historyEntry);
  history.entries = history.entries.slice(-60); // mantiene las últimas 60 entradas
  writeFileSync(HISTORY_FILE, `${JSON.stringify(history, null, 2)}\n`);
}

/** Renderiza el reporte en formato Markdown para auditoría visual. */
function renderMarkdown(report) {
  const line = (name, value, ok) => `| ${name} | ${value} | ${ok ? '✅' : '❌'} |`;
  const rows = [];
  if (report.frontend_coverage && !report.frontend_coverage.failed) {
    const c = report.frontend_coverage.summary;
    rows.push(
      line(
        'Frontend statements',
        `${c.statements.pct}%`,
        c.statements.pct >= report.thresholds.statements,
      ),
    );
    rows.push(line('Frontend lines', `${c.lines.pct}%`, c.lines.pct >= report.thresholds.lines));
    rows.push(
      line('Frontend branches', `${c.branches.pct}%`, c.branches.pct >= report.thresholds.branches),
    );
    rows.push(
      line(
        'Frontend functions',
        `${c.functions.pct}%`,
        c.functions.pct >= report.thresholds.functions,
      ),
    );
  } else {
    rows.push(line('Frontend coverage', 'ERROR', false));
  }
  if (report.backend) {
    rows.push(
      line(
        'Backend total',
        `${report.backend.totalPct}%`,
        report.backend.totalPct >= report.thresholds.statements,
      ),
    );
  }
  for (const validator of report.validators) {
    rows.push(line(`Validator: ${validator.id}`, validator.description, validator.ok));
  }
  rows.push(line('Build producción', 'tsc + vite', report.build.ok));

  return [
    '# 📊 Reporte de Métricas de Calidad — OmniBotIA Studio',
    '',
    `Generado: ${report.generated_at}`,
    '',
    `## Puntuación global de cumplimiento: **${report.compliance_score}/100**`,
    '',
    '## Métricas',
    '',
    '| Métrica | Detalle | Estado |',
    '|---------|---------|--------|',
    ...rows,
    '',
    `Umbral mínimo de cobertura: ${report.thresholds.statements}%`,
    '',
  ].join('\n');
}

/** Orquesta la generación completa del reporte. */
function main() {
  const coverage = runFrontendCoverage();
  const validators = runValidators();
  const build = runBuild();
  const backend = runBackend();

  const report = {
    generated_at: nowIso(),
    thresholds: coverageThresholds(),
    compliance_score: computeScore(coverage, validators, build),
    frontend_coverage: coverage,
    validators,
    build,
    backend,
  };

  const historyEntry = {
    generated_at: report.generated_at,
    compliance_score: report.compliance_score,
    frontend: coverage.failed
      ? null
      : Object.fromEntries(
          Object.entries(coverage.summary).map(([key, value]) => [key, value.pct]),
        ),
    backend_total: backend ? backend.totalPct : null,
    validators: Object.fromEntries(validators.map((validator) => [validator.id, validator.ok])),
    build_ok: build.ok,
    thresholds: evaluateThresholds(coverage, backend),
  };

  writeArtifacts(report, historyEntry);
  process.stdout.write(
    `Reporte generado: docs/metrics/report-${timestampCompact(report.generated_at)}.md\n`,
  );
  process.stdout.write(`Puntuación de cumplimiento: ${report.compliance_score}/100\n`);
}

main();
