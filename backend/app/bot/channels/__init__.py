"""Adaptadores de canales de mensajería del bot (Fase 5 — Portales multired).

Cada adaptador implementa :class:`~app.bot.interfaces.IChannelAdapter` y
desacopla el formato nativo del canal (WhatsApp Cloud API, SMS/Twilio,
Instagram, Messenger y Webchat) del núcleo de conversación. El router de
webhooks resuelve el canal -> tenant antes de invocar ``parse_inbound`` porque
el identificador real del canal no viaja en el payload del canal.
"""

from app.bot.channels.instagram import InstagramChannelAdapter
from app.bot.channels.messenger import MessengerChannelAdapter
from app.bot.channels.sms import SmsChannelAdapter
from app.bot.channels.webchat import WebchatChannelAdapter
from app.bot.channels.whatsapp import WhatsAppCloudChannelAdapter

__all__ = [
    "InstagramChannelAdapter",
    "MessengerChannelAdapter",
    "SmsChannelAdapter",
    "WebchatChannelAdapter",
    "WhatsAppCloudChannelAdapter",
]
