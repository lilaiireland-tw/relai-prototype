-- Issue #63: CEFR-J A1-B2 catalog and future vocabulary identity.
-- No catalog rows or personal cards are inserted by this migration.
CREATE TABLE vocabulary_catalog (
  id TEXT PRIMARY KEY,
  headword TEXT NOT NULL,
  normalized_key TEXT NOT NULL CHECK (normalized_key <> '' AND normalized_key = lower(trim(normalized_key))),
  part_of_speech TEXT,
  cefr_level TEXT NOT NULL CHECK (cefr_level IN ('A1', 'A2', 'B1', 'B2')),
  source_dataset TEXT NOT NULL,
  source_version TEXT NOT NULL,
  provenance TEXT NOT NULL,
  zh_tw_definition TEXT,
  english_example TEXT,
  zh_tw_example_translation TEXT,
  irish_usage TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- COALESCE makes entries without a supplied part of speech unique too.
CREATE UNIQUE INDEX idx_vocabulary_catalog_source_identity
  ON vocabulary_catalog (source_dataset, source_version, cefr_level, normalized_key, COALESCE(part_of_speech, ''));
CREATE INDEX idx_vocabulary_catalog_level ON vocabulary_catalog (cefr_level, id);
CREATE INDEX idx_vocabulary_catalog_normalized_key ON vocabulary_catalog (normalized_key);

ALTER TABLE user_settings ADD COLUMN english_level TEXT
  CHECK (english_level IS NULL OR english_level IN ('A1', 'A2', 'B1', 'B2'));

ALTER TABLE flashcards ADD COLUMN vocabulary_catalog_id TEXT
  REFERENCES vocabulary_catalog(id)
  CHECK (vocabulary_catalog_id IS NULL OR card_type = 'vocabulary');
ALTER TABLE flashcards ADD COLUMN vocabulary_key TEXT
  CHECK (vocabulary_key IS NULL OR (card_type = 'vocabulary' AND vocabulary_key <> ''
    AND vocabulary_key = lower(trim(vocabulary_key))));

-- Nullable columns preserve existing cards. Bootstrap and Phase 5 supply identities.
CREATE UNIQUE INDEX idx_flashcards_user_catalog
  ON flashcards (user_id, vocabulary_catalog_id)
  WHERE vocabulary_catalog_id IS NOT NULL;
CREATE UNIQUE INDEX idx_flashcards_user_vocabulary_key
  ON flashcards (user_id, vocabulary_key)
  WHERE card_type = 'vocabulary' AND vocabulary_key IS NOT NULL;
