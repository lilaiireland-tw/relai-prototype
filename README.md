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

建立 migration：

```bash
npx wrangler d1 migrations create relai-prototype-db <migration_name>
```

本機套用：

```bash
npx wrangler d1 migrations apply relai-prototype-db --local
```

Production：

```bash
npx wrangler d1 migrations apply relai-prototype-db --remote
```

每次 schema change：

1. 新增 migration
2. local apply
3. local smoke test
4. commit migration
5. deploy 前 remote apply
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

概念範例：

```json
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "relai-prototype",
  "main": "src/worker/index.ts",
  "compatibility_date": "2026-09-27",
  "assets": {
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "relai-prototype-db",
      "database_id": "<set-after-create>"
    }
  ],
  "vars": {
    "APP_ENV": "production",
    "GEMINI_MODEL": "gemini-3.8-flash"
  }
}
```

Secrets：

```bash
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put AUTH_PEPPER
```

---

## 13. Local development

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

---

## 14. Deployment

```text
GitHub
  ↓
tests / typecheck / build
  ↓
D1 remote migrations
  ↓
Cloudflare Workers deploy
  ↓
Static assets + API same origin
```

Prototype 維持：

- 單一 Worker
- 單一 D1 database
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
