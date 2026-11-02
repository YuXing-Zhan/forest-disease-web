from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from app.diagnosis import _build_kindwise_result
from app.providers.kindwise import KindwiseCandidate, KindwiseDiagnosis, KindwiseProvider
from app.schemas import CaseImageInput, CaseResponse, CaseStatus, ImageRole


class FakePlantHealthClient:
    def usage_info(self, **kwargs):
        return {"active": True, "remaining": {"total": 50}}

    def health_assessment(self, image, **kwargs):
        assert image == [str(Path("leaf.jpg"))]
        assert kwargs["language"] == "zh"
        assert kwargs["full_disease_list"] is False
        return {
            "access_token": "test-token",
            "model_version": "test-model",
            "result": {
                "is_plant": {"binary": True, "probability": 0.99},
                "is_healthy": {"binary": False, "probability": 0.12},
                "disease": {
                    "suggestions": [
                        {
                            "id": "leaf-spot",
                            "name": "leaf spot",
                            "probability": 0.76,
                            "details": {"local_name": "叶斑类病害"},
                        }
                    ]
                },
            },
        }


def test_kindwise_provider_normalizes_health_assessment() -> None:
    provider = KindwiseProvider("test-key", client=FakePlantHealthClient())
    diagnosis = provider.diagnose([Path("leaf.jpg")])

    assert diagnosis.is_plant is True
    assert diagnosis.is_healthy is False
    assert diagnosis.model_version == "test-model"
    assert diagnosis.candidates[0].name == "叶斑类病害"
    assert diagnosis.candidates[0].probability == 0.76


def test_kindwise_usage_info_does_not_require_identification() -> None:
    provider = KindwiseProvider("test-key", client=FakePlantHealthClient())
    usage = provider.usage_info()
    assert usage["active"] is True
    assert usage["remaining"]["total"] == 50


def test_low_evidence_candidates_are_hidden_when_stronger_candidate_exists() -> None:
    now = datetime.now(UTC)
    case = CaseResponse(
        case_id=uuid4(),
        status=CaseStatus.IDENTIFYING,
        species_input=None,
        location_text=None,
        notes=None,
        images=[CaseImageInput(role=ImageRole.LESION_CLOSEUP, object_key="leaf.jpg")],
        created_at=now,
        updated_at=now,
    )
    diagnosis = KindwiseDiagnosis(
        access_token="test",
        model_version="test-model",
        is_plant=True,
        plant_probability=0.99,
        is_healthy=False,
        healthy_probability=0.1,
        candidates=[
            KindwiseCandidate("strong", "叶斑类", 0.72, {}),
            KindwiseCandidate("weak", "可疑低分候选", 0.08, {}),
        ],
    )

    result = _build_kindwise_result(case, diagnosis)
    assert [candidate.display_name for candidate in result.candidates] == ["叶斑类"]


def test_redbud_host_refines_pseudocercospora_candidate_without_new_api_call() -> None:
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
    diagnosis = KindwiseDiagnosis(
        access_token="test",
        model_version="test-model",
        is_plant=True,
        plant_probability=0.99,
        is_healthy=False,
        healthy_probability=0.05,
        candidates=[KindwiseCandidate("pseudocercospora", "假尾孢菌属", 0.78, {})],
    )

    result = _build_kindwise_result(case, diagnosis)

    assert result.strength.value == "B"
    assert result.information.score == 60
    assert result.candidates[0].display_name == "紫荆假尾孢叶斑病（高度疑似）"
    assert "属级候选：假尾孢菌属" in result.candidates[0].supporting_evidence[0]
    assert any(
        "Pseudocercospora cercidicola" in item
        for item in result.candidates[0].supporting_evidence
    )


def test_redbud_rule_does_not_apply_to_an_unrelated_host() -> None:
    now = datetime.now(UTC)
    case = CaseResponse(
        case_id=uuid4(),
        status=CaseStatus.REVIEWING,
        species_input="银杏",
        location_text=None,
        notes=None,
        images=[CaseImageInput(role=ImageRole.LESION_CLOSEUP, object_key="leaf.jpg")],
        created_at=now,
        updated_at=now,
    )
    diagnosis = KindwiseDiagnosis(
        access_token="test",
        model_version="test-model",
        is_plant=True,
        plant_probability=0.99,
        is_healthy=False,
        healthy_probability=0.05,
        candidates=[KindwiseCandidate("pseudocercospora", "假尾孢菌属", 0.78, {})],
    )

    result = _build_kindwise_result(case, diagnosis)

    assert result.strength.value == "C"
    assert result.candidates[0].display_name == "假尾孢菌属"
