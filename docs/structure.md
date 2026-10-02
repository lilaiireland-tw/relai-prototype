# Repository structure

ReLai runs the browser app and Hono API from one Cloudflare Worker. The app and API share the `/relaiapp` origin; the Worker routes `/relaiapp/api/v1/*` before static SPA fallback.

```text
src/
  client/
    components/      Auth session, navigation and UI components
    lib/             Same-origin API client
    pages/           Splash, login, password change and mock product pages
    services/        Client data boundary, mock fixtures and runtime health
    styles/          Global styles
    App.tsx          React Router routes
    main.tsx         Browser entry
  worker/
    auth/            Credential and session-token crypto
    middleware/      Session and password-change guards
    persistence/     D1 users, sessions, cards, reviews, stats and settings repositories
    routes/          Health, auth, onboarding, cards, reviews, stats and settings endpoints
    services/        Auth service
    index.ts         Hono Worker entry
migrations/          D1 schema history (0001, 0002 and 0003 CEFR-J foundation)
scripts/             Account management, CEFR-J extraction/import, deployment/schema checks and tests
docs/                Operator and developer runbooks
public/              Static asset redirect rules
```

Root `package.json`, `vite.config.ts`, `wrangler.jsonc`, and `index.html` define the active build and runtime. `ReLai_PRD_v3.4.md` describes product requirements, including later phases.

The Worker implements health, login, logout, session lookup and password change, plus authenticated starter bootstrap, Cards, Reviews, Stats and Settings APIs. D1 repositories cover users, sessions, flashcards, review events, user stats, user settings, the CEFR-J catalog and starter bootstrap. Migration 0003 defines the CEFR-J A1-B2 catalog and per-user vocabulary linkage. Issue #64 adds CEFR-J 1.6 extraction/import tooling and a small test fixture; #65 adds initial level selection and starter bootstrap; #66 adds the product APIs. Remote catalog contents, migrations and deployment status require separate operator verification.

Client card and error-log screens still use mock data; stats and settings product screens are placeholders, though Settings links to the working password-change flow. Frontend integration with starter bootstrap and product APIs is pending. Gemini ingestion and PWA/offline review queuing are not implemented.

See the [README](../README.md) for commands and environment names, [auth/session API](auth-session-api.md) for current routes, and [D1 migrations](d1-migrations.md) for schema operations.
