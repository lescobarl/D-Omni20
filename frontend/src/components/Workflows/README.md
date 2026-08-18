# Workflows

Componentes de configuración de workflows de conversión de la landing.

Contrato:
- Un componente por archivo con JSDoc del contrato.
- Delegar el estado en `src/store/` y la lógica pura en `src/core/`.
- Los workflows soportados: `direct_checkout`, `lead_capture`, `quote_generator`, `appointment_scheduler`.
