# ReLai Backend

這個目錄是 ReLai 的後端工作區，使用 `FastAPI` 作為 API 框架，負責承接前端請求、整合 AI 能力、處理商業邏輯，並將資料寫入 `Supabase PostgreSQL`。

目前這裡已建立最小骨架，後續所有 API、服務邏輯、資料庫模型與 AI orchestration 都會在這裡落地。

## 後端目標

ReLai 後端主要負責以下事情：

- 驗證使用者身份
- 接收文字輸入與圖片上傳
- 呼叫 AI 進行 OCR 與內容抽取
- 生成 `Vocabulary` 與 `Error Log` 資料
- 提供 flashcards、review、stats、settings 等 API
- 將資料寫入與讀取 PostgreSQL
- 管理與 Supabase 的整合邏輯

簡單說，前端負責體驗與互動，後端負責「真正的產品邏輯」。

## 技術選型

目前後端規劃採用：

- `FastAPI`：API 框架
- `Uvicorn`：本地開發與部署執行器
- `SQLAlchemy 2`：ORM / 資料存取抽象
- `psycopg`：PostgreSQL driver
- `pydantic-settings`：環境變數與設定管理

後續預計擴充：

- Alembic migration
- Supabase Auth token 驗證
- AI client 封裝
- 服務分層測試

## 目錄結構

```text
backend/
├─ app/
│  ├─ main.py
│  ├─ core/
│  │  ├─ config.py
│  │  ├─ database.py
│  │  └─ security.py
│  ├─ api/
│  │  ├─ deps.py
│  │  └─ v1/
│  ├─ models/
│  ├─ schemas/
│  ├─ repositories/
│  ├─ services/
│  │  ├─ ai/
│  │  ├─ cards/
│  │  ├─ stats/
│  │  ├─ auth/
│  │  └─ storage/
│  └─ tests/
├─ alembic/
├─ .env.example
├─ pyproject.toml
└─ README.md
```

## 各層責任

### `app/main.py`

FastAPI 應用程式入口。

責任：

- 建立 `FastAPI` app
- 掛載 router
- 掛載中介層
- 提供健康檢查與系統級 endpoint

### `app/core/`

系統基礎能力。

- `config.py`：環境變數與設定
- `database.py`：資料庫連線、session 管理
- `security.py`：token 驗證、權限檢查、身份相關工具

這一層不放業務邏輯，只放通用基礎設施。

### `app/api/`

API route layer。

責任：

- 定義 route
- 接收 request
- 驗證輸入
- 呼叫 service
- 回傳 response schema

原則：

- route 只做 HTTP 邊界處理
- 不在 route 內寫複雜商業邏輯
- 不直接在 route 內拼 SQL

### `app/schemas/`

Pydantic request / response schema。

責任：

- request body schema
- query param schema
- response schema
- service layer 的資料傳遞結構

命名建議：

- `FlashcardCreateRequest`
- `FlashcardListResponse`
- `ReviewSubmitRequest`

### `app/models/`

SQLAlchemy ORM model。

責任：

- 定義資料表映射
- 欄位型別
- 關聯關係
- 共用 model mixin

原則：

- model 只描述資料結構
- 不把高階流程邏輯塞進 model method

### `app/repositories/`

資料存取層。

責任：

- 封裝查詢
- 封裝新增 / 更新 / 刪除
- 隔離 ORM 與 service 層

原則：

- repository 不處理 HTTP
- repository 不負責跨多步驟商業判斷
- repository 專注在資料存取與查詢重用

### `app/services/`

商業邏輯層，是後端的核心。

建議子區塊：

- `services/ai/`：AI client、prompt、OCR / extraction orchestration
- `services/cards/`：flashcards 與 error logs 的核心流程
- `services/stats/`：streak、daily goal、首頁統計
- `services/auth/`：登入身份映射、使用者初始化
- `services/storage/`：圖片上傳、檔案 URL、storage 封裝

原則：

- service 負責流程編排
- service 可以組合多個 repository
- service 可以呼叫 AI 與外部平台
- 複雜商業邏輯應集中在 service

### `app/tests/`

測試放置區。

建議分法：

- `tests/api/`
- `tests/services/`
- `tests/repositories/`

## API 規劃

目前建議的 v1 API 區塊如下：

```text
/api/v1/auth
/api/v1/ingestion
/api/v1/flashcards
/api/v1/error-logs
/api/v1/reviews
/api/v1/stats
/api/v1/settings
```

### 1. `/api/v1/auth`

責任：

- 驗證 Supabase user
- 建立 app 內的 profile
- 取得目前登入使用者資訊

### 2. `/api/v1/ingestion`

責任：

- 接收文字輸入
- 接收圖片上傳
- 呼叫 OCR / AI extraction
- 將抽取結果轉成 flashcards / error logs

這一塊是 ReLai 的核心入口。

### 3. `/api/v1/flashcards`

責任：

- flashcard 列表
- 單筆查詢
- 收藏 / 取消收藏
- 刪除或封存
- 更新 review 狀態

### 4. `/api/v1/error-logs`

責任：

- error log 列表
- 單筆查詢
- 修正說明
- 收藏 / 刪除 / review 更新

### 5. `/api/v1/reviews`

責任：

- 提交一次複習結果
- 建立 review event
- 更新 `last_reviewed_at`
- 觸發 streak 與 daily progress 計算

### 6. `/api/v1/stats`

責任：

- 首頁摘要
- 今日進度
- streak
- review 次數
- vocabulary / error log 分佈

### 7. `/api/v1/settings`

責任：

- 每日目標
- 個人偏好
- 後續擴充通知、複習偏好等設定

## Coding Convention

### 1. 路由保持薄

route 應只處理：

- request parsing
- auth dependency
- 呼叫 service
- response formatting

不要在 route 寫：

- 複雜商業邏輯
- 多步驟交易流程
- 重複 SQL

### 2. service 負責流程

例如 ingestion 流程應該長這樣：

1. 驗證使用者
2. 建立 `source_item`
3. 呼叫 OCR 或文字 extraction
4. 標準化 AI 回傳資料
5. 寫入 flashcards / error_logs
6. 回傳整理後結果

這類邏輯應集中在 service，不應散在 route 或 repository。

### 3. schema 與 ORM 分離

- `schemas/` 負責 API 輸入輸出
- `models/` 負責資料庫映射

不要把 ORM model 直接當 API response 使用。

### 4. 命名一致

建議命名原則：

- model：`Flashcard`, `ErrorLog`, `UserStat`
- schema：`FlashcardCreateRequest`, `FlashcardResponse`
- repository：`FlashcardRepository`
- service：`FlashcardService`, `IngestionService`

### 5. 外部整合集中封裝

Supabase、AI provider、Storage client 不要散落在各處，應集中封裝在對應 service 或 client module。

## 設定檔

目前設定集中於：

- [`backend/.env.example`](D:/04_Lilaiireland/04_products/relai-prototype/backend/.env.example)
- [`backend/app/core/config.py`](D:/04_Lilaiireland/04_products/relai-prototype/backend/app/core/config.py)

目前已預留的環境變數：

- `APP_NAME`
- `APP_ENV`
- `APP_HOST`
- `APP_PORT`
- `DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_API_KEY`

後續可再加入：

- JWT audience / issuer
- storage bucket name
- AI model name
- logging level

## 本地開發

### 安裝依賴

```bash
cd backend
pip install -e .
```

### 啟動開發伺服器

```bash
cd backend
python -m uvicorn app.main:app --reload
```

預設健康檢查：

```text
GET /health
```

## 測試建議

後端測試建議至少包含三層：

### 1. API 測試

驗證：

- route 是否正確
- request / response schema 是否符合預期
- auth dependency 是否生效

### 2. Service 測試

驗證：

- ingestion 流程
- flashcard / error log 生成邏輯
- stats 聚合
- streak 更新

### 3. Repository 測試

驗證：

- CRUD 是否正確
- 查詢條件是否正確
- 關聯與 transaction 是否符合預期

## 與前端、資料庫的邊界

後端與其他層的邊界如下：

- 前端不直接承載 AI extraction 邏輯
- 前端不直接操作核心資料表
- 後端是前端與資料庫之間的主要業務邊界
- Supabase 主要提供底層能力，但產品邏輯仍以 FastAPI 為主

這個原則很重要，因為 ReLai 的價值不在單純 CRUD，而在 AI 抽取、學習結構化、複習行為與統計規則。
