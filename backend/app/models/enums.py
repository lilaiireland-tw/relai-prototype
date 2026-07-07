from enum import Enum


class AuthProvider(str, Enum):
    GOOGLE = "google"
    APPLE = "apple"
    EMAIL = "email"


class CardType(str, Enum):
    VOCABULARY = "vocabulary"
    ERROR_LOG = "error_log"


class CardSource(str, Enum):
    USER_INPUT = "user_input"
    IELTS_QUIZ = "ielts_quiz"
    ONBOARDING = "onboarding"


class CohortSource(str, Enum):
    LILAI_REFERRAL = "lilai_referral"
    ORGANIC = "organic"


class ReviewRating(str, Enum):
    AGAIN = "again"
    HARD = "hard"
    GOOD = "good"
    EASY = "easy"


class InputChannel(str, Enum):
    TEXT = "text"
    OCR = "ocr"
    QUIZ = "quiz"
