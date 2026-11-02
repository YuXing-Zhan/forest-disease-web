from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

import httpx

from app.review_prompt import REVIEW_JSON_SCHEMA, REVIEW_SYSTEM_PROMPT
from app.schemas import ModelReview


class JsonHttpClient(Protocol):
    def post(self, url: str, **kwargs: Any) -> httpx.Response: ...


@dataclass(frozen=True)
class ReviewRequest:
    context: dict[str, Any]
    image_paths: list[Path]


def _data_url(path: Path) -> str:
    mime_types = {".png": "image/png", ".webp": "image/webp"}
    mime_type = mime_types.get(path.suffix.lower(), "image/jpeg")
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def _parse_review(provider: str, model: str, content: str) -> ModelReview:
    normalized = content.strip()
    if normalized.startswith("```"):
        first_line_end = normalized.find("\n")
        normalized = normalized[first_line_end + 1 :] if first_line_end >= 0 else normalized
        if normalized.endswith("```"):
            normalized = normalized[:-3].rstrip()
    first_brace = normalized.find("{")
    last_brace = normalized.rfind("}")
    if first_brace >= 0 and last_brace >= first_brace:
        normalized = normalized[first_brace : last_brace + 1]
    payload = json.loads(normalized)
    return ModelReview(provider=provider, model=model, status="completed", **payload)


def _openai_output_text(payload: dict[str, Any]) -> str:
    for item in payload.get("output") or []:
        if item.get("type") != "message":
            continue
        for content in item.get("content") or []:
            if content.get("type") == "output_text" and content.get("text"):
                return str(content["text"])
    raise ValueError("OpenAI 响应中没有 output_text")


class OpenAIReviewer:
    provider = "OpenAI"

    def __init__(
        self,
        api_key: str,
        model: str = "gpt-5.6-sol",
        timeout: float = 90.0,
        client: JsonHttpClient | None = None,
    ) -> None:
        self.model = model
        self._api_key = api_key
        self._timeout = timeout
        self._client = client or httpx.Client()

    def review(self, request: ReviewRequest) -> ModelReview:
        content: list[dict[str, Any]] = [
            {
                "type": "input_text",
                "text": json.dumps(request.context, ensure_ascii=False),
            }
        ]
        content.extend(
            {
                "type": "input_image",
                "image_url": _data_url(path),
                "detail": "high",
            }
            for path in request.image_paths[:4]
        )
        response = self._client.post(
            "https://api.openai.com/v1/responses",
            headers={"Authorization": f"Bearer {self._api_key}"},
            json={
                "model": self.model,
                "instructions": REVIEW_SYSTEM_PROMPT,
                "input": [{"role": "user", "content": content}],
                "reasoning": {"effort": "low"},
                "text": {
                    "format": {
                        "type": "json_schema",
                        "name": "forest_disease_review",
                        "strict": True,
                        "schema": REVIEW_JSON_SCHEMA,
                    }
                },
                "max_output_tokens": 1200,
                "store": False,
            },
            timeout=self._timeout,
        )
        response.raise_for_status()
        return _parse_review(self.provider, self.model, _openai_output_text(response.json()))


class DeepSeekReviewer:
    provider = "DeepSeek"

    def __init__(
        self,
        api_key: str,
        model: str = "deepseek-flash",
        timeout: float = 90.0,
        client: JsonHttpClient | None = None,
    ) -> None:
        self.model = model
        self._api_key = api_key
        self._timeout = timeout
        self._client = client or httpx.Client()

    def review(self, request: ReviewRequest) -> ModelReview:
        content: list[dict[str, Any]] = [
            {
                "type": "text",
                "text": json.dumps(request.context, ensure_ascii=False),
            }
        ]
        content.extend(
            {
                "type": "image_url",
                "image_url": {"url": _data_url(path), "detail": "high"},
            }
            for path in request.image_paths[:4]
        )
        response = self._client.post(
            "https://api.deepseek.com/chat/completions",
            headers={"Authorization": f"Bearer {self._api_key}"},
            json={
                "model": self.model,
                "messages": [
                    {"role": "system", "content": REVIEW_SYSTEM_PROMPT},
                    {"role": "user", "content": content},
                ],
                "response_format": {"type": "json_object"},
                "thinking": {"type": "disabled"},
                "temperature": 0.2,
                "max_tokens": 900,
            },
            timeout=self._timeout,
        )
        response.raise_for_status()
        payload = response.json()
        output = payload["choices"][0]["message"]["content"]
        return _parse_review(self.provider, self.model, output)
