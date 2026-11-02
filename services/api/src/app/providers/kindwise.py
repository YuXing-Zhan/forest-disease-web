from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from kindwise import PlantApi


class PlantHealthClient(Protocol):
    def health_assessment(self, image: list[str], **kwargs: Any) -> dict: ...

    def usage_info(self, **kwargs: Any) -> dict: ...


@dataclass(frozen=True)
class KindwiseCandidate:
    candidate_id: str
    name: str
    probability: float
    details: dict[str, Any]


@dataclass(frozen=True)
class KindwiseDiagnosis:
    access_token: str
    model_version: str
    is_plant: bool
    plant_probability: float
    is_healthy: bool
    healthy_probability: float
    candidates: list[KindwiseCandidate]


class KindwiseProvider:
    def __init__(self, api_key: str, client: PlantHealthClient | None = None) -> None:
        if not api_key:
            raise ValueError("Kindwise API key 不能为空")
        self._client = client or PlantApi(api_key=api_key)

    def usage_info(self) -> dict:
        return self._client.usage_info(as_dict=True, timeout=20.0)

    def diagnose(self, image_paths: list[Path]) -> KindwiseDiagnosis:
        if not image_paths:
            raise ValueError("至少需要一张图片")

        response = self._client.health_assessment(
            [str(path) for path in image_paths[:4]],
            details=["local_name"],
            language="zh",
            # Kindwise 当前只接受 similar_images=true；发送 false 会被判为未知 modifier。
            similar_images=True,
            full_disease_list=False,
            max_image_size=1500,
            as_dict=True,
            timeout=60.0,
        )
        result = response.get("result") or {}
        is_plant = result.get("is_plant") or {}
        is_healthy = result.get("is_healthy") or {}
        disease = result.get("disease") or {}
        suggestions = disease.get("suggestions") or []

        candidates = [
            KindwiseCandidate(
                candidate_id=str(item.get("id") or f"kindwise-{index}"),
                name=_localized_name(item),
                probability=float(item.get("probability") or 0.0),
                details=item.get("details") or {},
            )
            for index, item in enumerate(suggestions[:5])
        ]

        return KindwiseDiagnosis(
            access_token=str(response.get("access_token") or ""),
            model_version=str(response.get("model_version") or "unknown"),
            is_plant=bool(is_plant.get("binary")),
            plant_probability=float(is_plant.get("probability") or 0.0),
            is_healthy=bool(is_healthy.get("binary")),
            healthy_probability=float(is_healthy.get("probability") or 0.0),
            candidates=candidates,
        )


def _localized_name(suggestion: dict[str, Any]) -> str:
    details = suggestion.get("details") or {}
    local_name = details.get("local_name")
    if isinstance(local_name, str) and local_name.strip():
        return local_name.strip()
    if isinstance(local_name, list) and local_name:
        return str(local_name[0])
    return str(suggestion.get("name") or "未知病害候选")
