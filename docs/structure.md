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
    routes/          Health and auth endpoints
    services/        Auth service
    index.ts         Hono Worker entry
migrations/          D1 schema history (0001, 0002 and 0003 CEFR-J foundation)
scripts/             Account management, deployment/schema checks and tests
docs/                Operator and developer runbooks
public/              Static asset redirect rules
```

Root `package.json`, `vite.config.ts`, `wrangler.jsonc`, and `index.html` define the active build and runtime. `ReLai_PRD_v3.4.md` describes product requirements, including later phases.

The Worker currently implements health, login, logout, session lookup and password change. D1 repositories cover users, sessions, flashcards, review events, user stats and user settings. The empty CEFR-J A1–B2 catalog schema and per-user vocabulary linkage are in migration 0003. Client card and error-log screens use mock data; stats and settings product screens are placeholders, though Settings links to the working password-change flow. No catalog import, starter bootstrap, product data API or Gemini ingestion exists yet.

See the [README](../README.md) for commands and environment names, [auth/session API](auth-session-api.md) for current routes, and [D1 migrations](d1-migrations.md) for schema operations.
