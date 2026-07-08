from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.schemas.settings import UserSettingsResponse, UserSettingsUpdateRequest
from app.schemas.user import CurrentUser
from app.services.settings.service import SettingsService

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=UserSettingsResponse)
def get_settings(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> UserSettingsResponse:
    service = SettingsService(db)
    settings = service.get_settings(str(current_user.user_id))
    db.commit()
    db.refresh(settings)
    return UserSettingsResponse.model_validate(settings)


@router.patch("", response_model=UserSettingsResponse)
def update_settings(
    payload: UserSettingsUpdateRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> UserSettingsResponse:
    service = SettingsService(db)
    settings = service.update_settings(str(current_user.user_id), payload)
    return UserSettingsResponse.model_validate(settings)
