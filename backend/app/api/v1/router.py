from fastapi import APIRouter

from app.api.v1 import auth, flashcards, reviews, settings, stats

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(flashcards.router)
api_router.include_router(reviews.router)
api_router.include_router(settings.router)
api_router.include_router(stats.router)
