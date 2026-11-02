from __future__ import annotations

import logging
from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter

from app.access import RuntimeCredentials
from app.config import get_settings
from app.host_rules import refine_host_candidate
from app.providers.kindwise import KindwiseDiagnosis, KindwiseProvider
from app.review import run_llm_reviews
from app.schemas import (
    CandidateDisease,
    CaseResponse,
    CaseStatus,
    DiagnosisResult,
    DiagnosisStrength,
    ImageRole,
    InformationCompleteness,
    LlmReview,
)
from app.store import SqlAlchemyCaseStore

logger = logging.getLogger(__name__)


def _build_mock_result(case: CaseResponse) -> DiagnosisResult:
    roles = {image.role for image in case.images}
    provided: list[str] = ["症状叶片图"]
    missing: list[str] = []

    if case.species_input and case.species_input.strip().lower() not in {"未知", "unknown"}:
        provided.append("树种信息")
    else:
        missing.append("树种信息")

    if ImageRole.HEALTHY_CONTROL in roles:
        provided.append("健康对照")
    else:
        missing.append("健康对照")

    if ImageRole.LESION_CLOSEUP in roles:
        provided.append("病斑近照")
    else:
        missing.append("病斑近照")

    if {ImageRole.LEAF_FRONT, ImageRole.LEAF_BACK}.issubset(roles):
        provided.append("叶片正反面")
    else:
        missing.append("完整叶片正反面")

    score = round(len(provided) / (len(provided) + len(missing)) * 100)
    if not missing:
        strength = DiagnosisStrength.B
    elif len(case.images) >= 2 and case.species_input:
        strength = DiagnosisStrength.C
    else:
        strength = DiagnosisStrength.D

    candidate = CandidateDisease(
        candidate_id="mock_leaf_spot_pattern",
        display_name="叶斑类症状（模拟候选）",
        evidence_level="低" if strength == DiagnosisStrength.D else "中",
        supporting_evidence=["已检测到用户提交的症状叶片图"],
        conflicting_evidence=["尚未接入真实病害 API，不能输出具体病名"],
    )

    next_actions = [f"建议补充：{item}" for item in missing[:2]]
    if not next_actions:
        next_actions = ["等待接入真实识别服务后重新分析"]

    return DiagnosisResult(
        strength=strength,
        information=InformationCompleteness(score=score, provided=provided, missing=missing),
        candidates=[candidate],
        llm_review=LlmReview(
            status="mock",
            summary="当前为流程联调结果，未调用真实多模态大模型。",
            requested_evidence=missing[:2],
        ),
        next_actions=next_actions,
        safety_note="该结果仅用于开发联调，不构成植物病害确诊或防治用药依据。",
    )


def _evidence_level(probability: float) -> str:
    if probability >= 0.65:
        return "高"
    if probability >= 0.3:
        return "中"
    return "低"


def _build_kindwise_result(case: CaseResponse, diagnosis: KindwiseDiagnosis) -> DiagnosisResult:
    base = _build_mock_result(case)
    visible_candidates = [
        candidate for candidate in diagnosis.candidates if candidate.probability >= 0.3
    ]
    if not visible_candidates:
        visible_candidates = diagnosis.candidates[:1]
    provider_candidates: list[CandidateDisease] = []
    has_strong_host_match = False
    for candidate in visible_candidates:
        refinement = refine_host_candidate(case.species_input, candidate.name)
        supporting_evidence = [
            f"Kindwise plant.health 返回候选：{candidate.name}",
            f"供应商模型版本：{diagnosis.model_version}",
        ]
        conflicting_evidence = (
            [] if diagnosis.is_plant else ["供应商认为图片中的植物主体不明确"]
        )
        if refinement is not None:
            supporting_evidence[0] = (
                f"Kindwise plant.health 返回属级候选：{candidate.name}"
            )
            supporting_evidence.extend(
                [
                    refinement.supporting_evidence,
                    f"宿主关系参考：{refinement.source_url}",
                ]
            )
            conflicting_evidence.append("单张症状照片仍不能替代显微观察或病原分离")
            has_strong_host_match = has_strong_host_match or candidate.probability >= 0.65

        provider_candidates.append(
            CandidateDisease(
                candidate_id=f"kindwise:{candidate.candidate_id}",
                display_name=(refinement.display_name if refinement else candidate.name),
                evidence_level=_evidence_level(candidate.probability),
                supporting_evidence=supporting_evidence,
                conflicting_evidence=conflicting_evidence,
            )
        )

    if diagnosis.is_healthy:
        strength = DiagnosisStrength.C
        next_actions = ["当前更接近健康或非显著病害；如症状持续，请补拍病健交界近照"]
    elif has_strong_host_match:
        strength = DiagnosisStrength.B
        next_actions = base.next_actions or ["建议补拍叶背和健康对照，继续排除相似叶斑病"]
    elif provider_candidates and base.information.score >= 80:
        strength = DiagnosisStrength.B
        next_actions = base.next_actions or ["建议结合树种与现场环境复核排名靠前的候选"]
    elif provider_candidates:
        strength = DiagnosisStrength.C
        next_actions = base.next_actions
    else:
        strength = DiagnosisStrength.D
        next_actions = ["在线服务未返回可用病害候选，建议补拍或转专家复核"]

    return DiagnosisResult(
        strength=strength,
        information=base.information,
        candidates=provider_candidates,
        llm_review=LlmReview(
            status="not_configured",
            summary="已完成专业病害 API 初筛；多模态大模型复核尚未接入。",
            requested_evidence=base.information.missing[:2],
        ),
        next_actions=next_actions,
        safety_note=(
            "候选来自 Kindwise plant.health，供应商分数不等同于系统准确率；"
            "结果仅用于病害初筛，不构成确诊或防治用药依据。"
        ),
    )


def _kindwise_image_paths(case: CaseResponse) -> list[Path]:
    settings = get_settings()
    root = Path(settings.upload_dir).resolve()
    paths = [(root / image.object_key).resolve() for image in case.images]
    return [path for path in paths if path.is_file() and path.is_relative_to(root)]


def _try_kindwise(
    case: CaseResponse,
    image_paths: list[Path],
    api_key: str,
) -> KindwiseDiagnosis | None:
    if not api_key or not image_paths:
        return None
    try:
        provider = KindwiseProvider(api_key)
        return provider.diagnose(image_paths)
    except Exception as error:  # 外部服务失败必须降级，且不能记录密钥或完整响应
        logger.warning("Kindwise 识别失败，病例 %s 将使用降级结果：%s", case.case_id, error)
        return None


def process_case(
    case_id,
    store: SqlAlchemyCaseStore,
    credentials: RuntimeCredentials | None = None,
) -> None:
    case = store.get(case_id)
    if case is None:
        return

    total_started = perf_counter()

    case.status = CaseStatus.QUALITY_CHECKING
    case.updated_at = datetime.now(UTC)
    store.save(case)
    stage_started = perf_counter()
    image_paths = _kindwise_image_paths(case)
    case.timings.quality_check_ms = round((perf_counter() - stage_started) * 1000)

    case.status = CaseStatus.IDENTIFYING
    case.updated_at = datetime.now(UTC)
    store.save(case)
    stage_started = perf_counter()
    active_credentials = credentials or RuntimeCredentials()
    kindwise_result = _try_kindwise(
        case,
        image_paths,
        active_credentials.kindwise_api_key,
    )
    case.timings.kindwise_ms = round((perf_counter() - stage_started) * 1000)
    initial_result = (
        _build_kindwise_result(case, kindwise_result)
        if kindwise_result is not None
        else _build_mock_result(case)
    )
    case.status = CaseStatus.REVIEWING
    case.updated_at = datetime.now(UTC)
    store.save(case)
    stage_started = perf_counter()
    review = run_llm_reviews(
        case,
        initial_result,
        image_paths,
        deepseek_api_key=active_credentials.deepseek_api_key,
    )
    case.timings.llm_review_ms = round((perf_counter() - stage_started) * 1000)
    case.result = initial_result.model_copy(
        update={
            "llm_review": review
        }
    )
    case.timings.total_processing_ms = round((perf_counter() - total_started) * 1000)
    case.status = CaseStatus.COMPLETED
    case.updated_at = datetime.now(UTC)
    store.save(case)
