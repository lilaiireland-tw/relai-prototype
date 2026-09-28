# ReLai D1 migrations

This repository-root directory is the only source of truth for ReLai v1 D1
schema changes. Issue #22 established the workflow; Issue #24 adds
`0001_initial_core_schema.sql` for the seven PRD-defined core tables and indexes.
Do not add placeholder/no-op migrations.

Future schema tasks create sequential, descriptive SQL files with
`npm run db:migrations:create -- describe_change` from the repository root.
Review the generated filename and SQL, apply locally, smoke-test, and commit
the SQL with its task. Resolve numbering conflicts before merging.

Migration history is append-only. Never edit, rename, reorder, or delete a
committed/applied migration; correct it with a new migration. Wrangler records
applied filenames in `d1_migrations`; keep that history intact. Do not repair
schema through unrecorded Dashboard SQL.

Legacy `infra/supabase`, `database`, and `backend`/Alembic migrations are historical
references, not v1 schema sources. Do not run or copy them into this workflow.

See [D1 migration workflow](../docs/d1-migrations.md) for exact local/staging
commands, production release steps, and safety rules.
