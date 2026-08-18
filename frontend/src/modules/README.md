# Módulos Lazy Loaded

Los módulos de negocio pesados (IA, templates, workflows) se cargarán de forma
perezosa en fases posteriores mediante React Router v6 y `React.lazy`.

Convenciones:
- Un módulo por carpeta bajo `src/modules/[bloque]/[modulo]/`.
- Cada módulo expone su entrada en `index.ts`.
- No incluir lógica de negocio aquí: delegar en `src/core/` y `src/store/`.
