from app.access import (
    answer_is_valid,
    developer_token_is_valid,
    issue_developer_token,
    resolve_runtime_credentials,
)
from app.config import Settings
from app.schemas import ProviderAccessInput


def test_developer_class_answers_are_normalized() -> None:
    assert answer_is_valid("智慧林业 2401")
    assert answer_is_valid("智林2401")


def test_wrong_developer_answer_is_rejected() -> None:
    assert not answer_is_valid("智慧林业2402")


def test_signed_developer_token_enables_server_keys_without_persisting_them() -> None:
    settings = Settings(
        kindwise_api_key="developer-kindwise",
        deepseek_api_key="developer-deepseek",
        developer_access_secret="a-long-test-signing-secret",
    )
    token, expires_at = issue_developer_token(settings)

    assert expires_at.timestamp() > 0
    assert developer_token_is_valid(token, settings)
    credentials = resolve_runtime_credentials(
        ProviderAccessInput(developer_access_token=token),
        settings,
    )
    assert credentials.kindwise_api_key == "developer-kindwise"
    assert credentials.deepseek_api_key == "developer-deepseek"


def test_user_key_overrides_matching_developer_provider() -> None:
    settings = Settings(
        kindwise_api_key="developer-kindwise",
        deepseek_api_key="developer-deepseek",
        developer_access_secret="a-long-test-signing-secret",
    )
    token, _ = issue_developer_token(settings)
    credentials = resolve_runtime_credentials(
        ProviderAccessInput(
            kindwise_api_key="user-kindwise",
            developer_access_token=token,
        ),
        settings,
    )
    assert credentials.kindwise_api_key == "user-kindwise"
    assert credentials.deepseek_api_key == "developer-deepseek"
