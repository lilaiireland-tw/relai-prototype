# ReLai（哩來語感特訓）

ReLai 是「哩來愛爾蘭」面向在愛爾蘭學英文的臺灣學習者所開發的封閉測試（Closed Beta）原型。產品目標是把使用者接觸的單字與英文錯誤整理成值得反覆複習的卡片。D1 repository、CEFR-J 匯入工具、starter bootstrap 與產品 API 已建立；前端 onboarding、首頁、卡片、Error Log、統計與設定已接入 authenticated API。

## 目前已實作的應用程式

- 前端使用 React、TypeScript、Vite、React Router 與 Tailwind CSS，入口位於 `/relaiapp/`。
- 單一 Cloudflare Worker 在相同來源提供靜態前端及 Hono API；API 路徑以 `/relaiapp/api/v1/*` 開頭。
- 目前的 API 提供健康檢查、身分驗證、初始 CEFR-J 級別選擇／starter bootstrap，以及經驗證的 Cards、Reviews、Stats、Settings API。健康檢查只代表 Worker 可回應，不代表 D1 或產品功能已就緒。
- Cloudflare D1 的使用者、工作階段、卡片、複習、統計與設定 repository 已接入對應 API。CEFR-J A1–B2 共用目錄 schema 與本機匯入工具已建立；遠端匯入與部署狀態須另行查核。前端使用這些 API，不以 fixture 作為失敗時的備援資料。
- Gemini 是後續 AI 擷取功能預定使用的供應商；AI 擷取及 PWA／離線功能尚未實作。

## 封閉測試帳號與登入

系統不提供公開註冊。管理員透過 `npm run user:manage` 建立帳號：互動模式可輸入暫時密碼，原有非互動模式會產生隨機密碼。新帳號的 `must_change_password` 會設為必須變更；首次登入後，應用程式會導向 `/relaiapp/change-password`，完成密碼變更前無法進入產品頁面。已登入的使用者也可以從設定頁面自行變更密碼。

Worker 使用不透明、有效期七天的工作階段 cookie，設定 `HttpOnly`、`SameSite=Lax`，並在 HTTPS 下設定 `Secure`。D1 只保存密碼鹽值與摘要，以及工作階段權杖的摘要，不保存明文密碼或原始權杖。瀏覽器中的登入狀態只保存在記憶體；密碼與權杖不寫入 `localStorage` 或 `sessionStorage`。驗證設計與限制見[密碼學說明](docs/auth-crypto.md)，實際行為與操作步驟見[驗證 API](docs/auth-session-api.md)及[帳號管理手冊](docs/admin-accounts.md)。伺服器密鑰 `AUTH_PEPPER` 不得提供給前端。

## 環境與資料表結構

| 分支／環境 | Worker | D1 綁定 `DB` |
| --- | --- | --- |
| `develop`／staging | `relai-prototype-staging` | `relai-staging-db` |
| `main`／production | `relai-prototype` | `relai-prod-db` |

`wrangler.jsonc` 是 Worker 名稱及 D1 ID 的設定來源。Vite 在建置時選擇環境；一般開發與建置指令預設選擇 staging。兩個環境使用不同的資料庫。根目錄的 `migrations/` 是唯一的 D1 schema 來源，目前包含 `0001_initial_core_schema.sql`、`0002_add_users_must_change_password.sql` 與 `0003_add_cefr_j_vocabulary_foundation.sql`。遠端 migration 必須由操作人員明確執行，與 CI、部署分開；Playwright 僅自動套用隔離本機 D1 的 migration。僅憑儲存庫內容無法判定遠端 migration 或部署的即時狀態。詳見 [D1 環境](docs/d1-environments.md)與 [migration 流程](docs/d1-migrations.md)。

## 儲存庫結構

```text
src/client/          React 頁面、登入／產品狀態、API client 與僅供測試的 fixtures
src/worker/          Hono API、驗證、工作階段 middleware 與 D1 repository
migrations/          僅追加的 D1 SQL migration
scripts/             帳號管理 CLI、驗證工具與測試
docs/                操作與開發手冊
public/              靜態資產路由設定
wrangler.jsonc       Worker 與 D1 環境綁定
vite.config.ts       Vite 基底路徑與 Cloudflare 建置環境選擇
ReLai_PRD_v3.4.md   產品需求與後續階段設計
```

現有模組及其職責見[儲存庫結構說明](docs/structure.md)。

## 本機開發與驗證

使用 Node.js 24，並從儲存庫根目錄執行：

```sh
npm ci
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
npm run test:routing
```

在 Vite 開發伺服器開啟 `/relaiapp/`。Worker 可回應時，`GET /relaiapp/api/v1/health` 會傳回 `{"status":"ok"}`。本機開發使用模擬 D1。個別測試指令包括 `npm run test:auth-api`、`npm run test:admin`、`npm run test:persistence` 與 `npm run test:d1-schema`。

經授權的帳號操作須透過受保護的程序環境提供目標環境對應的 `AUTH_PEPPER`，並遵循[帳號管理手冊](docs/admin-accounts.md)。互動式建立 staging 帳號的指令為：

```sh
npm run user:manage -- create --interactive --env staging
```

一般本機驗證不應操作真實帳號或遠端資料庫。

## Playwright 瀏覽器 E2E

Vitest／Node 測試保留單元、元件、API、持久化及部署設定檢查；Playwright 以 Chromium 驗證真實 React → HTTP → 本機 Worker/Hono → 隔離的本機 D1。最後的 Cloudflare／staging 驗收仍由人工執行。

首次執行 `npx playwright install chromium`，再執行 `npm run test:e2e`。此指令自動重設測試資料、啟動本機應用程式、執行測試並關閉伺服器，不需要第二個終端機或 staging 密鑰。測試位於 `e2e/`；headed、UI、debug、報告、trace、選擇器慣例與新增測試範例見 [Playwright 工作流程](docs/playwright.md)。一般 PR 測試不得寫入 staging／production D1。

## 交付與部署

GitHub Actions 只執行 PR 品質檢查。儲存庫核准的 staging 流程由 Cloudflare Workers Builds 負責從 `develop` 自動部署，使用 `npm run build:staging:validated` 與 `npm run deploy:staging:built`；後者部署經驗證的 staging 建置並檢查健康狀態。儲存庫本身無法證明 Cloudflare Dashboard 的 Git 連線目前是否啟用，應在 Builds 與 Deployments 頁面查核。Production 仍由 `main` 採受保護的手動發布流程。遠端 D1 migration 需另外審查並由操作人員執行，不會由 CI 或 staging 部署指令自動套用。設定與安全規則見 [develop 部署手冊](docs/develop-deployment.md)。

## 開發進度

- 平台與執行環境：已完成。
- D1 基礎與封閉測試身分驗證：已完成。
- 暫時密碼與首次登入變更密碼流程：已完成。
- 卡片、複習、統計與設定的 D1 repository 與 authenticated API：已完成；前端已整合篩選、收藏、內容編輯、確認刪除與明確完成複習，首頁／統計／設定使用真實資料。
- CEFR-J A1–B2 schema：已加入儲存庫 migration；正式環境目錄匯入尚未執行。
- CEFR-J 1.6 目錄：已提供本機匯入工具、少量測試 fixture 與官方來源下載流程；正式環境尚未匯入。來源與操作方式見 [CEFR-J 目錄匯入](docs/cefr-j-catalog-import.md)。
- 初始級別選擇與 starter cards：前端在完成必要的密碼變更後，將尚未選擇級別的使用者導向 `/relaiapp/onboarding`，僅提供 A1/A2/B1/B2。API 從共用目錄複製最多 100 張同級別卡片，並保護重試與重複字詞；已選級別不再顯示 onboarding。行為見 [starter API](docs/onboarding-starter-api.md)。
- 後續階段：Gemini 擷取及 PWA／離線支援。

Cards API 的 `needs_review` 僅接受 `true`（從未複習或超過七天未複習）；省略表示不套用此篩選，`false` 回傳 400。卡片 PATCH 僅允許學習內容欄位；Error Log 的錯誤類型使用既有 `part_of_speech` 儲存欄位。複習由明確完成動作提交，具備事件冪等性與 D1 batch transaction；設定級別變更不刪除卡片或新增 starter pack。

產品行為以 [PRD](ReLai_PRD_v3.4.md) 為準；實作與部署以本 README 及相關操作手冊為準。個別任務範圍以指定的 GitHub Issue 或產品負責人指示為準。
