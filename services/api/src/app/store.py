from __future__ import annotations

from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from app.database import CaseRecord, SessionLocal, create_database_schema
from app.schemas import CaseResponse


class SqlAlchemyCaseStore:
    """病例持久化仓库，开发环境使用 SQLite，容器环境使用 PostgreSQL。"""

    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @staticmethod
    def _to_case(record: CaseRecord) -> CaseResponse:
        return CaseResponse.model_validate(record.data)

    def create(self, case: CaseResponse, idempotency_key: str | None) -> CaseResponse:
        with self._session_factory() as session:
            if idempotency_key:
                existing = session.scalar(
                    select(CaseRecord).where(CaseRecord.idempotency_key == idempotency_key)
                )
                if existing:
                    return self._to_case(existing)

            record = CaseRecord(
                case_id=str(case.case_id),
                idempotency_key=idempotency_key,
                status=case.status.value,
                data=case.model_dump(mode="json"),
                created_at=case.created_at,
                updated_at=case.updated_at,
            )
            session.add(record)
            try:
                session.commit()
            except IntegrityError:
                session.rollback()
                if not idempotency_key:
                    raise
                existing = session.scalar(
                    select(CaseRecord).where(CaseRecord.idempotency_key == idempotency_key)
                )
                if existing is None:
                    raise
                return self._to_case(existing)
            return case

    def get(self, case_id: UUID) -> CaseResponse | None:
        with self._session_factory() as session:
            record = session.get(CaseRecord, str(case_id))
            return self._to_case(record) if record else None

    def save(self, case: CaseResponse) -> CaseResponse:
        with self._session_factory() as session:
            record = session.get(CaseRecord, str(case.case_id))
            if record is None:
                raise KeyError(f"病例不存在: {case.case_id}")
            record.status = case.status.value
            record.data = case.model_dump(mode="json")
            record.updated_at = case.updated_at
            session.commit()
            return case

    def clear(self) -> None:
        with self._session_factory() as session:
            session.execute(delete(CaseRecord))
            session.commit()


create_database_schema()
case_store = SqlAlchemyCaseStore(SessionLocal)
