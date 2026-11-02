-- Issue #93: durable image vocabulary jobs and optional canonical usage patterns.
ALTER TABLE vocabulary_catalog ADD COLUMN usage_patterns TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(usage_patterns) AND json_type(usage_patterns) = 'array');
ALTER TABLE vocabulary_catalog_versions ADD COLUMN usage_patterns TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(usage_patterns) AND json_type(usage_patterns) = 'array');
ALTER TABLE vocabulary_catalog_candidates ADD COLUMN usage_patterns TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(usage_patterns) AND json_type(usage_patterns) = 'array');

CREATE TABLE image_vocabulary_jobs (
  job_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  idempotency_key TEXT NOT NULL,
  image_hash TEXT NOT NULL,
  image_key TEXT,
  mime_type TEXT NOT NULL,
  quota_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('received', 'queued', 'recognizing', 'recognized', 'enriching', 'saving', 'completed', 'failed', 'needs_attention')),
  stage TEXT NOT NULL,
  recognized_json TEXT CHECK (recognized_json IS NULL OR json_valid(recognized_json)),
  plans_json TEXT CHECK (plans_json IS NULL OR json_valid(plans_json)),
  results_json TEXT CHECK (results_json IS NULL OR json_valid(results_json)),
  provider_stage TEXT,
  provider_state TEXT NOT NULL DEFAULT 'none' CHECK (provider_state IN ('none', 'started', 'completed', 'unknown')),
  provider_results_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(provider_results_json)),
  ai_model TEXT,
  error_code TEXT,
  lease_token TEXT,
  lease_until TEXT,
  lease_attempts INTEGER NOT NULL DEFAULT 0,
  dispatch_attempts INTEGER NOT NULL DEFAULT 0,
  next_dispatch_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX idx_image_vocabulary_jobs_user_created ON image_vocabulary_jobs(user_id, created_at DESC);
CREATE INDEX idx_image_vocabulary_jobs_dispatch ON image_vocabulary_jobs(status, next_dispatch_at);
CREATE INDEX idx_image_vocabulary_jobs_lease ON image_vocabulary_jobs(status, lease_until);

CREATE TRIGGER image_vocabulary_jobs_daily_limit
BEFORE INSERT ON image_vocabulary_jobs
WHEN (SELECT COUNT(*) FROM image_vocabulary_jobs
  WHERE user_id = NEW.user_id AND quota_date = NEW.quota_date) >= 5
BEGIN
  SELECT RAISE(ABORT, 'DAILY_IMAGE_LIMIT_REACHED');
END;
