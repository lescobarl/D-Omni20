# 🚀 OmniBotIA Studio

Editor híbrido multi-tenant para creación de **landing pages conversionales de alta performance**.
Unifica tres herramientas en una sola interfaz: **IA generativa**, **canvas visual drag & drop** y **editor de código profesional (Monaco)**.

## Stack

| Capa       | Tecnología                                   |
|------------|----------------------------------------------|
| Frontend   | React 18 + TypeScript (estricto) + Vite 5    |
| Estilos    | Tailwind CSS 3 (utility-first, purge)        |
| Estado     | Zustand (persistencia selectiva)             |
| Testing    | Vitest + React Testing Library + Playwright  |
| Backend    | FastAPI (Python 3.11+) — hexagonal + DI      |
| Datos      | SQLAlchemy 2.0 (SQLite dev / PostgreSQL prod)|
| IA         | DeepSeek (configuraciones + JSON Schemas)    |

## Estructura

```
omnibotia-studio/
├── .env.example          # Plantilla de variables de entorno
├── frontend/             # Proyecto Vite (React 18 + TS)
│   └── src/
│       ├── components/   # Componentes UI (Editor, Blocks, Workflows)
│       ├── core/         # Lógica de negocio pura (agnóstica de UI)
│       ├── hooks/        # Custom hooks
│       ├── lib/          # Config, logger, errores
│       ├── modules/      # Módulos lazy-loaded
│       ├── store/        # Zustand stores
│       ├── types/        # Tipos e interfaces
│       └── utils/        # Utilidades
└── backend/              # FastAPI (Fase 2)
```

## Requisitos

- Node.js >= 18 (recomendado 20+)
- npm >= 9

## Desarrollo

```bash
cd frontend
npm install
npm run dev        # Arranca Vite en http://localhost:5173
npm run test       # Iteración rápida: solo tests de lo cambiado (--changed)
npm run test:file <ruta>   # Solo el test de la tarea en curso
npm run test:full  # Suite completa (cierre de hito y gate de entrega pre-push)
npm run build      # Compila en modo producción
```

## Reglas de Ingeniería

Este proyecto cumple estrictamente las reglas definidas en `CLAUDE.md` (raíz del workspace):
no hardcode, inyección de dependencias, JSDoc, UUIDv4, tupla de sincronización, logging de auditoría,
tests de inmutabilidad y cobertura > 80%.

## Autenticación de Usuario + RBAC (Studio)

El estudio autentica a sus **usuarios** (email + contraseña) con **JWT HS256** (hash bcrypt) y aplica
**RBAC por tenant** con tres roles — `admin`, `configurador`, `operador` — más el **super-admin de plataforma**
(`is_super_admin`). Es independiente del OAuth de Google Calendar (clientes) y de la autenticación de portales públicos.

**Endpoints backend** (prefijo `/auth`): `POST /auth/login`, `POST /auth/logout` (stateless, `204`),
`GET /auth/me`, `GET /auth/me/memberships`, `POST /auth/change-password`. Gestión de plataforma:
`/users` (CRUD + membresías, super-admin) y `/members` (miembros del tenant activo, `admin`).
`/tenants` quedó protegido con `require_super_admin`.

**Frontend**: `LoginScreen` + `authStore` (Zustand) gestionan la sesión; `lib/rbac.ts` (`canAccessArea`,
política *fail-closed*) filtra la navegación por área (`editor`, `ads`, `operations`, `settings`, `hosts`,
`users`, `profile`). `TenantManager` solo se muestra a super-admin; el área "Usuarios" y la sección "Mi perfil"
completan la gestión de usuarios y roles.

## Estado del Proyecto

**Toda la hoja de ruta (Fases 1-10) está implementada y validada.**

Métricas reales medidas el 2026-09-06 (reporte canónico en `docs/metrics/`,
cumplimiento global **90.3/100**):

- **Backend**: 68 archivos de test · **1255 tests** · **93.25%** coverage
  (FastAPI hexagonal, DI, RLS, auditoría; umbral `pytest --cov-fail-under=80`).
- **Frontend**: 100 archivos de test / **1206 tests** · coverage
  **85.5 | 83.87 | 80.13 | 85.5** (statements | branches | functions | lines) ·
  `tsc --noEmit` limpio y validadores CLAUDE (hardcode, trycatch, jsdoc, formato) en verde.
- **E2E**: Playwright — Chromium + Firefox + WebKit · 9 specs / 28 casos. La suite del
  configurador (`tenantConfig`) validada 15/15 en vivo contra el backend real (2026-09-05).

## Fases

| Fase | Descripción                                    | Estado       |
|------|------------------------------------------------|--------------|
| 1    | Fundamentos de Ingeniería                      | ✅ Completa  |
| 2    | Arquitectura Backend Adaptada (hexagonal + DI) | ✅ Completa  |
| 3    | Frontend con Reglas Estrictas                  | ✅ Completa  |
| 4    | Integración y Validación                       | ✅ Completa  |
| 4-B  | Scheduler, CRM, tokens Google, emails Jinja2   | ✅ Completa  |
| 5    | Features Core (drag & drop, IA)                | ✅ Completa  |
| 6    | Editor Visual de JSON Schemas                  | ✅ Completa  |
| 7    | Versionado de Schemas                          | ✅ Completa  |
| 8    | Marketplace de Templates                       | ✅ Completa  |
| 9    | Analytics Avanzados                            | ✅ Completa  |
| 10   | CDN Deployment                                 | ✅ Completa  |
| RBAC | Autenticación de Usuario + RBAC (Studio)       | ✅ Completa  |
