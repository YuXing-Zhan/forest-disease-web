from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from app.config import Settings, get_settings
from app.schemas import ProviderAccessInput


@dataclass(frozen=True)
class RuntimeCredentials:
    kindwise_api_key: str = ""
    deepseek_api_key: str = ""
    source: str = "user"

    @property
    def configured_providers(self) -> list[str]:
        providers: list[str] = []
        if self.kindwise_api_key:
            providers.append("kindwise")
        if self.deepseek_api_key:
            providers.append("deepseek")
        return providers


def _secret_value(value) -> str:
    return value.get_secret_value().strip() if value is not None else ""


def _normalize_answer(answer: str) -> str:
    return "".join(answer.split()).casefold()


def _answer_hash(answer: str) -> str:
    return hashlib.sha256(_normalize_answer(answer).encode("utf-8")).hexdigest()


def answer_is_valid(answer: str, settings: Settings | None = None) -> bool:
    active = settings or get_settings()
    candidate = _answer_hash(answer)
    allowed = {
        item.strip().casefold()
        for item in active.developer_access_answer_hashes.split(",")
        if item.strip()
    }
    return any(hmac.compare_digest(candidate, expected) for expected in allowed)


def _developer_keys(settings: Settings) -> RuntimeCredentials:
    return RuntimeCredentials(
        kindwise_api_key=_secret_value(settings.kindwise_api_key),
        deepseek_api_key=_secret_value(settings.deepseek_api_key),
        source="developer",
    )


def developer_access_available(settings: Settings | None = None) -> bool:
    return bool(_developer_keys(settings or get_settings()).configured_providers)


def _signing_secret(settings: Settings) -> bytes:
    configured = _secret_value(settings.developer_access_secret)
    if configured:
        return configured.encode("utf-8")
    keys = _developer_keys(settings)
    material = f"{keys.kindwise_api_key}\0{keys.deepseek_api_key}\0forest-disease-access"
    if not keys.configured_providers:
        raise ValueError("开发者 API 尚未配置")
    return hashlib.sha256(material.encode("utf-8")).digest()


def _encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _decode(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def issue_developer_token(settings: Settings | None = None) -> tuple[str, datetime]:
    active = settings or get_settings()
    if not developer_access_available(active):
        raise ValueError("开发者 API 尚未配置")
    expires_at = datetime.now(UTC) + timedelta(hours=active.developer_access_token_hours)
    payload = {
        "purpose": "developer-api-access",
        "exp": int(expires_at.timestamp()),
        "nonce": secrets.token_hex(8),
    }
    encoded = _encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(_signing_secret(active), encoded.encode("ascii"), hashlib.sha256).digest()
    return f"{encoded}.{_encode(signature)}", expires_at


def developer_token_is_valid(token: str, settings: Settings | None = None) -> bool:
    if not token:
        return False
    active = settings or get_settings()
    try:
        encoded, provided_signature = token.split(".", 1)
        expected = hmac.new(
            _signing_secret(active), encoded.encode("ascii"), hashlib.sha256
        ).digest()
        if not hmac.compare_digest(_decode(provided_signature), expected):
            return False
        payload = json.loads(_decode(encoded))
        return (
            payload.get("purpose") == "developer-api-access"
            and int(payload.get("exp", 0)) > int(datetime.now(UTC).timestamp())
        )
    except (ValueError, TypeError, json.JSONDecodeError):
        return False


def resolve_runtime_credentials(
    access: ProviderAccessInput,
    settings: Settings | None = None,
) -> RuntimeCredentials:
    active = settings or get_settings()
    own_kindwise = _secret_value(access.kindwise_api_key)
    own_deepseek = _secret_value(access.deepseek_api_key)
    token = _secret_value(access.developer_access_token)

    developer = (
        _developer_keys(active)
        if token and developer_token_is_valid(token, active)
        else RuntimeCredentials()
    )
    return RuntimeCredentials(
        kindwise_api_key=own_kindwise or developer.kindwise_api_key,
        deepseek_api_key=own_deepseek or developer.deepseek_api_key,
        source="user" if own_kindwise or own_deepseek else developer.source,
    )
