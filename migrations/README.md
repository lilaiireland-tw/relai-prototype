# ReLai D1 migrations

This repository-root directory is the only source of truth for ReLai v1 D1
schema changes. `0001_initial_core_schema.sql` creates the seven PRD-defined core
tables and indexes. `0002_add_users_must_change_password.sql` appends an INTEGER
NOT NULL flag with DEFAULT 0; existing users remain normal accounts. Do not add
placeholder/no-op migrations. Check remote migration history before deployment;
the committed files alone do not prove remote application status.

`0003_add_cefr_j_vocabulary_foundation.sql` adds the empty CEFR-J A1–B2 catalog,
nullable user level, and catalog/per-user vocabulary identities on flashcards.
Catalog provenance stays separate from nullable ReLai enrichment. Future import
and bootstrap tasks must supply catalog rows and normalized vocabulary keys;
this migration does not seed data or create cards.

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

`0004_normalize_vocabulary_ownership.sql` makes catalog-backed flashcards
reference catalog content, adds the user-owned `user_vocabulary_items` source,
and leaves Error Log content on user-owned cards. It deletes prototype flashcards,
review events and stats and clears selected levels instead of backfilling; a
separate approved staging operation is required before any remote application.
The migration does not seed catalog data or personal vocabulary.

`0005_canonical_sense_aware_vocabulary.sql` archives original CEFR-J source
rows, creates canonical sense-aware records with provenance and content versions,
and rebuilds vocabulary flashcards to reference only a catalog ID plus user
learning state. It migrates legacy personal cards to private review-needed
catalog rows and preserves users, sessions, source/onboarding records, settings,
stats, favorites and review history. It must be applied only to a database that
has completed 0001–0004; never rerun historical migrations. Because the old and
new Worker schemas are incompatible, staging migration and matching Worker
release must be coordinated by an operator. See the B5.4 section in
[the migration workflow](../docs/d1-migrations.md) for backup, rehearsal and
verification steps. No remote D1 migration is performed by ordinary tests, CI,
build or deployment.
