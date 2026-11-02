-- B5.1: existing prototype learning records are disposable; reset them instead of backfilling.
DELETE FROM review_events;
DELETE FROM flashcards;
DELETE FROM user_stats;
UPDATE user_settings SET english_level = NULL;

CREATE TABLE user_vocabulary_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  headword TEXT NOT NULL,
  normalized_key TEXT NOT NULL CHECK (normalized_key <> '' AND normalized_key = lower(trim(normalized_key))),
  part_of_speech TEXT,
  zh_tw_definition TEXT,
  english_example TEXT,
  zh_tw_example_translation TEXT,
  irish_usage TEXT,
  source TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (id, user_id, normalized_key),
  UNIQUE (user_id, normalized_key)
);

CREATE UNIQUE INDEX idx_vocabulary_catalog_id_key ON vocabulary_catalog(id, normalized_key);

DROP INDEX idx_flashcards_user_id_created_at;
DROP INDEX idx_flashcards_user_id_card_type;
DROP INDEX idx_flashcards_user_id_last_reviewed_at;
DROP INDEX idx_flashcards_user_id_is_favorite;
DROP INDEX idx_flashcards_user_catalog;
DROP INDEX idx_flashcards_user_vocabulary_key;
DROP TABLE flashcards;

CREATE TABLE flashcards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source_item_id TEXT,
  card_type TEXT NOT NULL CHECK (card_type IN ('vocabulary', 'error_log')),
  front_content TEXT,
  back_content TEXT,
  part_of_speech TEXT,
  zh_tw_definition TEXT,
  explanation TEXT,
  irish_usage TEXT,
  source TEXT,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  last_reviewed_at TEXT,
  next_review_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  vocabulary_catalog_id TEXT,
  user_vocabulary_item_id TEXT,
  vocabulary_key TEXT,
  FOREIGN KEY (vocabulary_catalog_id, vocabulary_key) REFERENCES vocabulary_catalog(id, normalized_key),
  FOREIGN KEY (user_vocabulary_item_id, user_id, vocabulary_key)
    REFERENCES user_vocabulary_items(id, user_id, normalized_key),
  CHECK (
    (card_type = 'vocabulary' AND vocabulary_key IS NOT NULL AND vocabulary_key <> ''
      AND vocabulary_key = lower(trim(vocabulary_key))
      AND ((vocabulary_catalog_id IS NOT NULL AND user_vocabulary_item_id IS NULL)
        OR (vocabulary_catalog_id IS NULL AND user_vocabulary_item_id IS NOT NULL))
      AND front_content IS NULL AND back_content IS NULL AND part_of_speech IS NULL
      AND zh_tw_definition IS NULL AND explanation IS NULL AND irish_usage IS NULL AND source IS NULL)
    OR
    (card_type = 'error_log' AND vocabulary_catalog_id IS NULL
      AND user_vocabulary_item_id IS NULL AND vocabulary_key IS NULL
      AND front_content IS NOT NULL AND back_content IS NOT NULL)
  )
);

CREATE INDEX idx_flashcards_user_id_created_at ON flashcards(user_id, created_at);
CREATE INDEX idx_flashcards_user_id_card_type ON flashcards(user_id, card_type);
CREATE INDEX idx_flashcards_user_id_last_reviewed_at ON flashcards(user_id, last_reviewed_at);
CREATE INDEX idx_flashcards_user_id_is_favorite ON flashcards(user_id, is_favorite);
CREATE UNIQUE INDEX idx_flashcards_user_catalog ON flashcards(user_id, vocabulary_catalog_id)
  WHERE vocabulary_catalog_id IS NOT NULL;
CREATE UNIQUE INDEX idx_flashcards_user_personal_vocabulary ON flashcards(user_id, user_vocabulary_item_id)
  WHERE user_vocabulary_item_id IS NOT NULL;
CREATE UNIQUE INDEX idx_flashcards_user_vocabulary_key ON flashcards(user_id, vocabulary_key)
  WHERE card_type = 'vocabulary';
