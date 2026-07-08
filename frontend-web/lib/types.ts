export type ApiError = {
  detail?: string;
};

export type UserProfile = {
  id: string;
  email: string;
  display_name: string | null;
  auth_provider: string;
  provider_subject: string | null;
  avatar_url: string | null;
  is_active: boolean;
  onboarding_completed: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
};

export type UserStats = {
  user_id: string;
  streak_days: number;
  last_active_date: string | null;
  total_cards_created: number;
  total_reviews: number;
  badges_unlocked: string[];
  cohort_source: string;
  updated_at: string;
};

export type UserSettings = {
  user_id: string;
  interface_language: string;
  timezone: string;
  daily_review_goal: number;
  review_reminder_enabled: boolean;
};

export type AuthBootstrap = {
  profile: UserProfile;
  settings: UserSettings;
  stats: UserStats;
};

export type AuthToken = {
  access_token: string;
  token_type: string;
  expires_at: string;
};

export type Flashcard = {
  id: string;
  user_id: string;
  card_type: "vocabulary" | "error_log";
  front_content: string;
  back_content: string;
  part_of_speech: string | null;
  zh_tw_definition: string | null;
  explanation: string | null;
  irish_usage: string | null;
  example_sentence: string | null;
  source: string | null;
  is_favorite: boolean;
  is_archived: boolean;
  last_reviewed_at: string | null;
  next_review_at: string | null;
  created_at: string;
  updated_at: string;
};

export type FlashcardListResponse = {
  items: Flashcard[];
  total: number;
};
