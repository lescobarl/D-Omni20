"""Adaptador del canal Messenger (Messenger Platform) para el bot (C-3).

Subclase mínima de :class:`MetaMessagingChannelAdapter`: la Messenger Platform
comparte el webhook ``entry[0].messaging[0]`` y la Send API ``me/messages`` con
Instagram; solo cambia el ``kind`` (regla CLAUDE: sin duplicación).
"""

from __future__ import annotations

from app.bot.channels.meta import MetaMessagingChannelAdapter


class MessengerChannelAdapter(MetaMessagingChannelAdapter):
    """Adaptador del canal Messenger (Messenger Platform)."""

    @property
    def kind(self) -> str:
        """Tipo de canal: ``messenger``."""
        return "messenger"
