# Issue #112: review and one-time staging import

## Delivery and release hold

This PR prepares the importer and new runtime. It authorizes **no remote operation**. Do not merge or let Workers Builds publish this version until the PO has reviewed the data, separately authorized the specific staging import and bounded verification, and confirmed all 80 entries are complete. If Builds currently publishes `develop` automatically, keep this PR unmerged as the release hold. Do not disable existing safety gates or change Dashboard settings as part of this task. Production, migrations, Gemini, Queue and R2 are outside scope.

Order: review these artifacts → PO approves one specific staging operation → protected backup/preflight → import → separately authorized exact-ID verification → PO confirms readiness → human PR review/checks/merge → existing staging publication. No migration is required. Missing/incomplete Starter data deliberately produces 503; deploying before import would block new learners.

## Inputs, mapping and offline result

The actual local files were found at repository root (31,152-byte CSV and 8,175,810-byte SQL export) and moved intact to gitignored `data/catalog-local/relai_dict_fix.csv` and `data/catalog-local/vocabulary_catalog_export.sql`. Neither file nor the private report is committed. Keep this directory on a protected local disk; restrict Windows ACLs to the operator before apply (POSIX file modes alone do not restrict Windows access). Do not upload the raw dump, CSV, backup or full plan to GitHub/CI.

Actual CSV headers, in order:

```text
id,headword,part_of_speech,cefr_level,source_dataset,publication_status,semantic_sense,sense_key,原始中文解釋,建議字典釋義,原始例句中文,建議例句中文,英文例句,解釋是否修改,例句是否修改,審核狀態,校稿說明,content_version,content_hash
```

| Source | Target / treatment |
| --- | --- |
| id | Exact immutable Catalog primary key; duplicates/missing IDs fail |
| headword, part_of_speech, cefr_level, source_dataset, publication_status, semantic_sense, sense_key | Identity checks against snapshot; never updated |
| content_version, content_hash | Snapshot equality checks, including blank/null hash |
| 原始中文解釋, 原始例句中文 | Exact old-value checks |
| 建議字典釋義 | zh_tw_definition, only if supplied and different |
| 英文例句 | english_example, only if supplied and different |
| 建議例句中文 | zh_tw_example_translation, only if supplied and different |
| 解釋是否修改, 例句是否修改, 審核狀態, 校稿說明 | Review annotations; actual field comparison determines changes |

`snapshot` also supplies source_version, owner, normalized key, updated_at and all preserved columns for preflight. No spelling-only matching is used.

Offline dry run against the supplied files:

| Measure | Count |
| --- | ---: |
| CSV rows traced | 52 |
| Published rows changed | 47 |
| Published rows unchanged | 4 |
| Private review_needed rows deferred | 1 |
| Changed definition fields | 39 |
| Changed example translation fields | 31 |
| Changed English examples | 0 |
| Missing Starter entries to complete | 60 |
| Total unique Catalog updates proposed | 107 |
| New Catalog entries | 0 |
| Remote operations performed | 0 |

The private row has no lexical differences and remains pending separately; its immutable ID, owner and content appear **only** in the local trace. It is excluded from apply and public artifacts. The 51 public input rows are traceable in [correction-diff.csv](correction-diff.csv), including unchanged rows. Snapshot version/hash/time and each actual old/new field are included. All 20 B1 rows use the accepted corrections, never old seed definitions.

The full local `report/plan.json` traces all 52 inputs and proposes only exact changed fields plus missing Starter content. `report/summary.json` records counts and risk. Conflicting or malformed input fails before remote access. No full SQL dump is ever sent to D1.

The actual supplied snapshot was also replayed into an isolated local SQLite database with original version history. The CLI applied exactly 107 updates; its second apply reported 0 writes / 107 unchanged. Offline assertions verified all other snapshot rows remained byte-for-value unchanged, protected identity/ownership fields were preserved, and prior history remained intact. The separate real local D1 test uses public/synthetic fixtures so ordinary CI never needs the protected snapshot.

## Starter selection and content review

[starter-review.csv](starter-review.csv) is the 80-row human review table and **one-time operator input**, not a runtime seed. It contains only public canonical entries, their original IDs/POS/level/source/sense, definition, English example, translation, patterns and existing/completion action. All 80 IDs already exist in the supplied Catalog snapshot. A1/A2/B2 need lexical completion; B1 only needs approved corrections. Proposed completion content is authored offline for PO review, without AI calls. Patterns remain `[]` where no useful collocation is required. No complete existing content is unconditionally overwritten.

Sampling uses Python 3.12 `random.Random('relai-112-2026-11-12:' + level).shuffle`, with candidates initially sorted by ID. Pools contain published, unowned CEFR-J 1.6 entries at the selected level, noun/verb/adjective/adverb, alphabetic headwords longer than two letters. B1 headwords are excluded first, then previously selected A1/A2 words to avoid cross-level duplicates. After quality screening, take the first 20 eligible candidates in shuffled order. Reproduce and assert the committed IDs offline:

```powershell
python scripts/select-starter-catalog.py --snapshot data/catalog-local/vocabulary_catalog_export.sql
```

| Level | A–F | G–L | M–R | S–Z |
| --- | ---: | ---: | ---: | ---: |
| A1 | 8 | 3 | 3 | 6 |
| A2 | 8 | 3 | 6 | 3 |
| B1 (original IDs retained) | 20 | 0 | 0 | 0 |
| B2 | 8 | 2 | 5 | 5 |

Recorded replacements (continue along the same shuffled pool; no new seed): A1 `short` (adverb) and `wake` (noun) have less suitable beginner POS/senses; `judge` (verb) was replaced for more concrete beginner vocabulary. A2 `yeah` was replaced by standard register vocabulary, `spaceship` by more everyday vocabulary. B2 `mystify`, `Soviet`, `slaughter`, `funk`, `ballad` were replaced for everyday usefulness, historical specificity, sensitive content or ambiguous musical/register senses. The resulting table retains all four letter bands. B1's existing alphabetical concentration is intentionally preserved by PO decision.

The source whitelist is shuffled and immutable after review. B1 retains the same 20 IDs, shuffled using `relai-112-2026-11-12:B1`; its original A-only letter distribution is unchanged. Existing Cards UI sorting by created_at/ID remains unchanged; presentation order is not guaranteed to follow whitelist order.

## Operator commands and safeguards

Default offline dry run (no credentials or Cloudflare connection):

```powershell
npm.cmd run catalog:correct -- --snapshot data/catalog-local/vocabulary_catalog_export.sql --corrections data/catalog-local/relai_dict_fix.csv
```

Optional apply to an **explicit isolated local SQLite database** already initialized with repository migrations and the same snapshot rows:

```powershell
npm.cmd run catalog:correct -- --snapshot data/catalog-local/vocabulary_catalog_export.sql --corrections data/catalog-local/relai_dict_fix.csv --apply --local-db data/catalog-local/isolated.sqlite
```

Tests additionally exercise real ephemeral local D1 using a fake local-only binding, empty credentials, no secret files, remote bindings disabled and outbound network blocked. They run 52 synthetic corrections plus 60 completions, history failure/rollback, rerun and four-level initialization. Ordinary checks do not depend on the private local files.

Only **after separate PO authorization for that precise staging import**, an operator with least-privilege staging D1 access may run the following in an approved operator shell. The two opt-ins confirm risk; they do not grant authorization. Never put these credentials/opt-ins in Codex routine commands, CI, Builds or persistent environment configuration:

```powershell
$env:RELAI_REMOTE_CLOUDFLARE_APPROVAL = 'I_UNDERSTAND_REMOTE_CLOUDFLARE_COSTS_AND_IMPACT'
try {
  npm.cmd run catalog:correct -- --snapshot data/catalog-local/vocabulary_catalog_export.sql --corrections data/catalog-local/relai_dict_fix.csv --apply --remote --confirm-staging relai-staging-db --approve-remote-cloudflare
} finally {
  Remove-Item Env:RELAI_REMOTE_CLOUDFLARE_APPROVAL
}
```

The existing platform adapter verifies staging is distinct from production and constructs a D1-only temporary staging config without routes, assets or secrets. Its existing `SELECT 1` backend probe is retained. Dry-run cannot connect remotely. No broad catalog reads are made remotely.

Before writing, the importer reads each of the 107 proposed IDs by primary key and compares **all snapshot columns**, including content_version/hash, lexical old values, identity/ownership, provenance and updated_at. Any mismatch halts the entire preflight without writes. Already-applied identical new content/hash/version/provenance with preserved identity is reported unchanged, without incrementing version. A changed timestamp alone on an otherwise already-applied row is tolerated on rerun. Every actual pending row's exact old/new values is written to an exclusive local backup before the first write; restore/recovery must use those values and separate PO authorization, never replay the full dump.

Each bounded transaction contains one exact-ID old-row assertion, one prepared UPDATE of the three lexical columns (unchanged values retained) plus version +1/hash/provenance/updated_at, and one new history snapshot. Hash uses the existing `vocabularyContentHash()` unchanged; provenance wraps and retains the original source. A concurrent drift assertion or history failure rolls back the whole affected row. Earlier successful row transactions remain committed, are recorded in a per-run JSONL receipt, and are skipped on rerun. The importer stops at the first error and records it; review that receipt before retrying. Never run the legacy B1 seed importer to repair an already versioned correction: it may reject the enriched provenance and is not the #112 delivery path.

Estimated bounded access for 107 pending rows: 107 preflight primary-key reads, 107 transaction assertion lookups, 107 exact-ID updates, 107 exact-ID history SELECT/INSERTs, plus the existing backend probe and index maintenance. Each row's batch has three statements and stays below 100 bound parameters per statement. Actual D1 billed reads/writes may differ. No remote application counts, scans, schema checks, migration, production binding or flashcard writes are involved in the importer.

## Separately authorized verification and acceptance

The import receipt is not independent final acceptance. After a successful import, obtain separate PO authorization for bounded verification of the exact 107 changed IDs and all 80 Starter IDs. Verify expected values/hash/version, one new history record per updated ID and preservation of old history; compare any approved unchanged sample only by exact ID. Private content remains unmodified/unpublished. Stop if any identity or data conflict occurs.

New authenticated test accounts selecting A1/A2/B1/B2 must each get 20 matching-level complete Catalog-linked cards; repeat returns zero and changing initial level returns 409. Check B1 demo content, existing accounts' cards/favorites/reviews/statistics and missing-content rollback. Any remote account creation, API smoke or verification read/write requires its own explicit scope/authorization; none is executed in this PR. PO supplies final data/content acceptance and release approval.

Prompt preservation evidence: `src/worker/services/vocabulary-catalog.ts` remains an uncommitted PO modification, excluded from the PR. Its SHA-256 matches the pre-implementation local copy: `084292B0AE70407380A8B0A0B8A50D9026219085341B7A7704075E0176A70C14`. `git diff --cached -- src/worker/services/vocabulary-catalog.ts src/worker/services/vocabulary-image.ts` is empty. No Prompt, prompt version or Gemini recognition changes belong to this PR. The original working directory's test suite has one existing failure because `vocabulary.test.ts:377` requires the old Prompt wording verbatim. The PR contents are validated in a separate detached checkout using the unchanged committed Prompt; the PO's working file is never replaced for testing.
