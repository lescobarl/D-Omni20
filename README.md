# 🚀 OmniBotIA Studio

Editor híbrido multi-tenant para creación de **landing pages conversionales de alta performance**.
Unifica tres herramientas en una sola interfaz: **IA generativa**, **canvas visual drag & drop** y **editor de código profesional (Monaco)**.

## Stack

| Capa       | Tecnología                                   |
|------------|----------------------------------------------|
| Frontend   | React 18 + TypeScript (estricto) + Vite 5    |
| Estilos    | Tailwind CSS 3 (utility-first, purge)        |
| Estado     | Zustand (persistencia selectiva)             |
| Testing    | Vitest + React Testing Library               |
| Backend    | FastAPI (Python 3.11+) — Fase 2              |
| Datos      | PostgreSQL + Redis — Fase 2                  |

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
npm run test       # Ejecuta tests (Vitest)
npm run build      # Compila en modo producción
```

## Reglas de Ingeniería

Este proyecto cumple estrictamente las reglas definidas en `CLAUDE.md` (raíz del workspace):
no hardcode, inyección de dependencias, JSDoc, UUIDv4, tupla de sincronización, logging de auditoría,
tests de inmutabilidad y cobertura > 80%.

## Fases

| Fase | Descripción                          | Estado       |
|------|--------------------------------------|--------------|
| 1    | Fundamentos de Ingeniería            | ✅ En curso  |
| 2    | Arquitectura Backend Adaptada        | ⏳ Pendiente |
| 3    | Frontend con Reglas Estrictas        | ⏳ Pendiente |
| 4    | Integración y Validación             | ⏳ Pendiente |
| 5    | Features Core (drag & drop, IA)      | ⏳ Pendiente |
