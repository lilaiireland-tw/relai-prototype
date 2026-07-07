from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.schemas.stats import UserStatsResponse
from app.schemas.user import CurrentUser
from app.services.stats.service import StatsService

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("", response_model=UserStatsResponse)
def get_stats(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> UserStatsResponse:
    service = StatsService(db)
    stats = service.get_user_stats(user_id=current_user.user_id)
    db.commit()
    db.refresh(stats)
    return UserStatsResponse.model_validate(stats)
