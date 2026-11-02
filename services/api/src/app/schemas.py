from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, Field, SecretStr, model_validator


class ImageRole(StrEnum):
    LEAF_FRONT = "leaf_front"
    LEAF_BACK = "leaf_back"
    LESION_CLOSEUP = "lesion_closeup"
    HEALTHY_CONTROL = "healthy_control"


class CaseStatus(StrEnum):
    DRAFT = "draft"
    UPLOADED = "uploaded"
    QUEUED = "queued"
    QUALITY_CHECKING = "quality_checking"
    IDENTIFYING = "identifying"
    REVIEWING = "reviewing"
    COMPLETED = "completed"
    FAILED = "failed"
    NEEDS_MORE_INFORMATION = "needs_more_information"


class DiagnosisStrength(StrEnum):
    A = "A"
    B = "B"
    C = "C"
    D = "D"


class CaseImageInput(BaseModel):
    role: ImageRole
    object_key: Annotated[str, Field(min_length=1, max_length=512)]
    sha256: Annotated[str | None, Field(pattern=r"^[a-fA-F0-9]{64}$")] = None


class ProviderAccessInput(BaseModel):
    """仅用于当前请求，不写入病例记录或响应。"""

    kindwise_api_key: Annotated[SecretStr | None, Field(max_length=512)] = None
    deepseek_api_key: Annotated[SecretStr | None, Field(max_length=512)] = None
    developer_access_token: Annotated[SecretStr | None, Field(max_length=2048)] = None


class CaseCreate(BaseModel):
    species_input: Annotated[str | None, Field(max_length=200)] = None
    location_text: Annotated[str | None, Field(max_length=300)] = None
    notes: Annotated[str | None, Field(max_length=2000)] = None
    images: Annotated[list[CaseImageInput], Field(min_length=1, max_length=4)]
    access: ProviderAccessInput = Field(default_factory=ProviderAccessInput)

    @model_validator(mode="after")
    def image_roles_must_be_unique(self) -> CaseCreate:
        roles = [image.role for image in self.images]
        if len(set(roles)) != len(roles):
            raise ValueError("每种图片角色只能上传一张")
        return self


class AccessConfigurationResponse(BaseModel):
    question: str
    developer_access_available: bool
    token_hours: int


class DeveloperUnlockRequest(BaseModel):
    answer: Annotated[str, Field(min_length=1, max_length=100)]


class DeveloperUnlockResponse(BaseModel):
    access_token: str
    expires_at: datetime
    enabled_providers: list[str]


class UploadRequest(BaseModel):
    role: ImageRole
    filename: Annotated[str, Field(min_length=1, max_length=255)]
    content_type: Annotated[str, Field(pattern=r"^image/(jpeg|png|webp)$")]


class UploadResponse(BaseModel):
    object_key: str
    upload_url: str
    method: str = "PUT"
    expires_in_seconds: int = 900
    development_mock: bool = True


class DirectUploadResponse(BaseModel):
    object_key: str
    role: ImageRole
    content_type: str
    size_bytes: int
    stored_size_bytes: int
    processing_ms: int


class CloudUploadRequest(BaseModel):
    role: ImageRole
    file_id: Annotated[str, Field(min_length=10, max_length=1024)]
    temp_url: Annotated[str, Field(min_length=10, max_length=4096)]
    content_type: Annotated[str, Field(pattern=r"^image/(jpeg|png|webp)$")]


class CandidateDisease(BaseModel):
    candidate_id: str
    display_name: str
    evidence_level: str
    supporting_evidence: list[str]
    conflicting_evidence: list[str] = Field(default_factory=list)


class InformationCompleteness(BaseModel):
    score: int = Field(ge=0, le=100)
    provided: list[str]
    missing: list[str]


class ModelReview(BaseModel):
    provider: str
    model: str
    status: str
    primary_diagnosis: str = ""
    conclusion: str = ""
    supports_initial_candidate: str = "无法判断"
    confidence_level: str = "较低"
    confidence_basis: str = ""
    confirmed_evidence: list[str] = Field(default_factory=list)
    supporting_evidence: list[str] = Field(default_factory=list)
    uncertainties: list[str] = Field(default_factory=list)
    differential_diagnoses: list[str] = Field(default_factory=list)
    next_actions: list[str] = Field(default_factory=list)
    warning: str = ""


class LlmReview(BaseModel):
    status: str
    summary: str
    requested_evidence: list[str] = Field(default_factory=list)
    agreement: str = "未比较"
    reviews: list[ModelReview] = Field(default_factory=list)


class DiagnosisResult(BaseModel):
    strength: DiagnosisStrength
    information: InformationCompleteness
    candidates: list[CandidateDisease]
    llm_review: LlmReview
    next_actions: list[str]
    safety_note: str


class ProcessingTimings(BaseModel):
    quality_check_ms: int | None = None
    kindwise_ms: int | None = None
    llm_review_ms: int | None = None
    total_processing_ms: int | None = None


class CaseResponse(BaseModel):
    case_id: UUID
    status: CaseStatus
    species_input: str | None
    location_text: str | None
    notes: str | None
    images: list[CaseImageInput]
    result: DiagnosisResult | None = None
    timings: ProcessingTimings = Field(default_factory=ProcessingTimings)
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def now(cls) -> datetime:
        return datetime.now(UTC)


class ImageAddRequest(BaseModel):
    images: Annotated[list[CaseImageInput], Field(min_length=1, max_length=4)]


class FeedbackRequest(BaseModel):
    helpful: bool | None = None
    corrected_species: Annotated[str | None, Field(max_length=200)] = None
    corrected_disease: Annotated[str | None, Field(max_length=300)] = None
    comment: Annotated[str | None, Field(max_length=2000)] = None


class FeedbackResponse(BaseModel):
    accepted: bool = True
