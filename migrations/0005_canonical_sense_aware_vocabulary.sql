-- B5.4: preserve legacy source rows and migrate every vocabulary card to a canonical catalog ID.
-- Do not edit or rerun migrations 0001-0004 on an existing database.

DROP INDEX idx_vocabulary_catalog_source_identity;
DROP INDEX idx_vocabulary_catalog_level;
DROP INDEX idx_vocabulary_catalog_normalized_key;
DROP INDEX idx_vocabulary_catalog_id_key;
ALTER TABLE vocabulary_catalog RENAME TO vocabulary_catalog_sources;
CREATE UNIQUE INDEX idx_vocabulary_catalog_sources_id_key
  ON vocabulary_catalog_sources(id, normalized_key);

CREATE TABLE vocabulary_catalog (
  id TEXT PRIMARY KEY,
  headword TEXT NOT NULL,
  normalized_key TEXT NOT NULL CHECK (normalized_key <> '' AND normalized_key = lower(trim(normalized_key))),
  part_of_speech TEXT,
  part_of_speech_key TEXT NOT NULL DEFAULT 'unknown' CHECK (part_of_speech_key <> '' AND part_of_speech_key = lower(trim(part_of_speech_key))),
  sense_key TEXT NOT NULL DEFAULT 'legacy' CHECK (sense_key <> ''),
  semantic_sense TEXT NOT NULL DEFAULT 'Legacy catalog entry',
  cefr_level TEXT CHECK (cefr_level IS NULL OR cefr_level IN ('A1', 'A2', 'B1', 'B2')),
  source_dataset TEXT NOT NULL,
  source_version TEXT NOT NULL,
  provenance TEXT NOT NULL,
  zh_tw_definition TEXT,
  english_example TEXT,
  zh_tw_example_translation TEXT,
  irish_usage TEXT,
  publication_status TEXT NOT NULL DEFAULT 'published' CHECK (publication_status IN ('published', 'review_needed')),
  owner_user_id TEXT,
  model TEXT,
  prompt_version TEXT,
  content_version INTEGER NOT NULL DEFAULT 1 CHECK (content_version > 0),
  content_hash TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((publication_status = 'published' AND owner_user_id IS NULL)
    OR (publication_status = 'review_needed' AND owner_user_id IS NOT NULL))
);

-- Identical complete CEFR-J content across levels maps to one canonical row. Incomplete
-- source rows remain distinct because their semantic sense cannot be inferred safely.
WITH source_rows AS (
  SELECT source.*,
    lower(trim(COALESCE(NULLIF(trim(source.part_of_speech), ''), 'unknown'))) AS pos_key,
    CASE WHEN NULLIF(trim(source.zh_tw_definition), '') IS NOT NULL
        AND NULLIF(trim(source.english_example), '') IS NOT NULL
        AND NULLIF(trim(source.zh_tw_example_translation), '') IS NOT NULL
      THEN 'legacy:' || lower(trim(source.zh_tw_definition)) || '|' ||
        lower(trim(source.english_example)) || '|' || lower(trim(source.zh_tw_example_translation))
      ELSE 'legacy-source:' || source.id END AS legacy_sense_key
  FROM vocabulary_catalog_sources AS source
), ranked AS (
  SELECT source_rows.*,
    ROW_NUMBER() OVER (PARTITION BY normalized_key, pos_key, legacy_sense_key ORDER BY id) AS row_number
  FROM source_rows
)
INSERT INTO vocabulary_catalog (id, headword, normalized_key, part_of_speech, part_of_speech_key,
  sense_key, semantic_sense, cefr_level, source_dataset, source_version, provenance,
  zh_tw_definition, english_example, zh_tw_example_translation, irish_usage,
  publication_status, owner_user_id, content_version, content_hash, published_at, created_at, updated_at)
SELECT id, headword, normalized_key, part_of_speech, pos_key, legacy_sense_key,
  'Legacy CEFR-J sense; matched using its published lexical content.', cefr_level,
  source_dataset, source_version, provenance, zh_tw_definition, english_example,
  zh_tw_example_translation, irish_usage, 'published', NULL, 1, NULL, created_at, created_at, updated_at
FROM ranked WHERE row_number = 1;

ALTER TABLE vocabulary_catalog_sources ADD COLUMN canonical_catalog_id TEXT REFERENCES vocabulary_catalog(id);
UPDATE vocabulary_catalog_sources AS source SET canonical_catalog_id = (
  SELECT catalog.id FROM vocabulary_catalog AS catalog
  WHERE catalog.normalized_key = source.normalized_key
    AND catalog.part_of_speech_key = lower(trim(COALESCE(NULLIF(trim(source.part_of_speech), ''), 'unknown')))
    AND catalog.sense_key = CASE WHEN NULLIF(trim(source.zh_tw_definition), '') IS NOT NULL
        AND NULLIF(trim(source.english_example), '') IS NOT NULL
        AND NULLIF(trim(source.zh_tw_example_translation), '') IS NOT NULL
      THEN 'legacy:' || lower(trim(source.zh_tw_definition)) || '|' ||
        lower(trim(source.english_example)) || '|' || lower(trim(source.zh_tw_example_translation))
      ELSE 'legacy-source:' || source.id END
);

CREATE TABLE vocabulary_catalog_versions (
  id TEXT PRIMARY KEY,
  catalog_id TEXT NOT NULL REFERENCES vocabulary_catalog(id),
  version INTEGER NOT NULL CHECK (version > 0),
  content_hash TEXT,
  zh_tw_definition TEXT,
  english_example TEXT,
  zh_tw_example_translation TEXT,
  irish_usage TEXT,
  provenance TEXT NOT NULL,
  model TEXT,
  prompt_version TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_vocabulary_catalog_versions_version ON vocabulary_catalog_versions(catalog_id, version);
INSERT INTO vocabulary_catalog_versions (id, catalog_id, version, content_hash, zh_tw_definition,
  english_example, zh_tw_example_translation, irish_usage, provenance, model, prompt_version, created_at)
SELECT lower(hex(randomblob(16))), id, content_version, content_hash, zh_tw_definition,
  english_example, zh_tw_example_translation, irish_usage, provenance, model, prompt_version, created_at
FROM vocabulary_catalog;

CREATE TABLE vocabulary_catalog_candidates (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  source_item_id TEXT NOT NULL,
  headword TEXT NOT NULL,
  normalized_key TEXT NOT NULL CHECK (normalized_key <> '' AND normalized_key = lower(trim(normalized_key))),
  part_of_speech TEXT NOT NULL,
  part_of_speech_key TEXT NOT NULL CHECK (part_of_speech_key <> '' AND part_of_speech_key = lower(trim(part_of_speech_key))),
  sense_key TEXT NOT NULL CHECK (sense_key <> ''),
  semantic_sense TEXT NOT NULL,
  source_context TEXT NOT NULL,
  target_catalog_id TEXT REFERENCES vocabulary_catalog(id),
  zh_tw_definition TEXT,
  english_example TEXT,
  zh_tw_example_translation TEXT,
  irish_usage TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft', 'review_needed', 'published', 'rejected')),
  catalog_id TEXT REFERENCES vocabulary_catalog(id),
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  validation_status TEXT NOT NULL CHECK (validation_status IN ('passed', 'review_needed', 'not_run')),
  validation_confidence REAL,
  provenance TEXT NOT NULL,
  content_hash TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_vocabulary_catalog_published_sense
  ON vocabulary_catalog(normalized_key, part_of_speech_key, sense_key)
  WHERE publication_status = 'published';
CREATE UNIQUE INDEX idx_vocabulary_catalog_private_sense
  ON vocabulary_catalog(owner_user_id, normalized_key, part_of_speech_key, sense_key)
  WHERE publication_status = 'review_needed';
CREATE INDEX idx_vocabulary_catalog_level ON vocabulary_catalog(cefr_level, id);
CREATE INDEX idx_vocabulary_catalog_normalized_key ON vocabulary_catalog(normalized_key, part_of_speech_key);
CREATE UNIQUE INDEX idx_vocabulary_catalog_id_key ON vocabulary_catalog(id, normalized_key);
CREATE UNIQUE INDEX idx_vocabulary_catalog_sources_source_identity
  ON vocabulary_catalog_sources(source_dataset, source_version, cefr_level, normalized_key, COALESCE(part_of_speech, ''));
CREATE INDEX idx_vocabulary_catalog_candidates_review ON vocabulary_catalog_candidates(status, created_at);
CREATE UNIQUE INDEX idx_vocabulary_catalog_candidates_retry
  ON vocabulary_catalog_candidates(owner_user_id, source_item_id, normalized_key, part_of_speech_key, sense_key);

-- Preserve old personal entries as private canonical records so their existing cards still resolve.
INSERT INTO vocabulary_catalog (id, headword, normalized_key, part_of_speech, part_of_speech_key,
  sense_key, semantic_sense, cefr_level, source_dataset, source_version, provenance,
  zh_tw_definition, english_example, zh_tw_example_translation, irish_usage,
  publication_status, owner_user_id, content_version, content_hash, published_at, created_at, updated_at)
SELECT 'legacy-' || item.id, item.headword, item.normalized_key, item.part_of_speech,
  lower(trim(COALESCE(NULLIF(trim(item.part_of_speech), ''), 'unknown'))), 'legacy-user:' || item.id,
  'Legacy personal vocabulary; semantic sense not verified.', NULL,
  'legacy-user-vocabulary', '0005', COALESCE(item.source, 'Migrated from user_vocabulary_items'),
  item.zh_tw_definition, item.english_example, item.zh_tw_example_translation, item.irish_usage,
  'review_needed', item.user_id, 1, NULL, NULL, item.created_at, item.updated_at
FROM user_vocabulary_items AS item;

INSERT INTO vocabulary_catalog_versions (id, catalog_id, version, content_hash, zh_tw_definition,
  english_example, zh_tw_example_translation, irish_usage, provenance, model, prompt_version, created_at)
SELECT lower(hex(randomblob(16))), id, content_version, content_hash, zh_tw_definition,
  english_example, zh_tw_example_translation, irish_usage, provenance, model, prompt_version, created_at
FROM vocabulary_catalog WHERE publication_status = 'review_needed';

DROP INDEX idx_flashcards_user_id_created_at;
DROP INDEX idx_flashcards_user_id_card_type;
DROP INDEX idx_flashcards_user_id_last_reviewed_at;
DROP INDEX idx_flashcards_user_id_is_favorite;
DROP INDEX idx_flashcards_user_catalog;
DROP INDEX idx_flashcards_user_personal_vocabulary;
DROP INDEX idx_flashcards_user_vocabulary_key;
DROP INDEX idx_review_events_user_id_reviewed_at;
ALTER TABLE flashcards RENAME TO flashcards_legacy;
ALTER TABLE review_events RENAME TO review_events_legacy;

CREATE TABLE flashcards_canonical (
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
  vocabulary_catalog_id TEXT REFERENCES vocabulary_catalog(id),
  CHECK ((card_type = 'vocabulary' AND vocabulary_catalog_id IS NOT NULL
      AND front_content IS NULL AND back_content IS NULL AND part_of_speech IS NULL
      AND zh_tw_definition IS NULL AND explanation IS NULL AND irish_usage IS NULL AND source IS NULL)
    OR (card_type = 'error_log' AND vocabulary_catalog_id IS NULL
      AND front_content IS NOT NULL AND back_content IS NOT NULL))
);

CREATE TABLE review_events_canonical (
  id TEXT PRIMARY KEY,
  client_event_id TEXT UNIQUE NOT NULL,
  user_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  review_result TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO flashcards_canonical (id, user_id, source_item_id, card_type, front_content, back_content,
  part_of_speech, zh_tw_definition, explanation, irish_usage, source, is_favorite,
  last_reviewed_at, next_review_at, created_at, updated_at, vocabulary_catalog_id)
SELECT card.id, card.user_id, card.source_item_id, card.card_type,
  CASE WHEN card.card_type = 'error_log' THEN card.front_content ELSE NULL END,
  CASE WHEN card.card_type = 'error_log' THEN card.back_content ELSE NULL END,
  CASE WHEN card.card_type = 'error_log' THEN card.part_of_speech ELSE NULL END,
  CASE WHEN card.card_type = 'error_log' THEN card.zh_tw_definition ELSE NULL END,
  CASE WHEN card.card_type = 'error_log' THEN card.explanation ELSE NULL END,
  CASE WHEN card.card_type = 'error_log' THEN card.irish_usage ELSE NULL END,
  CASE WHEN card.card_type = 'error_log' THEN card.source ELSE NULL END,
  card.is_favorite, card.last_reviewed_at, card.next_review_at, card.created_at, card.updated_at,
  CASE WHEN card.card_type = 'vocabulary' THEN COALESCE(source.canonical_catalog_id, 'legacy-' || personal.id) ELSE NULL END
FROM flashcards_legacy AS card
LEFT JOIN vocabulary_catalog_sources AS source ON source.id = card.vocabulary_catalog_id
LEFT JOIN user_vocabulary_items AS personal
  ON personal.id = card.user_vocabulary_item_id AND personal.user_id = card.user_id;

INSERT INTO review_events_canonical SELECT * FROM review_events_legacy;
DROP TABLE review_events_legacy;
DROP TABLE flashcards_legacy;
ALTER TABLE flashcards_canonical RENAME TO flashcards;
ALTER TABLE review_events_canonical RENAME TO review_events;

CREATE INDEX idx_flashcards_user_id_created_at ON flashcards(user_id, created_at);
CREATE INDEX idx_flashcards_user_id_card_type ON flashcards(user_id, card_type);
CREATE INDEX idx_flashcards_user_id_last_reviewed_at ON flashcards(user_id, last_reviewed_at);
CREATE INDEX idx_flashcards_user_id_is_favorite ON flashcards(user_id, is_favorite);
CREATE UNIQUE INDEX idx_flashcards_user_catalog ON flashcards(user_id, vocabulary_catalog_id)
  WHERE vocabulary_catalog_id IS NOT NULL;
CREATE INDEX idx_review_events_user_id_reviewed_at ON review_events(user_id, reviewed_at);
