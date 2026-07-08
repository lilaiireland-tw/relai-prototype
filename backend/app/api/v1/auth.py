from fastapi import APIRouter, Depends, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.api.deps import get_bearer_token, get_current_user, get_db
from app.schemas.auth import AuthBootstrapResponse, UserProfileResponse
from app.schemas.auth_local import LoginRequest, LogoutResponse, RegisterRequest, TokenResponse
from app.schemas.user import CurrentUser
from app.services.auth.service import LocalAuthService

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=UserProfileResponse, status_code=status.HTTP_201_CREATED)
def register_user(
    payload: RegisterRequest,
    db: Session = Depends(get_db),
) -> UserProfileResponse:
    service = LocalAuthService(db)
    user = service.register(payload)
    return UserProfileResponse.model_validate(user)


@router.post("/login", response_model=TokenResponse)
def login_user(
    payload: LoginRequest,
    db: Session = Depends(get_db),
) -> TokenResponse:
    service = LocalAuthService(db)
    _user, access_token, expires_at = service.login(payload)
    return TokenResponse(access_token=access_token, expires_at=expires_at)


@router.post("/token", response_model=TokenResponse)
def issue_token(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
) -> TokenResponse:
    service = LocalAuthService(db)
    _user, access_token, expires_at = service.login(
        LoginRequest(email=form_data.username, password=form_data.password)
    )
    return TokenResponse(access_token=access_token, expires_at=expires_at)


@router.post("/logout", response_model=LogoutResponse)
def logout_user(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
    token: str = Depends(get_bearer_token),
) -> LogoutResponse:
    service = LocalAuthService(db)
    service.logout(str(current_user.user_id), token)
    return LogoutResponse(detail="Logged out successfully")


@router.get("/me", response_model=UserProfileResponse)
def get_me(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> UserProfileResponse:
    service = LocalAuthService(db)
    user = service.ensure_user(str(current_user.user_id))
    return UserProfileResponse.model_validate(user)


@router.post("/bootstrap", response_model=AuthBootstrapResponse)
def bootstrap_user(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> AuthBootstrapResponse:
    service = LocalAuthService(db)
    user, settings, stats = service.bootstrap_user(str(current_user.user_id))
    return AuthBootstrapResponse(
        profile=UserProfileResponse.model_validate(user),
        settings=settings,
        stats=stats,
    )
