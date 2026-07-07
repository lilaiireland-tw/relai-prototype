# ReLai Project Structure

## Summary

ReLai is organized into separate frontend, backend, database, infrastructure, and documentation areas.

- `frontend-web/`: Next.js frontend prototype and future product UI
- `backend/`: FastAPI backend for business logic and API contracts
- `database/`: database design notes, schema drafts, and seeds
- `infra/supabase/`: Supabase migrations, policies, and deployment-facing SQL assets
- `docs/`: architecture and product documentation

PostgreSQL is the default database, with Supabase providing PostgreSQL, Auth, and Storage.

## Folder Structure

```text
relai-prototype/
├─ docs/
│  └─ structure.md
├─ frontend-web/
│  ├─ app/
│  ├─ components/
│  ├─ lib/
│  ├─ public/
│  ├─ .eslintrc.json
│  ├─ next.config.mjs
│  ├─ package.json
│  ├─ package-lock.json
│  ├─ postcss.config.js
│  ├─ tailwind.config.ts
│  ├─ tsconfig.json
│  └─ README.md
├─ backend/
│  ├─ app/
│  │  ├─ main.py
│  │  ├─ core/
│  │  │  ├─ config.py
│  │  │  ├─ database.py
│  │  │  └─ security.py
│  │  ├─ api/
│  │  │  ├─ deps.py
│  │  │  └─ v1/
│  │  ├─ models/
│  │  ├─ schemas/
│  │  ├─ repositories/
│  │  ├─ services/
│  │  │  ├─ ai/
│  │  │  ├─ cards/
│  │  │  ├─ stats/
│  │  │  ├─ auth/
│  │  │  └─ storage/
│  │  └─ tests/
│  ├─ alembic/
│  ├─ pyproject.toml
│  ├─ .env.example
│  └─ README.md
├─ database/
│  ├─ schema/
│  ├─ seeds/
│  └─ README.md
├─ infra/
│  └─ supabase/
│     ├─ migrations/
│     ├─ policies/
│     ├─ seeds/
│     └─ README.md
├─ assets/
├─ ReLai_PRD_v3.1.md
└─ README.md
```

## System Relationship

```text
[User]
   |
   v
[frontend-web / Next.js]
   | \
   |  \-- session / auth state --> [Supabase Auth + Storage]
   |
   \---- REST / JSON ----> [backend / FastAPI]
                               |
                               |-- AI extraction / OCR integration
                               |
                               \-- data persistence --> [Supabase PostgreSQL]
```

## Responsibility Split

### Frontend

`frontend-web/` is responsible for:

- routing and UI rendering
- user interaction flows
- authentication session handling
- uploading text or images to backend APIs
- rendering cards, reviews, stats, and onboarding

It should avoid owning core extraction logic or direct database writes for application data.

### Backend

`backend/` is responsible for:

- API contracts
- auth verification
- ingestion and extraction orchestration
- business rules for flashcards, error logs, reviews, stats, and settings
- database access

### Database and Supabase

`database/` and `infra/supabase/` are responsible for:

- schema planning
- migrations
- row-level security policies
- seed data
- storage-related SQL assets

## Suggested API Areas

```text
/api/v1/auth
/api/v1/ingestion
/api/v1/flashcards
/api/v1/error-logs
/api/v1/reviews
/api/v1/stats
/api/v1/settings
```

## Suggested Data Domains

```text
auth.users
profiles
source_items
flashcards
error_logs
review_events
user_stats
user_settings
achievements
user_achievements
```

## Defaults and Assumptions

- Frontend lives in `frontend-web/`
- Backend lives in `backend/`
- Database defaults to PostgreSQL
- Supabase is the managed platform for PostgreSQL, Auth, and Storage
- This structure is for v1 development and can expand later into shared packages if needed
