"""Verificadores de propiedad DNS de dominios personalizados (IDnsVerifier).

Regla CLAUDE: las dependencias externas se aíslan tras un puerto. La
implementación ``DnsVerifier`` importa ``dnspython`` de forma perezosa: si no
está instalado eleva :class:`DependencyError` (503) con contexto, nunca un
``ImportError`` sin control.

- :class:`AutoDnsVerifier`: auto-verifica (True) — dev/tests sin DNS real.
- :class:`DnsVerifier`: consulta TXT ``_omni2-verify.{host}`` vía dnspython.
"""

from __future__ import annotations

from app.core.errors import DependencyError
from app.services.interfaces import IDnsVerifier


class AutoDnsVerifier(IDnsVerifier):
    """Verificador automático para desarrollo y pruebas (siempre True).

    Sustituye la consulta DNS real en entornos donde no se quiere depender de
    dnspython ni de conectividad externa (``dns_verify_mode="auto"``).
    """

    def verify_txt(self, *, host: str, expected: str) -> bool:
        return True


class DnsVerifier(IDnsVerifier):
    """Verificador real vía dnspython (``dns_verify_mode="dns"``).

    Busca el registro TXT ``_omni2-verify.{host}`` (sin puerto) y compara el
    contenido decodificado con el token esperado. Si dnspython no está
    instalado eleva :class:`DependencyError` con contexto operacional.
    """

    def verify_txt(self, *, host: str, expected: str) -> bool:
        try:
            import dns.resolver
        except ImportError as exc:  # pragma: no cover - entorno sin dnspython
            raise DependencyError(
                "dnspython no está instalado: no se puede verificar el DNS real",
                operation="pseo_hosts.verify.dns",
                context={"host": host},
                cause=exc,
            ) from exc

        record_name = f"_omni2-verify.{host.split(':', 1)[0]}"
        try:
            answers = dns.resolver.resolve(record_name, "TXT")
        except dns.resolver.NXDOMAIN:
            return False
        except dns.resolver.NoAnswer:
            return False
        except dns.exception.DNSException:
            return False

        expected_decoded = expected.strip().lower()
        for answer in answers:
            chunk = "".join(
                part.decode("utf-8", errors="ignore") if isinstance(part, bytes) else str(part)
                for part in answer.strings
            )
            if chunk.strip().lower() == expected_decoded:
                return True
        return False
