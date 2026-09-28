-- Issue #24: PRD v3.1 core schema. Append-only; do not modify after commit/apply.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_digest TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  is_active INTEGER NOT NULL DEFAULT 1,
  cohort_source TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_digest TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT
);

CREATE TABLE source_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  raw_text TEXT,
  processing_status TEXT NOT NULL,
  ai_model TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE flashcards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source_item_id TEXT,
  card_type TEXT NOT NULL,
  front_content TEXT NOT NULL,
  back_content TEXT NOT NULL,
  part_of_speech TEXT,
  zh_tw_definition TEXT,
  explanation TEXT,
  irish_usage TEXT,
  source TEXT,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  last_reviewed_at TEXT,
  next_review_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE review_events (
  id TEXT PRIMARY KEY,
  client_event_id TEXT UNIQUE NOT NULL,
  user_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  review_result TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE user_stats (
  user_id TEXT PRIMARY KEY,
  streak_days INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  total_cards_created INTEGER NOT NULL DEFAULT 0,
  total_reviews INTEGER NOT NULL DEFAULT 0,
  last_active_date TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE user_settings (
  user_id TEXT PRIMARY KEY,
  daily_goal INTEGER NOT NULL DEFAULT 10,
  timezone TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- UNIQUE constraints already index users(username), sessions(token_digest),
-- and review_events(client_event_id); avoid redundant indexes for those keys.
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX idx_flashcards_user_id_created_at ON flashcards(user_id, created_at);
CREATE INDEX idx_flashcards_user_id_card_type ON flashcards(user_id, card_type);
CREATE INDEX idx_flashcards_user_id_last_reviewed_at ON flashcards(user_id, last_reviewed_at);
CREATE INDEX idx_flashcards_user_id_is_favorite ON flashcards(user_id, is_favorite);
CREATE INDEX idx_review_events_user_id_reviewed_at ON review_events(user_id, reviewed_at);
