from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.schemas.flashcard import FlashcardCreateRequest, FlashcardListResponse, FlashcardResponse
from app.schemas.user import CurrentUser
from app.services.cards.service import FlashcardService

router = APIRouter(prefix="/flashcards", tags=["flashcards"])


@router.post("", response_model=FlashcardResponse, status_code=201)
def create_flashcard(
    payload: FlashcardCreateRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> FlashcardResponse:
    service = FlashcardService(db)
    flashcard = service.create_flashcard(user_id=current_user.user_id, payload=payload)
    return FlashcardResponse.model_validate(flashcard)


@router.get("", response_model=FlashcardListResponse)
def list_flashcards(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> FlashcardListResponse:
    service = FlashcardService(db)
    items, total = service.list_flashcards(
        user_id=current_user.user_id,
        limit=limit,
        offset=offset,
    )
    return FlashcardListResponse(
        items=[FlashcardResponse.model_validate(item) for item in items],
        total=total,
    )
