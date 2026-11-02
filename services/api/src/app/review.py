from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from functools import lru_cache
from pathlib import Path
from typing import Protocol

from app.config import Settings, get_settings
from app.providers.llm_review import (
    DeepSeekReviewer,
    OpenAIReviewer,
    ReviewRequest,
)
from app.schemas import CaseResponse, DiagnosisResult, LlmReview, ModelReview

logger = logging.getLogger(__name__)


class Reviewer(Protocol):
    provider: str
    model: str

    def review(self, request: ReviewRequest) -> ModelReview: ...


def _secret_value(secret) -> str:
    return secret.get_secret_value().strip() if secret is not None else ""


def _configured_reviewers(
    settings: Settings,
    deepseek_api_key: str | None = None,
) -> list[Reviewer]:
    reviewers: list[Reviewer] = []
    enabled = {
        provider.strip().casefold()
        for provider in settings.llm_review_providers.split(",")
        if provider.strip()
    }
    openai_key = _secret_value(settings.openai_api_key)
    if "openai" in enabled and openai_key:
        reviewers.append(
            OpenAIReviewer(
                openai_key,
                settings.openai_review_model,
                settings.llm_review_timeout_seconds,
            )
        )
    deepseek_key = (
        deepseek_api_key.strip()
        if deepseek_api_key is not None
        else _secret_value(settings.deepseek_api_key)
    )
    if "deepseek" in enabled and deepseek_key:
        reviewers.append(
            DeepSeekReviewer(
                deepseek_key,
                settings.deepseek_review_model,
                settings.llm_review_timeout_seconds,
            )
        )
    return reviewers


@lru_cache(maxsize=1)
def _default_reviewers() -> tuple[Reviewer, ...]:
    """复用 HTTP 连接，避免每个病例重复进行 TLS 握手。"""
    return tuple(_configured_reviewers(get_settings()))


def _review_context(case: CaseResponse, result: DiagnosisResult) -> dict:
    return {
        "task": "复核林木叶片病害初筛结果",
        "user_information": {
            "species": case.species_input or "未提供",
            "location": case.location_text or "未提供",
            "notes": case.notes or "未提供",
        },
        "information_completeness": result.information.model_dump(mode="json"),
        "initial_strength": result.strength.value,
        "initial_candidates": [
            candidate.model_dump(mode="json") for candidate in result.candidates
        ],
        "important_boundary": (
            "供应商候选和宿主文献属于支持证据，不等于病原已被实验室确证。"
        ),
    }


def _failed_review(reviewer: Reviewer) -> ModelReview:
    return ModelReview(
        provider=reviewer.provider,
        model=reviewer.model,
        status="failed",
        conclusion="该模型本次复核失败，未影响另一模型或初筛结果。",
        confidence_basis="没有取得有效模型输出",
        uncertainties=["模型服务暂时不可用或响应格式无效"],
        next_actions=["可稍后单独重试该模型"],
        warning="本卡片不包含诊断结论。",
    )


def _agreement(reviews: list[ModelReview]) -> tuple[str, str]:
    completed = [review for review in reviews if review.status == "completed"]
    if len(completed) < 2:
        if completed:
            provider = completed[0].provider
            return f"{provider} 复核", f"已完成 {provider} 独立复核。"
        return "未比较", "尚未配置可用的大模型 API，保留专业接口初筛结果。"

    positions = {review.supports_initial_candidate for review in completed}
    if positions == {"支持"}:
        return "一致支持", "两种模型均支持首选候选，但仍需区分图像判断与实验室确证。"
    if positions.issubset({"支持", "部分支持"}):
        return "基本一致", "两种模型总体支持首选候选，对证据充分程度的判断略有差异。"
    if len(positions) == 1:
        return "一致", "两种模型对首选候选持相同态度，请结合各自的不确定项理解。"
    return "存在分歧", "两种模型结论存在分歧，应优先补充图片或进行实验室检查。"


def run_llm_reviews(
    case: CaseResponse,
    result: DiagnosisResult,
    image_paths: list[Path],
    reviewers: list[Reviewer] | None = None,
    deepseek_api_key: str | None = None,
) -> LlmReview:
    if reviewers is not None:
        active_reviewers = reviewers
    elif deepseek_api_key is not None:
        active_reviewers = _configured_reviewers(
            get_settings(),
            deepseek_api_key=deepseek_api_key,
        )
    else:
        active_reviewers = list(_default_reviewers())
    if not active_reviewers:
        return LlmReview(
            status="not_configured",
            summary="专业病害 API 初筛已完成；双模型复核密钥尚未配置。",
            requested_evidence=result.information.missing[:2],
        )

    request = ReviewRequest(context=_review_context(case, result), image_paths=image_paths)
    by_provider: dict[str, ModelReview] = {}
    with ThreadPoolExecutor(max_workers=min(2, len(active_reviewers))) as executor:
        futures = {
            executor.submit(reviewer.review, request): reviewer
            for reviewer in active_reviewers
        }
        for future in as_completed(futures):
            reviewer = futures[future]
            try:
                by_provider[reviewer.provider] = future.result()
            except Exception as error:
                logger.warning("%s 复核失败：%s", reviewer.provider, type(error).__name__)
                by_provider[reviewer.provider] = _failed_review(reviewer)

    reviews = [by_provider[reviewer.provider] for reviewer in active_reviewers]
    agreement, summary = _agreement(reviews)
    completed_count = sum(review.status == "completed" for review in reviews)
    return LlmReview(
        status="completed" if completed_count else "failed",
        summary=summary,
        requested_evidence=result.information.missing[:2],
        agreement=agreement,
        reviews=reviews,
    )
