from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import UserStat
from app.models.enums import CohortSource


class StatsRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_or_create(self, user_id: str) -> UserStat:
        statement = select(UserStat).where(UserStat.user_id == user_id)
        stats = self.db.scalar(statement)
        if stats is not None:
            return stats

        stats = UserStat(user_id=user_id, cohort_source=CohortSource.ORGANIC)
        self.db.add(stats)
        self.db.flush()
        self.db.refresh(stats)
        return stats
