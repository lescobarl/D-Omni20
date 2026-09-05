"""Adaptador del canal Instagram (Instagram Messaging API) para el bot (C-3).

Subclase mínima de :class:`MetaMessagingChannelAdapter`: la Instagram Messaging
API comparte el webhook ``entry[0].messaging[0]`` y la Send API ``me/messages``
con Messenger; solo cambia el ``kind`` (regla CLAUDE: sin duplicación).
"""

from __future__ import annotations

from app.bot.channels.meta import MetaMessagingChannelAdapter


class InstagramChannelAdapter(MetaMessagingChannelAdapter):
    """Adaptador del canal Instagram (Instagram Messaging API)."""

    @property
    def kind(self) -> str:
        """Tipo de canal: ``instagram``."""
        return "instagram"
