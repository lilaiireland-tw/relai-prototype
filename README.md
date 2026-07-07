# ReLai 哩來語感特訓

ReLai（哩來語感特訓）是一個以 AI 驅動的英文語感學習產品，目標是把使用者日常接觸到的英文內容，快速轉換成可複習、可累積、可追蹤的學習資產。

它不是單純的單字卡工具，也不是傳統題庫練習器。ReLai 的核心價值在於：

- 讓使用者把「真實看到的英文內容」直接丟進系統
- 由 AI 自動整理成 `Vocabulary` 與 `Error Log`
- 用輕量、低摩擦的方式進行複習
- 逐步累積個人化的語感資料庫與學習紀錄

這個 repo 是 ReLai 的專案級工作區，包含前端、後端、資料庫規劃、Supabase 基礎設施，以及相關文件。

## ReLai 在做什麼

ReLai 的產品方向可以簡單理解成：

1. 使用者貼上一段英文文字，或上傳一張包含英文內容的圖片
2. 後端呼叫 AI 做 OCR、語意分析與內容抽取
3. 系統自動生成兩種學習內容：
   - `Vocabulary`：值得記的單字、片語、用法
   - `Error Log`：錯誤句子、正確句子、修正原因
4. 前端把這些內容用閃卡、列表、進度與統計方式呈現
5. 使用者透過每日目標、streak、review 記錄持續累積學習成果

這樣的設計，核心不是讓使用者「額外找題目學習」，而是把他原本就在接觸的英文內容直接轉成學習材料，降低學習阻力。

## 目前專案狀態

目前 repo 已完成的方向是：

- 已有一套 `Next.js` 前端 prototype
- 已完成專案重組，前端、後端、資料庫、infra 已分層
- 已建立 `FastAPI` 後端骨架
- 已確立資料庫採用 `PostgreSQL`
- 已確立透過 `Supabase` 承接 PostgreSQL、Auth、Storage

目前還在規劃與逐步落地的部分包括：

- FastAPI API 規格與路由實作
- PostgreSQL schema 與 migration
- Supabase RLS / policy
- AI extraction 流程
- 前後端正式串接

## 技術架構總覽

### 前端

前端使用：

- `Next.js 14`
- `React 18`
- `TypeScript`
- `Tailwind CSS`
- `lucide-react`

前端負責：

- App Router 路由結構
- 介面呈現與互動
- onboarding、home、flashcards、error log 等頁面
- 後續與 FastAPI 的 API 串接
- 使用者登入狀態與前端 session 處理

目前前端已經有 prototype 頁面，可作為產品 UI 與流程的基礎。

### 後端

後端規劃使用：

- `FastAPI`
- `SQLAlchemy 2`
- `psycopg`
- `pydantic-settings`
- `uvicorn`

後端負責：

- API 設計與版本管理
- 驗證使用者身份
- 接收文字輸入與圖片上傳
- 呼叫 AI 服務進行 OCR / vocabulary extraction / error correction extraction
- 寫入與查詢 PostgreSQL 資料
- 提供 flashcards、error logs、reviews、stats、settings 等 API

### 資料庫與平台

資料庫與平台規劃使用：

- `PostgreSQL`
- `Supabase`

Supabase 在本專案中的角色：

- 託管 PostgreSQL
- 提供 Auth
- 提供 Storage
- 管理 migration、seed、RLS policy

這個選型的理由很直接：如果既然要接 Supabase，就應該直接以 PostgreSQL 為主，而不是再引入 MySQL，避免雙系統整合成本。

### AI 能力

根據目前 PRD 與系統規劃，AI 層主要負責：

- OCR 文字辨識
- 從原始內容抽出 vocabulary
- 產出 error log 修正卡
- 後續擴充為更完整的語感分析與題庫生成

目前後端骨架已預留 `services/ai/` 位置，後續會在這一層封裝 AI client、prompt 與 extraction 流程。

## 專案目錄結構

```text
relai-prototype/
├─ frontend-web/         # Next.js 前端
├─ backend/              # FastAPI 後端
├─ database/             # schema 草案、seed、資料模型規劃
├─ infra/supabase/       # Supabase migrations、policies、seeds
├─ docs/                 # 架構與專案文件
├─ assets/               # 設計參考圖與非程式資產
├─ ReLai_PRD_v3.1.md     # 產品需求文件
└─ README.md             # 專案級說明
```

### frontend-web

前端工作區，包含：

- `app/`：頁面與路由
- `components/`：共享元件
- `lib/`：前端資料與 helper
- `public/`：靜態資產

### backend

後端工作區，包含：

- `app/main.py`：FastAPI 入口
- `app/core/`：設定、資料庫、基礎安全邏輯
- `app/api/`：API route layer
- `app/models/`：資料模型
- `app/schemas/`：request / response schema
- `app/repositories/`：資料存取層
- `app/services/`：商業邏輯與 AI 整合層
- `alembic/`：migration

### database

放資料庫設計層的內容，例如：

- schema 草案
- seed 規劃
- 以產品需求角度描述資料模型

### infra/supabase

放實際要部署到 Supabase 的基礎設施檔案，例如：

- SQL migration
- row-level security policy
- seed scripts / SQL

### docs

放專案級文件。目前至少包含：

- [`docs/structure.md`](D:/04_Lilaiireland/04_products/relai-prototype/docs/structure.md)：目前的專案結構與責任分層

## 系統關係圖

```text
[使用者]
   |
   v
[frontend-web / Next.js]
   | \
   |  \-- auth / session / storage --> [Supabase]
   |
   \---- REST API ----> [backend / FastAPI]
                              |
                              |-- AI extraction / OCR
                              |
                              \-- PostgreSQL 存取 --> [Supabase PostgreSQL]
```

## 預計 API 區塊

目前規劃的 API 範圍如下：

```text
/api/v1/auth
/api/v1/ingestion
/api/v1/flashcards
/api/v1/error-logs
/api/v1/reviews
/api/v1/stats
/api/v1/settings
```

各區塊大致責任：

- `auth`：登入、身份驗證、使用者關聯
- `ingestion`：文字輸入、圖片上傳、AI extraction 入口
- `flashcards`：單字卡資料
- `error-logs`：錯誤修正卡資料
- `reviews`：複習紀錄與 review event
- `stats`：首頁摘要、streak、學習統計
- `settings`：每日目標與個人偏好設定

## 預計核心資料模型

目前規劃中的核心資料域如下：

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

簡單理解：

- `source_items`：使用者輸入的原始素材
- `flashcards`：抽出的單字卡
- `error_logs`：抽出的錯誤修正卡
- `review_events`：每次複習行為
- `user_stats`：streak、累積學習量、進度統計
- `user_settings`：daily goal 等個人設定

## 如何啟動

### 前端

前端目前是可運行的。

```bash
cd frontend-web
npm install
npm run dev
```

預設網址：

```text
http://localhost:3000
```

### 後端

後端目前已建立骨架，尚未完成正式 API 實作。

未來啟動方式預計會是：

```bash
cd backend
python -m uvicorn app.main:app --reload
```

預設網址預計為：

```text
http://localhost:8000
```

## 開發原則

這個專案目前採用以下分工原則：

- 前端專注於 UI、互動、狀態與使用體驗
- 後端專注於 API、商業邏輯、AI orchestration、資料存取
- 資料庫與 Supabase 設定不混進前端
- 專案文件集中放在 `docs/`
- PRD 是產品決策來源，實作要盡量對齊 PRD

## 相關文件

- [`ReLai_PRD_v3.1.md`](D:/04_Lilaiireland/04_products/relai-prototype/ReLai_PRD_v3.1.md)
- [`docs/structure.md`](D:/04_Lilaiireland/04_products/relai-prototype/docs/structure.md)
- [`frontend-web/README.md`](D:/04_Lilaiireland/04_products/relai-prototype/frontend-web/README.md)
- [`backend/README.md`](D:/04_Lilaiireland/04_products/relai-prototype/backend/README.md)

## 補充說明

目前 repo 內部分中文文案仍有歷史編碼問題，主要出現在較早的 prototype 檔案與部分文件。這不影響目前的結構整理，但如果接下來要進入正式開發，建議優先清理文字編碼與展示文案，避免後續 API、schema、UI 文案命名混亂。
