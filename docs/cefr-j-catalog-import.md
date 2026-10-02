# CEFR-J 1.6 catalog import (Issue #64)

The application catalog uses **CEFR-J Vocabulary Profile / CEFR-J Wordlist Version 1.6**, A1–B2 only. Its author and rights holder is Yukio Tono's laboratory at Tokyo University of Foreign Studies. The official source is [CEFR-J Resources](https://www.cefr-j.org/download.html); the version 1.6 archive is `CEFRJ_wordlist_ver1.6.zip` (24 March 2020). The archive SHA-256 is `c837d2c00ab8954ed8db48e79afd8ef37099570295fec36950dbf9322303a37a`.

**Required source acknowledgement:** “The CEFR-J Wordlist Version 1.6. Compiled by Yukio Tono, Tokyo University of Foreign Studies. Retrieved from https://www.cefr-j.org/download.html on 2026-10-01.” The [publisher's terms](https://www.cefr-j.org/download.html) allow research and commercial use with proper acknowledgement and require citation when making a modified list. Copyright remains with the Tono Laboratory. The site's terms do not explicitly grant repository redistribution of the entire raw workbook, so the workbook and full extracted manifest are downloaded/generated locally and ignored by Git. Before distributing a derived catalog outside this application, review the publisher's current terms and preserve its citation.

The extractor reads the official workbook's `ALL` sheet, which the publisher states has 7,801 POS-level entries: A1 1,166, A2 1,411, B1 2,445, B2 2,779. It does not use the workbook's `*_sep` sheets, grammar profile, Octanove list, Cambridge EVP, or another vocabulary dataset. Counts are checked against this exact release and are not a target to fill with invented words. The importer stores the source dataset, version, and citation in each row. ReLai-owned enrichment columns remain null.

## Local validation

Use Python 3 and Node.js 24 from the repository root. The official archive can be supplied with `--archive` to avoid redownloading it. Both paths verify the pinned hash.

```sh
python scripts/extract-cefr-j-1.6.py --output data/cefr-j-local/cefr-j-1.6.json
npm run db:migrations:apply:local
npm run catalog:import -- --file data/cefr-j-local/cefr-j-1.6.json
npm run catalog:import -- --file data/cefr-j-local/cefr-j-1.6.json
```

The second import reports `inserted: 0`, `skipped: 7801`, `rejected: 0`. The committed `scripts/fixtures/cefr-j-1.6-small.json` has eight real entries spanning A1–B2, including one headword with two parts of speech. It is only a deterministic development/test fixture; use it with a **separate empty local D1 state**, never as the application catalog. For example, run the fixture first in a fresh checkout/local Wrangler state, or use automated tests. The importer refuses to replace a larger same-version catalog with a subset fixture.

Catalog identity follows migration `0003`: trimmed lowercase headword plus CEFR level and part of speech within source dataset/version. The same headword may legitimately appear at different levels or with different POS values; exact identity duplicates fail before any write. IDs are deterministic hashes of dataset, version and identity. Existing same-version rows are compared to source fields before new rows are batched into D1. Different versions and changed same-version rows fail rather than being overwritten. The importer reports counts without logging word content. A failure before writing is safe; a batch failure can be retried after inspection because committed rows have stable IDs. It never creates personal `flashcards`.

## Staging import, after separate authorization

The CLI defaults to **local D1**. An operator can explicitly target the configured staging database after reviewing the migration and source artifact:

```sh
npm run catalog:import -- --file data/cefr-j-local/cefr-j-1.6.json --remote --confirm-staging relai-staging-db
```

The command validates the staging binding's name and ID, including separation from production. For `--remote`, it creates a private temporary Wrangler config containing only staging `DB`, with that binding explicitly set to `remote: true`. Both the resolved binding and `remoteBindings: true` must be enabled: the latter alone does not select remote D1 ([Cloudflare remote bindings](https://developers.cloudflare.com/workers/local-development/#remote-bindings)). No preview database ID is copied. The normal `wrangler.jsonc` is unchanged, so ordinary local development and imports continue using persistent simulated D1.

Before catalog access, remote mode runs only `SELECT 1 AS connectivity_ok` and checks [D1 response metadata](https://developers.cloudflare.com/d1/worker-api/return-object/) for a backend version other than Miniflare, a region, and primary status. Missing/unknown metadata, a local backend, or connection failure stops the import; it never retries locally. The temporary config is removed after disposal or setup failure. If a Wrangler/D1 upgrade changes this metadata, investigate and update the check before importing; do not bypass the guard.

There is no environment/config override, production mode, or runtime import API. Implementation tests use the real Wrangler config resolver, mocked remote responses, and an isolated simulated D1; they do not run this remote command or mutate any remote database. Run the importer tests with `npx vitest run scripts/cefr-j-catalog.test.ts scripts/cefr-j-platform.test.ts`. Remote migration application remains a separate operator action under [the D1 migration guide](d1-migrations.md).
