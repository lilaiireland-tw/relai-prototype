# ReLai Frontend

這個目錄是 ReLai（哩來語感特訓）的前端工作區，目前使用 `Next.js 14 + React 18 + TypeScript + Tailwind CSS` 建構產品原型與後續正式 Web 介面。

目前這一層的定位是：

- 承接產品 UI 與互動流程
- 呈現 onboarding、首頁、flashcards、error log 等核心畫面
- 未來透過 API 與 `FastAPI` 後端串接
- 搭配 `Supabase Auth` 管理登入狀態與前端 session

目前前端已可獨立啟動，作為產品 prototype 使用；資料仍以本地 mock data 為主，尚未正式接上後端與資料庫。

## 前端在做什麼

ReLai 前端的核心任務不是單純顯示頁面，而是把整個學習流程做成低摩擦、可快速上手的操作體驗。

目前對應的產品流程大致是：

1. 使用者進入產品
2. 看到 onboarding / splash 畫面
3. 進入首頁並看到輸入框、今日進度、統計摘要、最近學習內容
4. 進入 vocabulary flashcard 頁面做單字複習
5. 進入 error log 頁面看錯誤句與修正句
6. 後續再逐步接上真實資料、登入、AI extraction、統計與設定

也就是說，這個前端的任務是把 ReLai 的核心使用體驗先定型，再逐步替換掉 mock data 與暫時性的畫面邏輯。

## 技術棧

目前前端使用：

- `Next.js 14.2.35`
- `React 18.3.1`
- `TypeScript 5`
- `Tailwind CSS 3`
- `PostCSS`
- `ESLint`
- `lucide-react`

### 選型原因

#### Next.js

用於：

- App Router 路由管理
- React 應用結構
- 後續與 API / auth / deployment 整合

#### TypeScript

用於：

- 提高資料結構與元件介面的穩定性
- 配合後續 API schema 與 shared types

#### Tailwind CSS

用於：

- 快速建立產品 prototype
- 維持設計 token 與樣式一致性
- 支援後續頁面擴充

#### lucide-react

用於：

- 提供一致的 UI icon 系統

## 目前頁面

目前 prototype 主要頁面如下：

### `/`

Splash / onboarding 入口頁。

用途：

- 展示 ReLai 的產品第一印象
- 承接新用戶起始流程

對應檔案：

- [`app/page.tsx`](D:/04_Lilaiireland/04_products/relai-prototype/frontend-web/app/page.tsx)

### `/home`

首頁 dashboard。

用途：

- 顯示輸入區
- 顯示 daily progress
- 顯示 stats 摘要
- 顯示最近抽取內容

對應檔案：

- [`app/home/page.tsx`](D:/04_Lilaiireland/04_products/relai-prototype/frontend-web/app/home/page.tsx)

### `/flashcards`

Vocabulary flashcard 複習頁。

用途：

- 單字卡翻面
- 顯示字義、例句、用法
- 模擬收藏與下一張流程

對應檔案：

- [`app/flashcards/page.tsx`](D:/04_Lilaiireland/04_products/relai-prototype/frontend-web/app/flashcards/page.tsx)

### `/error-log`

Error log 複習頁。

用途：

- 顯示錯誤句
- 顯示正確句
- 顯示修正說明

對應檔案：

- [`app/error-log/page.tsx`](D:/04_Lilaiireland/04_products/relai-prototype/frontend-web/app/error-log/page.tsx)

## 目錄結構

```text
frontend-web/
├─ app/
├─ components/
├─ lib/
├─ public/
├─ .eslintrc.json
├─ next.config.mjs
├─ package.json
├─ package-lock.json
├─ postcss.config.js
├─ tailwind.config.ts
├─ tsconfig.json
└─ README.md
```

### `app/`

使用 Next.js App Router。

目前放：

- route page
- layout
- global css

### `components/`

共享 UI 元件。

目前已有：

- [`components/BottomNav.tsx`](D:/04_Lilaiireland/04_products/relai-prototype/frontend-web/components/BottomNav.tsx)
- [`components/ProgressRing.tsx`](D:/04_Lilaiireland/04_products/relai-prototype/frontend-web/components/ProgressRing.tsx)

### `lib/`

前端本地資料與 helper。

目前最主要是：

- [`lib/mock-data.ts`](D:/04_Lilaiireland/04_products/relai-prototype/frontend-web/lib/mock-data.ts)

這裡目前用來提供 prototype 階段的假資料，後續會逐步替換成 API client、型別與前端資料存取工具。

### `public/`

放前端可直接存取的靜態資產。

目前尚未大量使用，但已保留位置，之後可放：

- icon
- image
- manifest
- PWA 靜態檔

## 設計風格與 UI 基礎

目前 UI 以行動優先的學習工具體驗為方向，風格偏向：

- 簡潔
- 安靜
- 輕量
- 易掃描

目前可見的設計特徵包括：

- 主色以綠色系為主
- 卡片式學習內容呈現
- dashboard + flashcard flow
- 底部導覽列
- 單卡翻面交互

在 [`tailwind.config.ts`](D:/04_Lilaiireland/04_products/relai-prototype/frontend-web/tailwind.config.ts) 中已定義部分色彩 token，例如：

- `irish-green`
- `irish-green-dark`
- `card-gray`
- `error-bg`
- `text-primary`
- `text-secondary`

## 狀態管理與資料來源

目前前端資料來源仍以 mock data 為主，尚未接真實 API。

現況：

- 首頁資料來自 `lib/mock-data.ts`
- flashcards 與 error log 內容來自 `lib/mock-data.ts`
- 收藏、翻卡、前進下一張等互動，主要是本地 state 模擬

這代表目前前端是：

- 可運行
- 可展示流程
- 可作為 UI 開發基礎

但還不是正式的資料驅動產品。

## 與後端的邊界

前端未來會透過 `FastAPI` 取得與提交資料。

前端應負責：

- 畫面呈現
- 使用者互動
- 表單與輸入狀態
- API 呼叫與錯誤提示
- session 與前端 auth 狀態

前端不應負責：

- AI extraction 邏輯
- OCR 核心邏輯
- 複雜商業規則
- 直接操作核心資料表

也就是說，前端是體驗層，不是業務邏輯主體。

## 目前已知限制

### 1. 仍使用 mock data

這代表：

- 沒有真實登入流程
- 沒有真實資料持久化
- 沒有 API 錯誤處理流程

### 2. 部分文案有歷史編碼問題

目前某些頁面與資料檔存在亂碼，這是先前 prototype 檔案留下的編碼問題。

這不影響目前前端可 build，但會影響：

- 文案維護
- UI 檢查
- 後續 i18n / 文案整理

正式開發前，這一塊應該優先清理。

### 3. 尚未接上真實 auth 與 backend

目前畫面上看到的流程，多數仍是靜態或本地模擬。

## 本地開發

### 安裝依賴

```bash
cd frontend-web
npm install
```

### 啟動開發模式

```bash
cd frontend-web
npm run dev
```

啟動後可在瀏覽器開啟：

```text
http://localhost:3000
```

### 建置 production 版本

```bash
cd frontend-web
npm run build
```

### 啟動 production server

```bash
cd frontend-web
npm run start
```

## 常用指令

```bash
npm run dev
npm run build
npm run start
npm run lint
```

## 後續建議實作順序

前端下一步建議按這個順序做：

1. 清理編碼問題與畫面文案
2. 抽出 `lib/api/` 與資料型別
3. 建立與 `FastAPI` 的 API client
4. 接入登入狀態與 Supabase Auth
5. 將首頁、flashcards、error-log 改為真實資料驅動
6. 補上 stats、settings、onboarding 完整流程

## 相關文件

- [`README.md`](D:/04_Lilaiireland/04_products/relai-prototype/README.md)
- [`docs/structure.md`](D:/04_Lilaiireland/04_products/relai-prototype/docs/structure.md)
- [`backend/README.md`](D:/04_Lilaiireland/04_products/relai-prototype/backend/README.md)
- [`ReLai_PRD_v3.1.md`](D:/04_Lilaiireland/04_products/relai-prototype/ReLai_PRD_v3.1.md)
