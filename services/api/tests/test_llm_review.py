from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from app.providers.llm_review import _parse_review
from app.review import run_llm_reviews
from app.review_prompt import REVIEW_SYSTEM_PROMPT
from app.schemas import (
    CandidateDisease,
    CaseImageInput,
    CaseResponse,
    CaseStatus,
    DiagnosisResult,
    DiagnosisStrength,
    ImageRole,
    InformationCompleteness,
    LlmReview,
    ModelReview,
)


class FakeReviewer:
    def __init__(self, provider: str, model: str, position: str) -> None:
        self.provider = provider
        self.model = model
        self.position = position

    def review(self, request) -> ModelReview:
        assert request.context["user_information"]["species"] == "紫荆"
        return ModelReview(
            provider=self.provider,
            model=self.model,
            status="completed",
            primary_diagnosis="紫荆假尾孢叶斑病（疑似）",
            conclusion="图像症状与初筛候选相符，但不能据此确诊病原。",
            supports_initial_candidate=self.position,
            confidence_level="中等",
            confidence_basis="树种、症状和属级候选相互支持",
            confirmed_evidence=["用户提供树种为紫荆", "叶片可见褐色坏死斑"],
            supporting_evidence=["专业接口首选假尾孢菌属"],
            uncertainties=["缺少叶背图和显微证据"],
            differential_diagnoses=["其他真菌性叶斑病"],
            next_actions=["补拍同一叶片背面"],
            warning="单凭图片不能确诊病原。",
        )


def _case_and_result() -> tuple[CaseResponse, DiagnosisResult]:
    now = datetime.now(UTC)
    case = CaseResponse(
        case_id=uuid4(),
        status=CaseStatus.REVIEWING,
        species_input="紫荆",
        location_text="南昌",
        notes=None,
        images=[CaseImageInput(role=ImageRole.LESION_CLOSEUP, object_key="leaf.jpg")],
        created_at=now,
        updated_at=now,
    )
    result = DiagnosisResult(
        strength=DiagnosisStrength.B,
        information=InformationCompleteness(
            score=60,
            provided=["症状叶片图", "树种信息", "病斑近照"],
            missing=["健康对照", "完整叶片正反面"],
        ),
        candidates=[
            CandidateDisease(
                candidate_id="kindwise:pseudocercospora",
                display_name="紫荆假尾孢叶斑病（高度疑似）",
                evidence_level="高",
                supporting_evidence=["Kindwise plant.health 返回该候选"],
            )
        ],
        llm_review=LlmReview(status="not_configured", summary="待复核"),
        next_actions=["补拍叶背"],
        safety_note="不构成确诊。",
    )
    return case, result


def test_review_prompt_has_required_evidence_boundaries() -> None:
    assert "确实证据" in REVIEW_SYSTEM_PROMPT
    assert "不得虚构显微结构" in REVIEW_SYSTEM_PROMPT
    assert "可信度表示当前证据链强弱" in REVIEW_SYSTEM_PROMPT
    assert "后续建议最多 3 条" in REVIEW_SYSTEM_PROMPT


def test_model_review_parser_accepts_a_fenced_json_object() -> None:
    content = """```json
    {
      "primary_diagnosis": "叶斑病（疑似）",
      "conclusion": "证据有限。",
      "supports_initial_candidate": "部分支持",
      "confidence_level": "较低",
      "confidence_basis": "仅有一张图片",
      "confirmed_evidence": ["叶面有褐色斑点"],
      "supporting_evidence": [],
      "uncertainties": ["缺少叶背图"],
      "differential_diagnoses": [],
      "next_actions": ["补拍叶背"],
      "warning": "不能确诊"
    }
    ```"""

    review = _parse_review("DeepSeek", "deepseek-flash", content)

    assert review.status == "completed"
    assert review.primary_diagnosis == "叶斑病（疑似）"


def test_two_model_reviews_are_kept_separately_and_compared() -> None:
    case, result = _case_and_result()
    reviewers = [
        FakeReviewer("OpenAI", "gpt-5.6-sol", "支持"),
        FakeReviewer("DeepSeek", "deepseek-flash", "支持"),
    ]

    review = run_llm_reviews(case, result, [Path("leaf.jpg")], reviewers)

    assert review.status == "completed"
    assert review.agreement == "一致支持"
    assert [item.provider for item in review.reviews] == ["OpenAI", "DeepSeek"]
    assert all(item.confirmed_evidence for item in review.reviews)


def test_single_model_mode_is_presented_as_intentional() -> None:
    case, result = _case_and_result()
    reviewers = [FakeReviewer("DeepSeek", "deepseek-flash", "部分支持")]

    review = run_llm_reviews(case, result, [Path("leaf.jpg")], reviewers)

    assert review.agreement == "DeepSeek 复核"
    assert review.summary == "已完成 DeepSeek 独立复核。"
