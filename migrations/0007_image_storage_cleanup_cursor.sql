CREATE TABLE image_storage_cleanup_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  cursor TEXT
);
