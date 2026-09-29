# ReLai 哩來語感特訓

ReLai 是「哩來愛爾蘭」旗下的 AI 英語學習產品，目標是把使用者日常接觸到的英文內容快速轉換成可複習、可累積、可追蹤的學習資產。

使用者可以貼上英文文字或上傳英文筆記圖片，系統透過 AI 產生兩種核心學習內容：

- `Vocabulary`：值得記憶的單字、片語、例句與繁中解釋
- `Error Log`：錯誤句、正確句與錯誤原因

本 repo 為 ReLai **Closed Beta / Prototype** 的主要程式庫與工程文件。

> **目前的技術方向已確定為 Cloudflare-native。**
>
> Prototype v1 使用 **React + Vite + Cloudflare Workers + D1 + Gemini API**。
> 舊的 `FastAPI + PostgreSQL + Supabase + Vercel` 規劃已廢止，舊目錄僅作為遷移期間參考，不應再新增功能。

---

## 1. Prototype 目前目標

現階段預計測試使用者少於 10 人，核心目標是快速驗證：

1. 使用者能以 ReLai 預先發放的帳號密碼登入
2. 文字輸入可以產生 Vocabulary / Error Log
3. 圖片可以直接交給 AI Vision 解析並產生卡片
4. 卡片可以永久保存、查詢、收藏、編輯與刪除
5. 使用者可以複習卡片並累積 Daily Goal / Streak
6. 已載入的卡片可以在 PWA 離線情境下繼續複習
7. 整套基礎設施優先維持在 Cloudflare 免費額度內

Prototype 階段不追求公開註冊、完整 SaaS 帳務、社交功能或大規模多租戶架構。

---

## 2. 架構決策：Cloudflare-native

### Target Architecture

```text
                         ┌─────────────────────┐
                         │     Gemini API      │
                         │ OCR + AI extraction │
                         └──────────▲──────────┘
                                    │ server-side only
                                    │
┌───────────────────────────────────┴──────────────────────────────────┐
│                         Cloudflare Worker                            │
│                                                                      │
│  React / Vite Static Assets        Hono API                         │
│  ──────────────────────────        ────────                         │
│  /login                            /api/v1/auth/*                    │
│  /home                             /api/v1/ingestion/*               │
│  /cards                            /api/v1/cards/*                   │
│  /stats                            /api/v1/reviews/*                 │
│  /settings                         /api/v1/stats/*                   │
│                                    /api/v1/settings/*                │
│                                          │                           │
│                                          ▼                           │
│                                  Cloudflare D1                       │
└──────────────────────────────────────────────────────────────────────┘
                    ▲
                    │ HTTPS + HttpOnly session cookie
                    │
              Browser / PWA
              IndexedDB cache
```

### 為什麼採用這個架構

ReLai v1 是登入後使用的 Web App / PWA，不依賴大量 SEO 頁面或 SSR。現有 Next.js prototype 尚未使用 Server Actions、Route Handlers、SSR database queries 或其他深度 Next.js server features，因此在進入正式 backend 開發前改成 React + Vite 的成本最低。

Cloudflare Workers 可以同時承接：

- React/Vite 靜態資產
- `/api/v1/*` backend API
- D1 binding
- Gemini server-side API 呼叫
- Session 驗證

不需要額外維護 Python server、PostgreSQL server 或 Supabase project。

---

## 3. v1 技術棧

| Layer | 選型 | 說明 |
|---|---|---|
| Frontend | React + TypeScript | 保留現有 React UI 與互動邏輯 |
| Build | Vite | 取代 Next.js build/runtime |
| Routing | React Router | Client-side SPA routing |
| Styling | Tailwind CSS | 延續目前 prototype |
| Cloudflare integration | `@cloudflare/vite-plugin` | 本機與 production 都接近 Workers runtime |
| Backend | Cloudflare Workers | 唯一 server runtime |
| API router | Hono | 輕量 routing / middleware |
| Database | Cloudflare D1 | SQLite semantics，透過 Worker binding 存取 |
| DB access | D1 prepared statements | v1 不先引入 ORM；SQL migration 為 schema source of truth |
| Validation | Zod | API input、AI structured output validation |
| Auth | App-managed username/password + session | 帳號由管理員預先建立，不提供註冊 |
| AI | Gemini API | Model 由環境變數決定；預設 `gemini-3.8-flash` |
| Offline | Service Worker + IndexedDB | App shell、卡片快取與離線 review queue |
| Deploy | Wrangler / Cloudflare Workers | 前端與 API 一次部署 |

### Prototype 明確不使用

除非產品決策另行修改，Codex 不應在 v1 引入：

- FastAPI
- Uvicorn
- SQLAlchemy
- Alembic
- PostgreSQL
- Supabase Database / Auth / Storage
- Vercel
- MySQL
- Firebase
- R2 圖片儲存
- 公開註冊
- Google / Apple OAuth
- 自助忘記密碼
- Microservices
- Kubernetes / Docker production runtime

---

## 4. Closed Beta Auth

### 產品規則

Prototype 不提供註冊功能。

帳號由 ReLai 管理員預先建立並交給測試使用者：

```text
管理員建立帳號
       ↓
發送 username + 隨機高強度 password
       ↓
使用者在 /login 登入
       ↓
Worker 驗證帳密
       ↓
建立 session
       ↓
瀏覽器取得 HttpOnly cookie
```

v1 不提供：

- `/register`
- OAuth login
- email verification
- forgot password
- public user creation endpoint

若使用者忘記密碼，由管理員人工重設。

### 密碼與 credential

Closed Beta 帳號由系統產生高 entropy 隨機 password，不讓使用者自行設定弱密碼。

v1 credential storage：

- 每個 user 一組 random salt
- Worker secret `AUTH_PEPPER`
- 使用 Web Crypto 計算 credential digest
- D1 只保存 salt + digest
- 驗證時使用 constant-time comparison
- 不記錄 raw password

> 這是「<10 人 Closed Beta + 系統發放隨機密碼」的 prototype 解法。
> 未來若開放 public registration / user-chosen password，必須重新評估 consumer authentication 方案與 password KDF。

### Session

登入成功後：

- 產生 cryptographically secure opaque session token
- browser cookie 保存 raw token
- D1 只保存 token SHA-256 digest
- Cookie 設定 `HttpOnly`
- Production 設定 `Secure`
- `SameSite=Lax`
- Session 可撤銷
- Logout 刪除 session row 並清 cookie
- 每個受保護 API 都從 session 推導 `user_id`
- Client 傳來的 `user_id` 永遠不視為可信任 ownership 資訊

---

## 5. D1 資料模型

D1 是 v1 唯一 application database。

### Core tables

```text
users
sessions
source_items
flashcards
review_events
user_stats
user_settings
```

P1 / 後續再加入：

```text
achievements
user_achievements
ielts_questions
subscriptions
```

### `users`

```text
id
username
display_name
password_salt
password_digest
role                  // user | admin
is_active
cohort_source         // lilai_referral | organic | internal_beta
created_at
updated_at
last_login_at
```

規則：

- `username` unique
- username 在 application layer normalize
- 不需要 email 才能登入
- 不允許 public INSERT user

### `sessions`

```text
id
user_id
token_digest
created_at
expires_at
last_seen_at
```

Indexes：

```text
token_digest
user_id
expires_at
```

### `source_items`

```text
id
user_id
source_type            // text | image
raw_text               // text input 或 OCR/extraction 後可保存的文字
processing_status      // pending | processed | failed
ai_model
created_at
updated_at
```

**圖片 binary 不寫入 D1。**

### `flashcards`

```text
id
user_id
source_item_id
card_type              // vocabulary | error_log
front_content
back_content
part_of_speech
zh_tw_definition
explanation
irish_usage
source                 // user_input | ielts_quiz
is_favorite
last_reviewed_at
next_review_at         // v1 null，預留 FSRS
created_at
updated_at
```

重要 indexes：

```text
(user_id, created_at)
(user_id, card_type)
(user_id, last_reviewed_at)
(user_id, is_favorite)
```

### `review_events`

```text
id
client_event_id        // client 產生；unique；offline sync idempotency
user_id
card_id
review_result          // viewed | known | needs_review
reviewed_at
created_at
```

### `user_stats`

```text
user_id                // PK
streak_days
longest_streak
total_cards_created
total_reviews
last_active_date
updated_at
```

`user_stats` 是衍生資料，不是 review history 的唯一 source of truth。

### `user_settings`

```text
user_id                // PK
daily_goal
timezone
created_at
updated_at
```

Timezone 優先使用瀏覽器偵測值，無法取得時 fallback `Asia/Taipei`。

### D1 型別慣例

- ID：`TEXT`，使用 `crypto.randomUUID()`
- Boolean：`INTEGER` (`0 / 1`)
- Timestamp：UTC ISO-8601 `TEXT`
- Date：`YYYY-MM-DD`
- JSON：必要時存 `TEXT JSON`
- 所有 user-scoped query 必須包含 `user_id`

---

## 6. Database migration 規則

正式 schema 只能透過：

```text
migrations/
```

修改。

Repository-root [`/migrations`](migrations/README.md) is the only v1 D1 schema
source of truth. Issue #22 established the workflow; Issue #24 adds the first
core schema migration. Legacy Supabase/Alembic migrations are historical references only.
Keep committed/applied migrations append-only; correct them with new SQL files.
See [D1 migration workflow](docs/d1-migrations.md) for exact commands and safety
rules and [D1 environments](docs/d1-environments.md) for database mappings.

From the repository root, for a future assigned schema task:

```sh
npm run db:migrations:create -- describe_change
# Edit/review SQL, then validate locally:
npm run db:migrations:list:local
npm run db:migrations:apply:local
# After local checks and review, an operator explicitly targets relai-staging-db:
npm run db:migrations:list:staging
npm run db:migrations:apply:staging
```

Local scripts use `--local`; staging scripts use `--remote`. All select
`--config wrangler.jsonc --env staging` and `relai-staging-db` explicitly.
Production migration requires an approved manual release action from `main`,
using `relai-prod-db --config wrangler.jsonc --env production --remote` as shown
in the runbook. No production migration script or automatic migration is part
of GitHub Actions, Cloudflare staging CD, or ordinary develop deployment.

每次 schema change：

1. 新增 migration
2. local apply
3. local smoke test
4. commit migration
5. deploy 前由 operator 明確執行 staging migration；production 僅限核准的 manual release
6. 不修改 production 已套用的 migration

---

## 7. API Contract

所有 application API：

```text
/api/v1/*
```

### Auth

```text
POST /api/v1/auth/login
POST /api/v1/auth/logout
GET  /api/v1/auth/me
```

沒有 register endpoint。

### Ingestion

```text
POST /api/v1/ingestion/text
POST /api/v1/ingestion/image
```

責任：

1. 驗證 session
2. 驗證 input size/type
3. 建立 `source_item`
4. 呼叫 Gemini
5. 驗證 Gemini structured output
6. batch / transaction 寫入 flashcards
7. 更新 stats
8. 回傳 cards

### Cards

```text
GET    /api/v1/cards
GET    /api/v1/cards/:id
PATCH  /api/v1/cards/:id
DELETE /api/v1/cards/:id
POST   /api/v1/cards/:id/favorite
```

Query examples：

```text
?type=vocabulary
?type=error_log
?favorite=true
?needs_review=true
?limit=50
?cursor=...
```

### Reviews

```text
POST /api/v1/reviews
```

需支援 `client_event_id` idempotency，避免 offline queue 重送造成 review count 重複。

### Stats

```text
GET /api/v1/stats/summary
```

### Settings

```text
GET   /api/v1/settings
PATCH /api/v1/settings
```

---

## 8. AI ingestion

### AI provider

v1 使用 Gemini API。

**不要把 model ID 寫死在 business logic。**

Worker environment：

```text
GEMINI_MODEL=gemini-3.8-flash
```

API key：

```text
GEMINI_API_KEY
```

只能存在 Cloudflare Worker secret，不得出現在：

- browser bundle
- React env
- Git repository
- D1
- logs

### Text flow

```text
Browser
  ↓ text
Worker
  ↓ validate
Gemini
  ↓ structured JSON
Zod validation
  ↓
D1 batch insert
  ↓
Browser cards
```

### Image flow

```text
Browser
  ↓ image
Worker request lifecycle
  ↓
Gemini multimodal input
  ↓ OCR + structured extraction
  ↓
D1 only stores text/card result
```

v1 圖片政策：

- 接受 JPG / PNG / WebP
- HEIC 優先在 client 轉為支援格式
- 設定 file size limit
- 圖片只存在當次 request lifecycle
- 不寫入 D1
- 不寫入 R2
- 不保留 base64
- 不寫入 application log

### AI output

AI output 必須經 server-side Zod validation。

若 structured output invalid：

1. 最多一次修復 / retry
2. 仍失敗則 `source_item.processing_status = failed`
3. 前端顯示可重試錯誤
4. 不建立半套 card rows

---

## 9. TTV 與 UX

North Star：

> 使用者送出內容到看見可用卡片，目標 TTV ≤ 5 秒。

v1：

- 送出後立即 Skeleton Cards
- 明確 processing state
- Worker server-side timeout
- timeout / AI error 顯示 retry
- 不為「假 streaming」增加大量 parser complexity
- structured streaming 實測穩定且有價值後再導入

效能 measurement 至少記錄：

```text
request_started_at
ai_started_at
ai_finished_at
response_received_at
```

Production log 不包含完整使用者輸入或圖片內容。

---

## 10. PWA / Offline

離線只支援「已下載卡片複習」，不要求離線 AI 生成。

### Cache

- App shell：Service Worker cache
- Card data：IndexedDB
- Authentication password/token 不放 IndexedDB
- Session cookie 由 browser 管理

### Offline review

1. client 產生 UUID `client_event_id`
2. review event 寫入 IndexedDB queue
3. UI optimistic update
4. 恢復網路後 POST `/api/v1/reviews`
5. Server 依 `client_event_id` 去重
6. 成功後移除 queue item

---

## 11. Target repository structure

```text
relai-prototype/
├─ src/
│  ├─ client/
│  │  ├─ components/
│  │  ├─ pages/
│  │  ├─ hooks/
│  │  ├─ lib/
│  │  ├─ styles/
│  │  └─ main.tsx
│  │
│  ├─ worker/
│  │  ├─ index.ts
│  │  ├─ middleware/
│  │  │  └─ auth.ts
│  │  ├─ routes/
│  │  │  ├─ auth.ts
│  │  │  ├─ ingestion.ts
│  │  │  ├─ cards.ts
│  │  │  ├─ reviews.ts
│  │  │  ├─ stats.ts
│  │  │  └─ settings.ts
│  │  ├─ services/
│  │  │  ├─ ai.ts
│  │  │  ├─ auth.ts
│  │  │  ├─ cards.ts
│  │  │  └─ stats.ts
│  │  ├─ db/
│  │  │  └─ queries/
│  │  └─ utils/
│  │
│  └─ shared/
│     ├─ schemas/
│     └─ types/
│
├─ migrations/
├─ scripts/
│  └─ manage-user.ts
├─ public/
├─ docs/
├─ ReLai_PRD_v3.1.md
├─ README.md
├─ index.html
├─ package.json
├─ vite.config.ts
├─ wrangler.jsonc
├─ tsconfig.json
└─ tailwind.config.ts
```

### Legacy directories

目前：

```text
frontend-web/
backend/
database/
infra/supabase/
```

屬於舊架構。

遷移完成後應刪除或 archive，不應讓兩套 backend/database 架構長期共存。

---

## 12. Wrangler / bindings

預期 bindings：

```text
DB              -> D1
GEMINI_API_KEY  -> secret
AUTH_PEPPER     -> secret
GEMINI_MODEL    -> plain env var
APP_ENV         -> plain env var
```

### Isolated D1 environments (Issue #14)

| Git branch | Cloudflare environment | Worker | Binding | D1 resource |
|---|---|---|---|---|
| `develop` | `staging` | `relai-prototype-staging` | `DB` | `relai-staging-db` |
| `main` | `production` | `relai-prototype` | `DB` | `relai-prod-db` |

[`wrangler.jsonc`](wrangler.jsonc) is the server-side source of database IDs.
Its default binding is staging; both named environments have explicit bindings
and distinct database IDs. Local D1 is simulated; no binding uses `remote: true`.
`npm run dev`, `npm run build`, and `npm run deploy` explicitly select staging.
For `main`, use `npm run build:production` / `npm run deploy:production`.
These commands build the selected environment before deployment; Git branches do
not automatically select a Wrangler environment. Staging automation is described
in [develop deployment](docs/develop-deployment.md); production remains manual.

The Vite plugin selects Cloudflare environments at **dev/build time**. A later
`wrangler deploy --env production` cannot turn a staging build into a production
build. Vite config rejects a `CLOUDFLARE_ENV` that conflicts with the selected mode.
`npm run verify:d1-config` checks Wrangler resolution and isolation without credentials
or database access; it also runs as part of `npm test`.

See [D1 environments](docs/d1-environments.md) for exact provisioning commands,
read-only connectivity checks, validation evidence, and safety constraints.
Secrets must remain Cloudflare Worker secrets or ignored local files; never put
secret values or DB configuration in client code or `VITE_*` variables.

---

## 13. Local development

### Worker persistence foundation (Issue #30)

`src/worker/persistence` provides typed D1 prepared-statement repositories for
users and sessions. See [repository conventions](docs/d1-persistence.md) for
inputs, result behavior, digest-only session access and ownership boundaries.
Run `npm run test:persistence` for deterministic in-memory SQLite tests using
the approved migration; these tests also run in `npm test` without remote D1 access.

### Auth crypto primitives (Issue #37)

`src/worker/auth/crypto.ts` provides Worker Web Crypto credential salt generation,
versioned HMAC-SHA-256 password derivation/verification with server-side
`AUTH_PEPPER`, and opaque session-token generation/SHA-256 digest derivation.
Raw session transport material has a separate type from the existing stored
`TokenDigest` boundary. See [the exact v1 encoding and contracts](docs/auth-crypto.md)
before implementing later account reset/login logic. Run `npm run test:auth`
for focused offline tests; these also run in `npm test`. This task adds no auth
routes, cookies, account-management script, frontend auth or schema changes.

### Admin account management (Issue #39)

`scripts/manage-user.ts` supports closed-beta create, reset-password, disable and
safe account listing through the existing Worker repositories and approved crypto.
Run `npm run user:manage -- <command>` from the repository root; staging is the
default and production requires an exact confirmation before D1 access. See the
[operator runbook](docs/admin-accounts.md) for arguments, secret injection, password
output and failure behavior. `npm run test:admin` runs focused offline tests.

### Current Worker API skeleton (Issue #11)

The root Vite app and Hono API share one Cloudflare Worker. Run `npm run dev`
and request `GET /relaiapp/api/v1/health` to receive HTTP 200 with
`{"status":"ok"}`. This endpoint checks runtime availability only.

API routing is grouped in `src/worker/routes/api.ts`. Wrangler runs the Worker
first for `/relaiapp/api` and `/relaiapp/api/*`, including browser navigation
requests, while other paths retain static asset / SPA handling. Unknown API
routes return JSON 404 with `error.code = NOT_FOUND`; unhandled API errors return
JSON 500 with `error.code = INTERNAL_SERVER_ERROR` and a fixed safe message.

### Client routing and base path (Issues #12 / #32)

Open `/relaiapp/` with `npm run dev` or `npm run preview`. Both `/relaiapp`
and `/relaiapp/` render the migrated splash screen. React Router uses Vite's
`/relaiapp/` base, with login, home, vocabulary cards and error log at `/login`,
`/home`, `/cards` and `/error-log` beneath that basename. Legacy `/auth` (including
old mode queries) redirects to login; `/flashcards` redirects to `/cards`.
`/stats` and `/settings` remain future-feature placeholders.

The username/password form accepts any nonempty demo values. Use dummy credentials;
it is client-only UI state, not production authentication. Passwords and tokens are
not stored. Reload clears the demo profile, while mock screens remain directly
previewable. Logout returns to login. No public registration UI is provided.

`src/client/services/data.ts` is the replaceable asynchronous client data adapter;
components consume its PRD-shaped card, stats and settings contracts. Fixtures in
`services/mock.ts` are derived from the legacy visual reference. Today's progress
uses a daily review count, not lifetime reviews. Mock review navigation does not
persist review events or change stats. Future same-origin Worker APIs can replace
the adapter without porting the UI again. No real auth, cards, stats, settings,
Gemini or browser D1 integration is included. `frontend-web` remains untouched.

`npm test` covers direct client routes, navigation, demo login/logout, mock content,
card flip/next, error log and registration absence. `npm run test:routing` verifies
built SPA deep links/assets and that the API namespace continues returning JSON
independently of SPA fallback.

### Browser API adapter (Issue #33)

`src/client/lib/api.ts` centralizes typed browser transport. The only exposed
request is `GET /relaiapp/api/v1/health`; URLs are root-relative and same-origin
on every SPA route. Requests use `credentials: 'same-origin'` for future
browser-managed HttpOnly cookies, without tokens or credential storage. The
client validates the health JSON contract, rejects non-2xx/network/malformed
responses with safe errors, and limits requests to 10 seconds.

The Home connectivity panel consumes `services/runtime.ts` (`source: 'api'`)
and shows loading, success, failure and retry states. Health proves runtime
availability only, not authentication, database readiness or product persistence.
Home/cards/stats/settings remain behind the existing `ClientDataService` in
`services/data.ts` (`source: 'mock'`); stats and settings pages remain placeholders.
The UI labels real connectivity separately from mock learning data. A failed
health request never substitutes mock health or prevents mock product browsing.
Components do not call `fetch` or import transport implementations.

Tests cover URL/transport options, the existing Worker health contract, error
and malformed responses, independent mock data, UI health states/retry, and
centralized fetch calls. Existing SPA routing validation remains in place.

Cloudflare's `single-page-application` asset handling serves `index.html` for
direct navigation or refresh of client routes. Vite emits asset URLs under
`/relaiapp/assets/`; `public/_redirects` rewrites those requests to the generated
`/assets/` files without changing the browser URL. The entire `/relaiapp/api/*`
namespace runs the Worker first, so unknown API versions also return JSON 404
instead of SPA HTML. The v1 health response remains `{"status":"ok"}`.

完成遷移後至少提供：

```bash
npm install
npm run dev
npm run build
npm run preview
npm run lint
npm run typecheck
npm test
npm run deploy
```

Codex 修改完成後至少執行：

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

### Pull request CI (Issue #13)

`.github/workflows/ci.yml` runs on pull requests targeting `develop` or `main`
when opened, reopened, or updated with new commits. The `CI` workflow runs the
`Repository quality checks` job on Ubuntu with Node.js 24 LTS, which satisfies
the current locked dependencies' Node requirements. npm's download cache is
keyed by the root `package-lock.json`; dependencies are installed with `npm ci`
on every run.

The job runs these root repository commands in order:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

Any command failure fails the job and appears in the PR checks; later commands
are skipped. CI requires no Cloudflare production secrets, Gemini secrets, or
D1 credentials. It performs quality checks only, with no deployment, D1
migrations, or automatic merging. Deployment remains a separate process.

---

## 14. Deployment

### Develop test deployment (Issue #15)

Cloudflare Workers Builds / Git integration is the sole automated staging deployer.
GitHub Actions remains the CI quality gate only, through the existing
`.github/workflows/ci.yml`. Connect the existing `relai-prototype-staging` Worker
to `lilaiireland-tw/relai-prototype`, select `develop` as its deployment branch,
and disable preview builds. Cloudflare's branch setting may be labelled
"Production branch"; for this staging Worker it must be `develop`, not `main`.

Set the Cloudflare Build command to `npm run build:staging:validated` and Deploy
command to `npm run deploy:staging:built`. These commands run quality checks, build
staging, verify the generated binding, check packaging, deploy that exact build,
and verify `/relaiapp/api/v1/health`. They are invoked by Workers Builds; there is
no GitHub Actions deployment workflow.

Test app: <https://relai-prototype-staging.lilaiireland.workers.dev/relaiapp/>.
The staging environment explicitly enables `workers_dev`, has no custom routes,
and binds `DB` only to `relai-staging-db`. Cloudflare build history and GitHub's
Cloudflare check run provide deployment status; health logs print the test URL.

The first staging smoke deployment used latest `develop` at `536ba8d`. The Product
Owner must connect the repository in Cloudflare after this PR is merged, using the
exact Dashboard settings in [develop deployment](docs/develop-deployment.md).
That guide records deployment ownership, retries and validation evidence.
The Dashboard connection and first Workers Builds run remain pending.

### Application deployment lifecycle

```text
GitHub
  ↓
tests / typecheck / build
  ↓
D1 migration (separate explicit operator step when schema changes)
  ↓
Cloudflare Workers deploy
  ↓
Static assets + API same origin
```

The migration step above is a release coordination step, not a CI/CD command.
GitHub Actions and Cloudflare staging CD never apply migrations automatically.

Prototype 維持：

- 單一 Worker
- 每個環境一個 D1 database，staging / production 實體隔離
- 同 origin frontend + API

不要先拆 microservices。

---

## 15. Prototype 成本原則

使用者少於 10 位時，Cloudflare Free plan 應足以支撐 prototype。

開發與部署時仍須以 Cloudflare 官方最新 limits/pricing 為準。

工程上仍要：

- 常用 filter 建 index
- list endpoint 做 pagination / limit
- 避免 full-table scan
- 不把圖片 / binary 放 D1
- 不依賴「免費額度永遠不變」作為 correctness 假設

Gemini API 額度與價格也可能調整，因此：

- model / provider 需封裝
- model ID 使用環境變數
- 不把特定免費 quota 寫進產品邏輯

---

## 16. Codex Agent 開發規則

Codex 處理本 repo 時優先閱讀：

1. `README.md`
2. `ReLai_PRD_v3.1.md`
3. 任務直接相關 source files

### 架構規則

1. Cloudflare Worker 是唯一 backend runtime。
2. D1 是 v1 唯一 application database。
3. Browser 不可直接操作 D1。
4. 所有 user-scoped data 由 authenticated session 推導 user。
5. 不建立 public registration。
6. 不重新引入 Supabase / PostgreSQL / FastAPI。
7. Gemini API key 永遠 server-side。
8. v1 圖片不持久化。
9. Schema change 一律透過 D1 migration。
10. API / AI input-output 做 runtime validation。
11. SQL 使用 bound parameters / prepared statements。
12. 不為 <10 人 prototype 做 premature microservice abstraction。
13. 優先保留現有 prototype UI，不因 backend migration 任意 redesign。
14. 每個 migration step 保持 app 可 build、可測。
15. root README 與 PRD 優先於 legacy docs。

### Coding 原則

- route layer 保持薄
- business logic 放 service
- SQL 集中 query modules
- 共用 schema 放 `src/shared/schemas`
- 不 trust client-supplied ownership
- 不 log password / session token / API key / raw image
- error response 不暴露 stack trace / DB details
- 新 endpoint 至少測 happy path / auth / ownership

---

## 17. Migration order

### Phase A — Platform skeleton

1. 建立 Vite + Cloudflare Vite Plugin
2. 搬移現有 React/Tailwind UI
3. 建立 React Router routes
4. 建立 Hono Worker `/api/v1/health`
5. local dev / build / preview / deploy

### Phase B — D1

1. 建立 D1 database
2. initial migration
3. 建立核心 tables
4. 建 indexes
5. D1 query modules

### Phase C — Auth

1. 管理員 user provisioning script
2. `/login`
3. session cookie
4. auth middleware
5. logout
6. ownership tests

### Phase D — Replace mock data

1. cards read API
2. home stats API
3. favorite / edit / delete
4. reviews
5. settings
6. 移除 production 對 `mock-data` 的依賴

### Phase E — AI ingestion

1. Gemini text extraction
2. structured output validation
3. D1 persistence
4. image ingestion
5. timeout / retry UX
6. TTV measurement

### Phase F — PWA

1. app shell cache
2. IndexedDB card cache
3. offline review queue
4. idempotent sync

---

## 18. Source of truth

產品需求：

- [`ReLai_PRD_v3.1.md`](./ReLai_PRD_v3.1.md)

若文件衝突：

- **產品行為 / priority / UX**：PRD 優先
- **infrastructure / deployment / code architecture**：root README 優先

架構變更時 README 與 PRD 必須同一個 PR 更新。
