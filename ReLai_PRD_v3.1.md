# ReLai（哩來語感特訓）— 產品需求與架構綱要 PRD v3.1

**文件版本**：v3.2（Cloudflare Prototype 架構修訂版）  
**品牌歸屬**：哩來愛爾蘭（@lilaiireland）  
**開發策略**：Vibe Coding / Codex Agent 輔助全端開發 / 敏捷開發  
**最後更新**：2026-09-27  
**文件角色**：產品需求、功能優先級與驗收條件的最高指導文件。工程 implementation 必須同時遵循 root `README.md`。

> **架構決策已更新**
>
> v1 Closed Beta 採用：
>
> `React + Vite + Cloudflare Workers + Hono + Cloudflare D1 + Gemini API`
>
> 不再採用舊文件中的：
>
> `Next.js Server Actions + FastAPI + PostgreSQL + Supabase + Vercel`

---

# 一、執行摘要與產品願景

## 核心理念

> **Rely on AI, Rely on ReLai**

ReLai 是一款以英愛通用（British + Irish English）為語言定位、以愛爾蘭視角為品牌底色的 AI 英語學習工具。

### v1.0–v2.0：AI 英語第二大腦

使用者把原本就在接觸的英文內容：

- 語校白板
- 課堂筆記
- 工作中犯的英文錯誤
- 日常看到的單字或片語

直接丟進 ReLai。

系統把內容整理成：

- `Vocabulary`
- `Error Log`

並持續累積成個人化語言知識庫。

### v3.0+：英文能力提升平台

未來再延伸：

- IELTS 題庫
- Speaking
- Writing
- 個人化學習路徑
- Spaced Repetition
- 弱點分析

v1 不預先為這些需求建立複雜架構。

---

# 二、v1 Closed Beta 驗證目標

目前預計測試使用者 **少於 10 人**。

本階段驗證的是產品本身，而不是驗證大規模 SaaS infrastructure。

## v1 必須回答的問題

1. 使用者是否願意把真實英文內容交給 ReLai？
2. AI 產出的 Vocabulary / Error Log 是否真的有複習價值？
3. 圖片輸入是否比手動整理筆記明顯省時間？
4. 使用者是否會回來複習自己的卡片？
5. Streak / Daily Goal 是否能增加回訪？
6. Error Log 是否能形成 ReLai 的明確差異化？
7. TTV 是否足夠低，讓使用者覺得「丟進去就完成」？

## v1 不驗證

目前不需要：

- 公開註冊轉換率
- OAuth conversion
- 大規模 multi-tenant
- subscription billing scalability
- social graph
- enterprise SSO
- high availability multi-region database architecture

---

# 三、North Star Metric

## Time-to-Value（TTV）

從使用者按下送出，到看見可使用的 AI 卡片：

> **目標 ≤ 5 秒**

這是產品體驗指標，不保證所有 AI request 都必然在 5 秒完成。

### 工程保障

必須具備：

- submit 後立即顯示 Skeleton Cards
- processing state
- server-side timeout
- retry UX
- AI error fallback
- latency logging
- 弱網路測試

建議觀測：

```text
request_started_at
ai_started_at
ai_finished_at
response_received_at
```

若 AI model 本身 latency 高於目標，不應用假 progress 或假結果掩飾。

---

# 四、成長路徑

```text
Phase 1 — v1.0
Closed Beta / AI 第二大腦
文字 + 圖片 → Vocabulary / Error Log
Cards + Review + Streak + Daily Goal
Cloudflare prototype
        ↓
Phase 2 — v2.0
IELTS Vocabulary / Reading
錯題加入個人卡片庫
付費牆與訂閱
        ↓
Phase 3 — v2.1
FSRS / Spaced Repetition
智能複習
        ↓
Phase 4 — v3.0+
Speaking / Writing
學習路徑
UGC
多國語境
```

---

# 五、目標使用者

## A. 愛爾蘭語校 / 打工度假族

核心 Beachhead。

常見場景：

- 語校白板拍照
- 老師糾正文法
- 工作時聽到新片語
- 愛爾蘭人在地用語
- IELTS 課堂筆記

## B. IELTS 備考族

v2 主要擴張族群。

## C. 外商職場英文族

把工作中被修改過的句子轉成 Error Log。

---

# 六、核心差異化

## 1. Error Log

ReLai 不只記「不知道的東西」，也記「自己曾經犯過的錯」。

Error Log 結構：

```text
錯誤原句
→ 正確句
→ 錯誤類型
→ 繁中解釋
```

## 2. 英愛語境

`irish_usage` 只在確實具有英國 / 愛爾蘭語境差異時出現。

AI 不得為了填滿欄位而虛構在地用法。

## 3. 哩來通路

ReLai 與哩來愛爾蘭的語校 / 打工度假 / 留學流程串聯。

---

# 七、v1 功能範疇（MoSCoW）

## P0 — Must Have

- 管理員預建帳號
- Username/password 登入
- 不提供註冊
- 文字輸入 → AI cards
- 圖片輸入 → multimodal AI cards
- Vocabulary
- Error Log
- Card gallery
- Card flip
- 收藏
- Card persistence
- Edit / Delete
- Review event
- Daily Goal
- Streak
- Home summary
- 基本 onboarding
- PWA app shell
- 已載入 cards 離線瀏覽
- offline review queue
- D1 persistence
- Gemini server-side integration

## P1 — Should Have

- 「7 天未複習」優先排序
- Achievement badges
- Error Log 快速模板
- 管理員 password reset script
- 基礎 learning stats

## P2 — Could Have

- Voice input
- 更完整 analytics
- install prompt UX
- richer onboarding animation

## v1 明確不做

- Public signup
- Google login
- Apple login
- Email verification
- Forgot-password email flow
- User self-service password change
- Payment
- R2 image library
- FSRS
- IELTS question bank
- Speaking / Writing AI scoring

---

# 八、v1 系統架構

```text
                        Gemini API
                  OCR + Structured Output
                           ▲
                           │
                           │
Browser / PWA ─────► Cloudflare Worker
                           │
                 ┌─────────┴─────────┐
                 │                   │
               Hono                  D1
              API layer          Application DB
                 │
        React/Vite Static Assets
```

## Same-origin 原則

Frontend 與 API 使用相同 domain：

```text
https://relai.example.com/
https://relai.example.com/api/v1/*
```

優點：

- Cookie session 更簡單
- 不需額外 CORS complexity
- 一次 deploy
- 一套 observability
- prototype 維運成本最低

---

# 九、技術選型

| Layer | v1 |
|---|---|
| Frontend | React + TypeScript |
| Build | Vite |
| Router | React Router |
| Styling | TailwindCSS |
| Runtime | Cloudflare Workers |
| Worker routing | Hono |
| DB | Cloudflare D1 |
| DB interface | D1 prepared statements |
| Validation | Zod |
| Auth | Pre-provisioned account + opaque session |
| AI | Gemini API |
| AI model | env configurable，default `gemini-3.8-flash` |
| PWA | Service Worker + IndexedDB |
| Deployment | Cloudflare Workers + Static Assets |

## 不再使用

```text
Next.js server runtime
FastAPI
Uvicorn
SQLAlchemy
Alembic
PostgreSQL
Supabase Auth
Supabase Storage
Supabase RLS
Vercel
```

現有 Next.js UI 是 migration source，不是未來 runtime constraint。

---

# 十、Authentication

## Closed Beta 原則

沒有 registration。

流程：

```text
ReLai Admin
   ↓
建立帳號
   ↓
發 username + random password
   ↓
User /login
   ↓
Worker credential verification
   ↓
Session cookie
```

### User Story — Login

**US-AUTH-001**

身份：Closed Beta 使用者  
行動：輸入 ReLai 提供的 username + password  
結果：登入並進入 `/home`

驗收：

- 錯誤帳密回傳 generic login error
- 不透露 username 是否存在
- disabled user 不得登入
- successful login 更新 `last_login_at`
- 建立 HttpOnly session cookie
- 登入後 `/api/v1/auth/me` 可取得目前 user profile

### Logout

**US-AUTH-002**

- 刪除 server-side session
- 清除 cookie
- redirect `/login`

### 帳號建立

沒有 public endpoint。

透過：

```text
scripts/manage-user.ts
```

或等價的 admin-only local script。

例如：

```bash
npm run user:create
npm run user:reset-password
npm run user:disable
```

Production 不暴露 `/api/admin/create-user` 給一般 Internet client。

---

# 十一、Auth Security

因為 v1：

- 使用者 <10
- password 由系統發放
- password 為高 entropy random secret
- 沒有 user-chosen weak password

Prototype credential 可使用 Worker Web Crypto + server-side pepper。

D1 不保存：

- plaintext password
- raw session token

Worker Secret：

```text
AUTH_PEPPER
```

未來若開放 self-registration / consumer password，auth architecture 必須重新評估，不把 prototype credential scheme 直接視為 public production auth。

---

# 十二、Database Schema

D1 為 v1 唯一 application database。

## `users`

```text
id TEXT PK
username TEXT UNIQUE NOT NULL
display_name TEXT NOT NULL
password_salt TEXT NOT NULL
password_digest TEXT NOT NULL
role TEXT NOT NULL DEFAULT 'user'
is_active INTEGER NOT NULL DEFAULT 1
cohort_source TEXT
created_at TEXT NOT NULL
updated_at TEXT NOT NULL
last_login_at TEXT
```

## `sessions`

```text
id TEXT PK
user_id TEXT NOT NULL
token_digest TEXT UNIQUE NOT NULL
created_at TEXT NOT NULL
expires_at TEXT NOT NULL
last_seen_at TEXT
```

## `source_items`

```text
id TEXT PK
user_id TEXT NOT NULL
source_type TEXT NOT NULL
raw_text TEXT
processing_status TEXT NOT NULL
ai_model TEXT
created_at TEXT NOT NULL
updated_at TEXT NOT NULL
```

`source_type`：

```text
text
image
```

`processing_status`：

```text
pending
processed
failed
```

## `flashcards`

```text
id TEXT PK
user_id TEXT NOT NULL
source_item_id TEXT
card_type TEXT NOT NULL
front_content TEXT NOT NULL
back_content TEXT NOT NULL
part_of_speech TEXT
zh_tw_definition TEXT
explanation TEXT
irish_usage TEXT
source TEXT
is_favorite INTEGER NOT NULL DEFAULT 0
last_reviewed_at TEXT
next_review_at TEXT
created_at TEXT NOT NULL
updated_at TEXT NOT NULL
```

`card_type`：

```text
vocabulary
error_log
```

## `review_events`

```text
id TEXT PK
client_event_id TEXT UNIQUE NOT NULL
user_id TEXT NOT NULL
card_id TEXT NOT NULL
review_result TEXT NOT NULL
reviewed_at TEXT NOT NULL
created_at TEXT NOT NULL
```

## `user_stats`

```text
user_id TEXT PK
streak_days INTEGER NOT NULL DEFAULT 0
longest_streak INTEGER NOT NULL DEFAULT 0
total_cards_created INTEGER NOT NULL DEFAULT 0
total_reviews INTEGER NOT NULL DEFAULT 0
last_active_date TEXT
updated_at TEXT NOT NULL
```

## `user_settings`

```text
user_id TEXT PK
daily_goal INTEGER NOT NULL DEFAULT 10
timezone TEXT NOT NULL
created_at TEXT NOT NULL
updated_at TEXT NOT NULL
```

---

# 十三、Database 設計規則

## ID

使用：

```ts
crypto.randomUUID()
```

存 `TEXT`。

## 時間

所有 timestamp server-side 以 UTC ISO-8601 儲存。

Date-only：

```text
YYYY-MM-DD
```

Streak 計算使用 user timezone。

## Ownership

所有 user data query 都必須：

```sql
WHERE user_id = ?
```

API 不接受 client 自稱：

```json
{
  "user_id": "..."
}
```

作為 authorization。

## Index

至少：

```text
users(username)
sessions(token_digest)
sessions(user_id)
sessions(expires_at)

flashcards(user_id, created_at)
flashcards(user_id, card_type)
flashcards(user_id, last_reviewed_at)
flashcards(user_id, is_favorite)

review_events(user_id, reviewed_at)
review_events(client_event_id)
```

---

# 十四、Migration

Schema source of truth：

```text
/migrations
```

不使用 Supabase migration。

不使用 Alembic。

規則：

1. migration append-only
2. production 已套用 migration 不回頭修改
3. schema change 必須 commit SQL file
4. local D1 先驗證
5. 再 remote apply
6. migration failure 不得偷偷用 Dashboard 修 schema 後不留紀錄

---

# 十五、AI 策略

## Provider

v1：Gemini API。

Model：

```text
GEMINI_MODEL
```

預設：

```text
gemini-3.8-flash
```

不要把 model string 寫死在 service logic。

## API key

```text
GEMINI_API_KEY
```

Cloudflare Worker secret only。

不得出現在：

- client bundle
- `VITE_*`
- Git
- D1
- logs

---

# 十六、AI Structured Output

AI 的責任是 extraction，不是決定 application authorization / persistence。

預期 schema：

```json
[
  {
    "type": "vocabulary",
    "front_content": "grand",
    "part_of_speech": "adj.",
    "zh_tw_definition": "很好、很棒",
    "back_content": "That's grand.",
    "explanation": "這樣很好。",
    "irish_usage": "在愛爾蘭日常口語中 grand 很常表示很好、沒問題。"
  }
]
```

Error Log：

```json
[
  {
    "type": "error_log",
    "front_content": "I didn't went there.",
    "back_content": "I didn't go there.",
    "part_of_speech": "文法錯誤",
    "zh_tw_definition": null,
    "explanation": "didn't 後方使用原形動詞 go。",
    "irish_usage": null
  }
]
```

Server 必須用 Zod validation。

Invalid AI output：

- 最多 retry / repair 一次
- failure → `processing_status=failed`
- 不寫半成品 cards

---

# 十七、AI System Prompt 原則

核心角色：

> 你是 ReLai 的英語學習資料提取引擎，負責把使用者文字或圖片中的英文內容轉換為 Vocabulary / Error Log 結構化資料。

規則：

1. 繁體中文解釋
2. British / Irish English aware
3. 不自行創造使用者沒提供的錯誤句
4. `irish_usage` 只有真正具英愛差異時填寫
5. 不確定時填 `null`
6. 不輸出 markdown
7. 不輸出 schema 外欄位
8. 沒有有效內容時回空 array
9. 圖片先理解文字內容，再做 extraction
10. prompt 版本應集中管理，不散落 route

建議：

```text
src/worker/services/ai/prompts/
```

---

# 十八、圖片輸入

## v1 Policy

圖片是 transient。

```text
Browser
 → Worker
 → Gemini
 → card data
 → discard image
```

不使用：

- Supabase Storage
- R2
- persistent base64

D1 不保存 image binary。

支援優先：

- JPEG
- PNG
- WebP

HEIC 在 client 端轉換後再送 server。

安全限制：

- MIME validation
- file size limit
- request timeout
- 不把圖片 bytes 寫 log

---

# 十九、API Design

Prefix：

```text
/api/v1
```

## Auth

```text
POST /auth/login
POST /auth/logout
GET  /auth/me
```

## Ingestion

```text
POST /ingestion/text
POST /ingestion/image
```

## Cards

```text
GET    /cards
GET    /cards/:id
PATCH  /cards/:id
DELETE /cards/:id
POST   /cards/:id/favorite
```

## Reviews

```text
POST /reviews
```

## Stats

```text
GET /stats/summary
```

## Settings

```text
GET   /settings
PATCH /settings
```

---

# 二十、Ingestion Flow

```text
Request
 ↓
Auth middleware
 ↓
Input validation
 ↓
Create source_item(pending)
 ↓
Gemini
 ↓
Zod validation
 ↓
D1 write cards
 ↓
Update source_item(processed)
 ↓
Update stats
 ↓
Response
```

AI error：

```text
source_item.failed
```

避免：

```text
AI 成功一半
→ DB 寫兩張
→ 第三張 validation fail
→ 留下一半資料
```

Cards persistence 應視為一個完整 operation。

---

# 二十一、Cards

## Gallery

Filter：

```text
All
Vocabulary
Error Log
Favorites
Needs Review
```

## Needs Review

v1 P1：

```text
last_reviewed_at IS NULL
OR last_reviewed_at < now - 7 days
```

UI 標示：

```text
需要複習
```

## Card Flip

Vocabulary 背面：

- part of speech
- zh definition
- example
- translation
- irish usage if present

Error Log：

- wrong sentence
- correct sentence
- error type
- explanation

---

# 二十二、Review Events

每次有效複習送：

```json
{
  "client_event_id": "uuid",
  "card_id": "uuid",
  "review_result": "viewed",
  "reviewed_at": "ISO timestamp"
}
```

Server：

1. authentication
2. card ownership validation
3. idempotency
4. insert event
5. update card `last_reviewed_at`
6. update user stats / streak

`client_event_id` unique 用來處理 offline retry。

---

# 二十三、Daily Goal

Default：

```text
10 reviews/day
```

不是生成 10 張。

設定：

```text
user_settings.daily_goal
```

今日完成數由 review event 計算。

前端可 optimistic update，但 server 為最終真相。

---

# 二十四、Streak

觸發：

> 使用者某個 local calendar day 至少完成 1 次 review。

不是單純登入。

計算依：

```text
user_settings.timezone
```

第一次登入 onboarding 時可由 browser timezone 初始化。

v1 不做 Streak Freeze。

---

# 二十五、Offline / PWA

離線可以：

- 打開 app shell
- 看已 cache cards
- 翻卡
- 建立 review queue

離線不能：

- AI extraction
- account login
- server card edit guarantee

## Offline Review

```text
review
 ↓
IndexedDB queue
 ↓
optimistic UI
 ↓ internet restored
POST /reviews
 ↓
client_event_id idempotency
```

---

# 二十六、Onboarding

Closed Beta 不需要 signup onboarding。

首次登入：

1. Welcome
2. 解釋文字輸入
3. 解釋圖片輸入
4. 示範 Vocabulary
5. 示範 Error Log
6. 開始使用

30 秒內可完成。

可 skip。

---

# 二十七、Pages

```text
/login
/home
/cards
/stats
/settings
```

Future：

```text
/quiz
/subscription
```

現有 prototype UI 應優先保留，不在 infrastructure migration 中大幅 redesign。

---

# 二十八、UI Design System

風格：

> Minimal productivity SaaS

色彩延續：

| 用途 | HEX |
|---|---|
| Irish Green | `#2D7A4F` |
| Dark Green | `#1E5C3A` |
| Background | `#FFFFFF` |
| Card | `#F8F9FA` |
| Error Card | `#FFF0F0` |
| Text | `#1A1A2E` |
| Secondary | `#6B7280` |

---

# 二十九、User Stories

## US-001 文字生成

身份：登入使用者  
行動：貼上英文內容  
結果：產生 Cards

驗收：

- auth required
- non-empty validation
- processing UX
- AI JSON validated
- cards persisted to D1
- cards immediately visible

## US-002 圖片生成

- auth required
- image type / size validation
- Gemini multimodal extraction
- image 不持久化
- failure 可 retry

## US-003 Mixed Content

一次輸入可產生：

```text
Vocabulary + Error Log
```

## US-004 Browse Cards

- filter
- favorite
- needs-review ordering
- offline cached view

## US-005 Review

- card flip
- review event
- `last_reviewed_at`
- Daily Goal update
- Streak update

## US-006 Edit

- ownership required
- validated PATCH
- D1 update
- UI 不需 full reload

## US-007 Delete

- confirm
- ownership required
- delete/update UI

## US-008 Login

- pre-issued credential
- no signup
- HttpOnly session
- invalid generic error

## US-009 Logout

- session revocation
- cookie clear

## US-010 First Login

- short onboarding
- demo cards
- skip supported

---

# 三十、Admin Account Operations

v1 admin 操作不是產品 UI。

透過 script：

```text
create user
reset password
disable user
list beta users
```

要求：

- production DB 操作必須是明確 command
- random password 顯示一次給管理員
- log 不記 password
- reset 後舊 credential 失效
- disable user 時 active sessions 一併 revoke

---

# 三十一、Observability

Prototype 需要 minimal logging。

可記：

- route
- HTTP status
- latency
- AI latency
- AI model
- card count generated
- error category

不可記：

- password
- session token
- AUTH_PEPPER
- GEMINI_API_KEY
- full uploaded image
- unnecessary raw learning content

---

# 三十二、Error Model

API error shape 建議：

```json
{
  "error": {
    "code": "AI_TIMEOUT",
    "message": "這次解析時間較久，請再試一次。"
  }
}
```

不要把：

```text
SQLite error
stack trace
Gemini raw error body
secret
```

直接傳給 client。

---

# 三十三、Codex Engineering Constraints

Codex 必須：

1. 先讀 root README。
2. 再讀 PRD。
3. 不依 legacy FastAPI / Supabase docs 建新功能。
4. 不重新加入 PostgreSQL。
5. 不建立 register endpoint。
6. 不將 Gemini key 放 client。
7. 不直接從 browser 操作 D1。
8. 不持久化 v1 圖片。
9. schema change 用 migration。
10. SQL 用 prepared statements。
11. ownership 由 session 決定。
12. input / AI output 使用 runtime validation。
13. infrastructure migration 不隨意改 UI。
14. 保持每個 phase buildable。
15. 做最低限度測試。

---

# 三十四、Repository Target

```text
src/
├─ client/
├─ worker/
└─ shared/

migrations/
scripts/
public/
docs/

README.md
ReLai_PRD_v3.1.md
package.json
vite.config.ts
wrangler.jsonc
```

Legacy：

```text
frontend-web/
backend/
database/
infra/supabase/
```

遷移完成後移除。

---

# 三十五、Cloudflare bindings

```text
DB
GEMINI_API_KEY
AUTH_PEPPER
GEMINI_MODEL
APP_ENV
```

Secrets：

```text
GEMINI_API_KEY
AUTH_PEPPER
```

不是 secrets：

```text
GEMINI_MODEL
APP_ENV
```

---

# 三十六、Development Flow

```text
npm install
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
npm run preview
npm run deploy
```

D1：

```text
wrangler d1 migrations create
wrangler d1 migrations apply --local
wrangler d1 migrations apply --remote
```

---

# 三十七、Implementation Roadmap

## Phase 0 — Documentation

- README 更新
- PRD 更新
- legacy architecture 標示 deprecated

## Phase 1 — Runtime Migration

- Next UI → Vite React
- Router
- Cloudflare Vite plugin
- Hono health endpoint
- Worker deploy

Exit criteria：

```text
UI 看起來與 prototype 基本一致
Cloudflare URL 可正常載入
/api/v1/health 正常
```

## Phase 2 — D1

- DB create
- migrations
- core tables
- indexes
- queries

## Phase 3 — Auth

- user management script
- login
- session
- logout
- protected routes

## Phase 4 — Real Data

- cards API
- settings
- review
- stats
- mock data replacement

## Phase 5 — AI

- text ingestion
- image ingestion
- prompt
- Zod structured output
- retry
- latency

## Phase 6 — PWA

- service worker
- IndexedDB
- offline review queue

---

# 三十八、v2 保留方向

v2：

- IELTS Vocabulary
- IELTS Reading
- 錯題 → Card
- Subscription
- Streak Freeze
- R2 image retention（Pro 可評估）
- richer analytics

不要為 v2 預先把 v1 複雜化。

---

# 三十九、資料與隱私

使用者資料包含：

- learning input
- error logs
- review behavior

若未來拿匿名 Error Log 做：

- IG content analysis
- Taiwanese learner insights
- AI improvement

必須：

- Privacy Policy 清楚告知
- 去識別化
- 提供 opt-out
- 不把 individual learning data 公開

v1 Closed Beta 也應遵守此方向。

---

# 四十、成功指標

Closed Beta 優先看：

| Metric | 說明 |
|---|---|
| TTV | submit → card |
| Extraction success rate | AI 成功生成有效 cards |
| Weekly active beta users | 是否真的回來 |
| Reviews per user | 是否有複習 |
| Cards per user | 是否累積 |
| Error Log ratio | 差異化功能是否被使用 |
| 7-day return | 小樣本只看方向，不做統計過度解讀 |

公開版後再正式追：

- D7
- D30
- conversion
- paid retention

---

# 四十一、Architecture Source of Truth

如果文件互相衝突：

### 產品需求

以：

```text
ReLai_PRD_v3.1.md
```

為準。

### Infrastructure / implementation

以：

```text
README.md
```

為準。

舊文件中出現：

```text
FastAPI
Supabase
PostgreSQL
Next.js Server Actions
Vercel
```

一律視為 **deprecated architecture**，除非新版 README/PRD 明確重新採用。

---

# 四十二、最終 v1 原則

ReLai v1 的工程方向可以濃縮成：

```text
一個 React App
一個 Cloudflare Worker
一個 D1 Database
一個 Gemini integration
少於 10 個 Closed Beta 使用者
沒有 public signup
沒有圖片儲存
沒有 microservices
```

先證明：

> 使用者願意把自己的英文內容變成 ReLai Cards，並且會回來複習。

產品證明有價值之後，再擴張 infrastructure。

---

**文件版本：PRD v3.1 — Cloudflare Prototype 架構修訂版**  
**最後更新：2026-09-27**
