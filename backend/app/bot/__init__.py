"""Subsistema acotado del bot OmniBotIA (Fase 3).

Solo ejecución: no posee configuración de tenant, catálogo, workflows ni
credenciales de canales; los resuelve desde la plataforma a través del
context bundle. Persiste únicamente datos de ejecución (``bot_conversations``
y ``bot_messages``) con RLS multi-tenant.
"""
