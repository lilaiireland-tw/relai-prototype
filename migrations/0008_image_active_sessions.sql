-- Indexed per-user admission and event-driven timeout; no data rewrite or deletion.
CREATE INDEX idx_image_vocabulary_jobs_active_user ON image_vocabulary_jobs(user_id, created_at DESC)
  WHERE status IN ('received', 'queued', 'recognizing', 'recognized', 'enriching', 'saving');
