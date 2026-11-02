# ADR 0001: canonical, sense-aware vocabulary records

- Status: Proposed with B5.4 implementation
- Date: 2026-11-02
- Scope: image-derived vocabulary cards and the shared D1 catalog

## Context

Vocabulary cards currently have personal and catalog-backed storage paths, and
headword-only identity cannot distinguish separate meanings such as the
financial and riverside senses of “bank”. Re-generating a complete entry for
each user also permits the same sense to drift across cards.

## Decision

The published `vocabulary_catalog` is the authoritative lexical source. A saved
vocabulary flashcard stores a canonical catalog ID and user-specific learning
state/provenance only. The canonical identity is normalized headword, normalized
part of speech and semantic sense. CEFR level is optional metadata, not a proxy
for sense identity; unknown levels remain null.

Image recognition first extracts the headword, part of speech, semantic sense,
source context and confidence. The Worker queries matching published records
before requesting lexical content. Complete matches are reused unchanged. For
incomplete records, generation requests only missing fields. Strict schema and
deterministic field checks run before publication or enrichment. Existing
non-empty published fields are written with missing-only updates and optimistic
content-version checks.

New senses publish after structured-output and deterministic field validation.
Ambiguous or low-confidence senses return an explicit per-item status and
published sense options for the user to resolve. The normal image flow does not
create review candidates or wait for administrator approval; legacy candidates
remain available through the existing admin API.

Database uniqueness indexes enforce one published record per normalized
headword/POS/sense and private candidate/catalog uniqueness per owner. D1 batch
operations, conflict handling and optimistic content versions make retries
idempotent and prevent competing requests from overwriting published content.
Card provenance retains the user's `source_item_id`; raw source context stays on
the owned source item or legacy private candidate and is not copied into a shared
catalog record. Catalog provenance records model, prompt and field-validation metadata.
Accepted catalog content changes append immutable version snapshots.

Migration 0005 archives old catalog source rows and retains their IDs and source
metadata. It remaps legacy personal vocabulary cards to private review-needed
canonical records and preserves existing users, cards, review history, favorite
state, statistics, settings and source/onboarding data. It does not modify remote
D1; staging application is an explicit operator procedure.

## Consequences

- Users selecting the same canonical sense read content from the same catalog row.
- Distinct senses and parts of speech remain separate and may have separate cards.
- Legacy catalog candidates need administrator resolution; normal image capture
  publishes eligible items and lets users choose when a published sense is ambiguous.
- CEFR-J source rows remain queryable in the archived source table; their
  canonical mappings do not invent semantic sense labels or CEFR levels.
- Migration and Worker rollout require coordination because the new flashcard
  schema is incompatible with the old Worker.

## Alternatives not selected

- Keeping user-specific copies of definitions/examples: would allow saved cards
  for the same sense to diverge.
- Merging by headword alone or by CEFR level: would conflate different senses or
  treat proficiency as semantic identity.
- Automatically overwriting conflicting published content: would discard
  reviewed data without a traceable decision.
- Background review queues or general catalog browsing: outside B5.4 scope.
