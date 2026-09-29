-- Existing accounts remain normal accounts; only explicit provisioning sets the flag.
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
