"""OmniBotIA Studio - Backend API (Fase 2: Arquitectura Backend Adaptada).

Paquete raíz de la aplicación FastAPI. La composición de dependencias ocurre
únicamente en ``app.core.di`` y ``app.api.deps`` (composition root), nunca en
la lógica de negocio (regla CLAUDE: NO ``new`` en lógica de negocio).
"""

__version__ = "0.2.0"
