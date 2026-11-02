from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter
from typing import Annotated
from urllib.parse import urlparse
from uuid import UUID, uuid4

import httpx
from fastapi import (
    BackgroundTasks,
    FastAPI,
    File,
    Form,
    Header,
    HTTPException,
    Request,
    UploadFile,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps

from app.access import (
    answer_is_valid,
    developer_access_available,
    issue_developer_token,
    resolve_runtime_credentials,
)
from app.config import get_settings
from app.diagnosis import process_case
from app.schemas import (
    AccessConfigurationResponse,
    CaseCreate,
    CaseResponse,
    CaseStatus,
    CloudUploadRequest,
    DeveloperUnlockRequest,
    DeveloperUnlockResponse,
    DiagnosisResult,
    DirectUploadResponse,
    FeedbackRequest,
    FeedbackResponse,
    ImageAddRequest,
    ImageRole,
    ProviderAccessInput,
    UploadRequest,
    UploadResponse,
)
from app.store import case_store

app = FastAPI(
    title="林木叶片病害识别 API",
    version="0.2.0",
    description="Kindwise 初筛与 OpenAI、DeepSeek 双模型独立复核接口。",
)
settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Idempotency-Key"],
)
ALLOWED_IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
ALLOWED_CLOUD_STORAGE_HOST_SUFFIXES = (
    ".tcb.qcloud.la",
    ".tcloudbaseapp.com",
    ".myqcloud.com",
)


def _optimize_uploaded_image(path: Path, content_type: str) -> None:
    """限制推理图片尺寸；失败时保留原图，兼容更多相机编码。"""
    temporary = path.with_name(f"{path.stem}.optimized{path.suffix}")
    try:
        with Image.open(path) as source:
            image = ImageOps.exif_transpose(source)
            image.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
            if content_type == "image/jpeg":
                image.convert("RGB").save(temporary, "JPEG", quality=86, optimize=True)
            elif content_type == "image/webp":
                image.convert("RGB").save(temporary, "WEBP", quality=86, method=4)
            else:
                image.save(temporary, "PNG", optimize=True)
        if temporary.stat().st_size < path.stat().st_size:
            temporary.replace(path)
        else:
            temporary.unlink(missing_ok=True)
    except Exception:
        temporary.unlink(missing_ok=True)


def _prepare_upload(role: ImageRole, content_type: str) -> tuple[str, Path]:
    extension = ALLOWED_IMAGE_TYPES.get(content_type)
    if extension is None:
        raise HTTPException(status_code=415, detail="仅支持 JPEG、PNG 或 WebP 图片")
    upload_root = Path(settings.upload_dir).resolve()
    upload_root.mkdir(parents=True, exist_ok=True)
    object_key = f"cases/pending/{uuid4()}/{role.value}{extension}"
    destination = upload_root / object_key
    destination.parent.mkdir(parents=True, exist_ok=True)
    return object_key, destination


def _upload_response(
    object_key: str,
    destination: Path,
    role: ImageRole,
    content_type: str,
    original_size: int,
) -> DirectUploadResponse:
    processing_started = perf_counter()
    _optimize_uploaded_image(destination, content_type)
    return DirectUploadResponse(
        object_key=object_key,
        role=role,
        content_type=content_type,
        size_bytes=original_size,
        stored_size_bytes=destination.stat().st_size,
        processing_ms=round((perf_counter() - processing_started) * 1000),
    )


def _is_allowed_cloud_storage_url(url: str) -> bool:
    parsed = urlparse(url)
    hostname = (parsed.hostname or "").lower()
    return parsed.scheme == "https" and any(
        hostname.endswith(suffix) for suffix in ALLOWED_CLOUD_STORAGE_HOST_SUFFIXES
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/v1/access/configuration", response_model=AccessConfigurationResponse)
def get_access_configuration() -> AccessConfigurationResponse:
    return AccessConfigurationResponse(
        question=settings.developer_access_question,
        developer_access_available=developer_access_available(settings),
        token_hours=settings.developer_access_token_hours,
    )


@app.post("/v1/access/developer/unlock", response_model=DeveloperUnlockResponse)
def unlock_developer_access(request: DeveloperUnlockRequest) -> DeveloperUnlockResponse:
    if not developer_access_available(settings):
        raise HTTPException(status_code=503, detail="开发者 API 尚未配置")
    if not answer_is_valid(request.answer, settings):
        raise HTTPException(status_code=403, detail="答案不正确")
    token, expires_at = issue_developer_token(settings)
    credentials = resolve_runtime_credentials(
        ProviderAccessInput(developer_access_token=token),
        settings,
    )
    return DeveloperUnlockResponse(
        access_token=token,
        expires_at=expires_at,
        enabled_providers=credentials.configured_providers,
    )


@app.post("/v1/uploads/presign", response_model=UploadResponse)
def create_upload(request: UploadRequest) -> UploadResponse:
    object_key = f"cases/pending/{uuid4()}/{request.role.value}/{request.filename}"
    return UploadResponse(
        object_key=object_key,
        upload_url=f"http://localhost:9000/leaf-cases/{object_key}",
    )


@app.post("/v1/uploads", response_model=DirectUploadResponse)
async def upload_image(
    role: Annotated[ImageRole, Form()],
    file: Annotated[UploadFile, File()],
) -> DirectUploadResponse:
    content_type = (file.content_type or "").split(";", 1)[0].strip().lower()
    object_key, destination = _prepare_upload(role, content_type)

    size = 0
    try:
        with destination.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > settings.max_upload_bytes:
                    raise HTTPException(status_code=413, detail="单张图片不能超过 12 MB")
                output.write(chunk)
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    finally:
        await file.close()

    return _upload_response(object_key, destination, role, content_type, size)


@app.post("/v1/uploads/raw", response_model=DirectUploadResponse)
async def upload_image_raw(
    request: Request,
    role: ImageRole,
    content_type: Annotated[str | None, Header(alias="Content-Type")] = None,
) -> DirectUploadResponse:
    """供 wx.cloud.callContainer 直接传输压缩后的二进制图片。"""
    media_type = (content_type or "").split(";", 1)[0].strip().lower()
    object_key, destination = _prepare_upload(role, media_type)
    body = await request.body()
    if len(body) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail="单张图片不能超过 12 MB")
    if not body:
        raise HTTPException(status_code=400, detail="图片内容不能为空")
    try:
        destination.write_bytes(body)
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    return _upload_response(object_key, destination, role, media_type, len(body))


@app.post("/v1/uploads/cloud", response_model=DirectUploadResponse)
def upload_image_from_cloud(request: CloudUploadRequest) -> DirectUploadResponse:
    """下载小程序刚上传的云存储临时文件，避免 callContainer 的 100KB 限制。"""
    if not request.file_id.startswith("cloud://"):
        raise HTTPException(status_code=422, detail="无效的云存储文件标识")
    if not _is_allowed_cloud_storage_url(request.temp_url):
        raise HTTPException(status_code=422, detail="无效的云存储临时地址")

    object_key, destination = _prepare_upload(request.role, request.content_type)
    size = 0
    try:
        with httpx.stream(
            "GET",
            request.temp_url,
            follow_redirects=True,
            timeout=30.0,
        ) as response:
            response.raise_for_status()
            if not _is_allowed_cloud_storage_url(str(response.url)):
                raise HTTPException(status_code=422, detail="云存储重定向地址不受信任")
            with destination.open("wb") as output:
                for chunk in response.iter_bytes(1024 * 1024):
                    size += len(chunk)
                    if size > settings.max_upload_bytes:
                        raise HTTPException(status_code=413, detail="单张图片不能超过 12 MB")
                    output.write(chunk)
        if not size:
            raise HTTPException(status_code=400, detail="云存储图片内容为空")
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    return _upload_response(
        object_key,
        destination,
        request.role,
        request.content_type,
        size,
    )


@app.post("/v1/cases", response_model=CaseResponse, status_code=status.HTTP_202_ACCEPTED)
def create_case(
    request: CaseCreate,
    background_tasks: BackgroundTasks,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> CaseResponse:
    runtime_credentials = resolve_runtime_credentials(request.access, settings)
    if not runtime_credentials.configured_providers:
        raise HTTPException(
            status_code=422,
            detail="尚未配置可用的 API，请先在设置页填写自己的密钥或解锁开发者通道",
        )
    now = datetime.now(UTC)
    case = CaseResponse(
        case_id=uuid4(),
        status=CaseStatus.QUEUED,
        species_input=request.species_input,
        location_text=request.location_text,
        notes=request.notes,
        images=request.images,
        created_at=now,
        updated_at=now,
    )
    stored = case_store.create(case, idempotency_key)
    if stored.case_id == case.case_id:
        background_tasks.add_task(
            process_case,
            stored.case_id,
            case_store,
            runtime_credentials,
        )
    return stored


def _get_case_or_404(case_id: UUID) -> CaseResponse:
    case = case_store.get(case_id)
    if case is None:
        raise HTTPException(status_code=404, detail="病例不存在")
    return case


@app.get("/v1/cases/{case_id}", response_model=CaseResponse)
def get_case(case_id: UUID) -> CaseResponse:
    return _get_case_or_404(case_id)


@app.get("/v1/cases/{case_id}/result", response_model=DiagnosisResult)
def get_result(case_id: UUID) -> DiagnosisResult:
    case = _get_case_or_404(case_id)
    if case.result is None:
        raise HTTPException(status_code=409, detail={"status": case.status})
    return case.result


@app.post("/v1/cases/{case_id}/images", response_model=CaseResponse)
def add_images(
    case_id: UUID,
    request: ImageAddRequest,
    background_tasks: BackgroundTasks,
) -> CaseResponse:
    case = _get_case_or_404(case_id)
    by_role = {image.role: image for image in case.images}
    for image in request.images:
        by_role[image.role] = image
    if len(by_role) > 4:
        raise HTTPException(status_code=422, detail="病例最多包含四种角色图片")

    case.images = list(by_role.values())
    case.status = CaseStatus.QUEUED
    case.result = None
    case.updated_at = datetime.now(UTC)
    case_store.save(case)
    background_tasks.add_task(process_case, case.case_id, case_store)
    return case


@app.post("/v1/cases/{case_id}/feedback", response_model=FeedbackResponse)
def submit_feedback(case_id: UUID, request: FeedbackRequest) -> FeedbackResponse:
    _get_case_or_404(case_id)
    # 阶段一仅固定接口；阶段三写入审计数据库。
    _ = request
    return FeedbackResponse()


# Mount last so /v1 and /health always reach the API rather than the web frontend.
if settings.web_dist_dir and Path(settings.web_dist_dir).is_dir():
    app.mount("/", StaticFiles(directory=settings.web_dist_dir, html=True), name="web")
