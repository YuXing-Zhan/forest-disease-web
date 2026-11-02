from uuid import UUID

import httpx
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.store import SqlAlchemyCaseStore, case_store

client = TestClient(app)
TEST_ACCESS = {"kindwise_api_key": "test-kindwise-key"}


def setup_function() -> None:
    case_store.clear()


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_direct_image_upload() -> None:
    response = client.post(
        "/v1/uploads",
        data={"role": "lesion_closeup"},
        files={"file": ("lesion.jpg", b"fake-jpeg-content", "image/jpeg")},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["role"] == "lesion_closeup"
    assert payload["object_key"].endswith("lesion_closeup.jpg")
    assert payload["size_bytes"] == len(b"fake-jpeg-content")


def test_direct_upload_rejects_non_image() -> None:
    response = client.post(
        "/v1/uploads",
        data={"role": "leaf_front"},
        files={"file": ("notes.txt", b"not-an-image", "text/plain")},
    )
    assert response.status_code == 415


def test_raw_image_upload_for_cloud_container() -> None:
    response = client.post(
        "/v1/uploads/raw?role=leaf_front",
        content=b"fake-jpeg-content",
        headers={"Content-Type": "image/jpeg"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["role"] == "leaf_front"
    assert payload["size_bytes"] == len(b"fake-jpeg-content")
    assert payload["stored_size_bytes"] == len(b"fake-jpeg-content")


def test_cloud_upload_rejects_untrusted_url() -> None:
    response = client.post(
        "/v1/uploads/cloud",
        json={
            "role": "leaf_front",
            "file_id": "cloud://demo/image.jpg",
            "temp_url": "https://example.com/image.jpg",
            "content_type": "image/jpeg",
        },
    )
    assert response.status_code == 422


def test_cloud_upload_downloads_trusted_file(monkeypatch) -> None:
    class FakeStream:
        url = "https://demo.tcb.qcloud.la/image.jpg"

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return None

        def raise_for_status(self):
            return None

        def iter_bytes(self, chunk_size):
            _ = chunk_size
            yield b"fake-jpeg-content"

    monkeypatch.setattr(httpx, "stream", lambda *args, **kwargs: FakeStream())
    response = client.post(
        "/v1/uploads/cloud",
        json={
            "role": "leaf_front",
            "file_id": "cloud://demo/image.jpg",
            "temp_url": "https://demo.tcb.qcloud.la/image.jpg",
            "content_type": "image/jpeg",
        },
    )
    assert response.status_code == 200
    assert response.json()["size_bytes"] == len(b"fake-jpeg-content")


def test_one_image_can_complete_with_degraded_strength() -> None:
    response = client.post(
        "/v1/cases",
        json={
            "species_input": None,
            "access": TEST_ACCESS,
            "images": [
                {
                    "role": "lesion_closeup",
                    "object_key": "cases/demo/lesion.jpg",
                }
            ],
        },
    )
    assert response.status_code == 202
    case_id = response.json()["case_id"]

    case_response = client.get(f"/v1/cases/{case_id}")
    assert case_response.status_code == 200
    case = case_response.json()
    assert case["status"] == "completed"
    assert case["result"]["strength"] == "D"
    assert "树种信息" in case["result"]["information"]["missing"]


def test_four_images_and_species_improve_result_without_claiming_diagnosis() -> None:
    response = client.post(
        "/v1/cases",
        json={
            "species_input": "杨树",
            "access": TEST_ACCESS,
            "images": [
                {"role": "leaf_front", "object_key": "cases/demo/front.jpg"},
                {"role": "leaf_back", "object_key": "cases/demo/back.jpg"},
                {"role": "lesion_closeup", "object_key": "cases/demo/lesion.jpg"},
                {"role": "healthy_control", "object_key": "cases/demo/healthy.jpg"},
            ],
        },
    )
    case_id = response.json()["case_id"]
    result = client.get(f"/v1/cases/{case_id}/result").json()

    assert result["strength"] == "B"
    assert result["information"]["score"] == 100
    assert "模拟候选" in result["candidates"][0]["display_name"]
    assert "不构成" in result["safety_note"]


def test_idempotency_key_prevents_duplicate_case() -> None:
    payload = {
        "access": TEST_ACCESS,
        "images": [{"role": "leaf_front", "object_key": "cases/demo/front.jpg"}],
    }
    first = client.post("/v1/cases", json=payload, headers={"Idempotency-Key": "demo-1"})
    second = client.post("/v1/cases", json=payload, headers={"Idempotency-Key": "demo-1"})
    assert first.json()["case_id"] == second.json()["case_id"]


def test_case_can_be_reloaded_by_a_new_repository_instance() -> None:
    response = client.post(
        "/v1/cases",
        json={
            "access": TEST_ACCESS,
            "images": [{"role": "leaf_front", "object_key": "cases/demo/front.jpg"}],
        },
    )
    case_id = UUID(response.json()["case_id"])

    reloaded = SqlAlchemyCaseStore(SessionLocal).get(case_id)
    assert reloaded is not None
    assert reloaded.case_id == case_id
    assert reloaded.status.value == "completed"


def test_duplicate_image_roles_are_rejected() -> None:
    response = client.post(
        "/v1/cases",
        json={
            "images": [
                {"role": "leaf_front", "object_key": "cases/demo/one.jpg"},
                {"role": "leaf_front", "object_key": "cases/demo/two.jpg"},
            ]
        },
    )
    assert response.status_code == 422


def test_case_requires_api_access() -> None:
    response = client.post(
        "/v1/cases",
        json={"images": [{"role": "leaf_front", "object_key": "cases/demo/front.jpg"}]},
    )
    assert response.status_code == 422
    assert "设置页" in response.json()["detail"]
