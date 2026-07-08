from sqlalchemy import select
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models import RevokedToken, UserAccount
from app.models.enums import AuthProvider


class UserRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_id(self, user_id: str) -> UserAccount | None:
        statement = select(UserAccount).where(UserAccount.id == user_id)
        return self.db.scalar(statement)

    def get_required(self, user_id: str) -> UserAccount:
        user = self.get_by_id(user_id)
        if user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
        return user

    def get_by_email(self, email: str) -> UserAccount | None:
        statement = select(UserAccount).where(UserAccount.email == email)
        return self.db.scalar(statement)

    def create_email_user(
        self,
        email: str,
        password_hash: str,
        display_name: str | None = None,
    ) -> UserAccount:
        user = UserAccount(
            email=email,
            password_hash=password_hash,
            display_name=display_name,
            auth_provider=AuthProvider.EMAIL,
            onboarding_completed=False,
        )
        self.db.add(user)
        self.db.flush()
        self.db.refresh(user)
        return user

    def revoke_token(
        self,
        user_id: str,
        jti: str,
        expires_at,
        token_type: str = "access",
    ) -> RevokedToken:
        revoked_token = RevokedToken(
            user_id=user_id,
            jti=jti,
            token_type=token_type,
            expires_at=expires_at,
        )
        self.db.add(revoked_token)
        self.db.flush()
        self.db.refresh(revoked_token)
        return revoked_token

    def is_token_revoked(self, jti: str) -> bool:
        statement = select(RevokedToken).where(RevokedToken.jti == jti)
        return self.db.scalar(statement) is not None
