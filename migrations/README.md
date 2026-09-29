# ReLai D1 migrations

This repository-root directory is the only source of truth for ReLai v1 D1
schema changes. `0001_initial_core_schema.sql` creates the seven PRD-defined core
tables and indexes. `0002_add_users_must_change_password.sql` appends an INTEGER
NOT NULL flag with DEFAULT 0; existing users remain normal accounts. Do not add
placeholder/no-op migrations. Check remote migration history before deployment;
the committed files alone do not prove remote application status.

Future schema tasks create sequential, descriptive SQL files with
`npm run db:migrations:create -- describe_change` from the repository root.
Review the generated filename and SQL, apply locally, smoke-test, and commit
the SQL with its task. Resolve numbering conflicts before merging.

Migration history is append-only. Never edit, rename, reorder, or delete a
committed/applied migration; correct it with a new migration. Wrangler records
applied filenames in `d1_migrations`; keep that history intact. Do not repair
schema through unrecorded Dashboard SQL.

See [D1 migration workflow](../docs/d1-migrations.md) for exact local/staging
commands, production release steps, and safety rules.
