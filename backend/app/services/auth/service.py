from datetime import UTC, datetime
from datetime import timedelta

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import create_access_token, decode_token, hash_password, verify_password
from app.repositories.settings_repository import SettingsRepository
from app.repositories.stats_repository import StatsRepository
from app.repositories.user_repository import UserRepository
from app.schemas.auth_local import LoginRequest, RegisterRequest


class LocalAuthService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.users = UserRepository(db)
        self.settings = SettingsRepository(db)
        self.stats = StatsRepository(db)

    def ensure_user(self, user_id: str):
        return self.users.get_required(user_id)

    def bootstrap_user(self, user_id: str):
        user = self.ensure_user(user_id)
        user.last_login_at = datetime.now(UTC)
        settings = self.settings.get_or_create(user_id)
        stats = self.stats.get_or_create(user_id)
        self.db.commit()
        self.db.refresh(user)
        self.db.refresh(settings)
        self.db.refresh(stats)
        return user, settings, stats

    def register(self, payload: RegisterRequest):
        existing_user = self.users.get_by_email(payload.email)
        if existing_user is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

        user = self.users.create_email_user(
            email=payload.email,
            password_hash=hash_password(payload.password),
            display_name=payload.display_name,
        )
        self.settings.get_or_create(str(user.id))
        self.stats.get_or_create(str(user.id))
        self.db.commit()
        self.db.refresh(user)
        return user

    def login(self, payload: LoginRequest):
        user = self.users.get_by_email(payload.email)
        if user is None or user.password_hash is None or not verify_password(payload.password, user.password_hash):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
        if not user.is_active:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is inactive")

        now = datetime.now(UTC)
        user.last_login_at = now
        expires_at = now + timedelta(minutes=settings.access_token_expire_minutes)
        access_token = create_access_token(str(user.id), expires_delta=timedelta(minutes=settings.access_token_expire_minutes))
        self.db.commit()
        self.db.refresh(user)
        return user, access_token, expires_at

    def logout(self, user_id: str, token: str):
        payload = decode_token(token)
        jti = payload.get("jti")
        exp = payload.get("exp")
        token_type = payload.get("type", "access")
        if not isinstance(jti, str) or not isinstance(exp, int):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

        self.users.revoke_token(
            user_id=user_id,
            jti=jti,
            token_type=str(token_type),
            expires_at=datetime.fromtimestamp(exp, tz=UTC),
        )
        self.db.commit()
