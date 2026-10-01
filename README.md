# ReLai（哩來語感特訓）

ReLai 是「哩來愛爾蘭」面向在愛爾蘭學英文的臺灣學習者所開發的封閉測試（Closed Beta）原型。產品目標是把使用者接觸的單字與英文錯誤整理成值得反覆複習的卡片。目前學習畫面仍使用模擬資料；D1 repository 已建立，產品 API 與畫面整合仍待後續階段完成。

## 目前已實作的應用程式

- 前端使用 React、TypeScript、Vite、React Router 與 Tailwind CSS，入口位於 `/relaiapp/`。
- 單一 Cloudflare Worker 在相同來源提供靜態前端及 Hono API；API 路徑以 `/relaiapp/api/v1/*` 開頭。
- 目前的 API 提供健康檢查與身分驗證。健康檢查只代表 Worker 可回應，不代表 D1 或產品功能已就緒。
- Cloudflare D1 保存現有資料表結構與驗證資料。已實作使用者、工作階段、卡片、複習、統計與設定的 D1 repository；產品 API 與畫面尚未接入這些 repository，學習畫面仍使用模擬資料或預留畫面。CEFR-J A1–B2 共用目錄 schema 已建立，但尚未匯入資料。
- Gemini 是後續 AI 擷取功能預定使用的供應商；AI 擷取及 PWA／離線功能尚未實作。

## 封閉測試帳號與登入

系統不提供公開註冊。管理員透過 `npm run user:manage` 建立帳號：互動模式可輸入暫時密碼，原有非互動模式會產生隨機密碼。新帳號的 `must_change_password` 會設為必須變更；首次登入後，應用程式會導向 `/relaiapp/change-password`，完成密碼變更前無法進入產品頁面。已登入的使用者也可以從設定頁面自行變更密碼。

Worker 使用不透明、有效期七天的工作階段 cookie，設定 `HttpOnly`、`SameSite=Lax`，並在 HTTPS 下設定 `Secure`。D1 只保存密碼鹽值與摘要，以及工作階段權杖的摘要，不保存明文密碼或原始權杖。瀏覽器中的登入狀態只保存在記憶體；密碼與權杖不寫入 `localStorage` 或 `sessionStorage`。驗證設計與限制見[密碼學說明](docs/auth-crypto.md)，實際行為與操作步驟見[驗證 API](docs/auth-session-api.md)及[帳號管理手冊](docs/admin-accounts.md)。伺服器密鑰 `AUTH_PEPPER` 不得提供給前端。

## 環境與資料表結構

| 分支／環境 | Worker | D1 綁定 `DB` |
| --- | --- | --- |
| `develop`／staging | `relai-prototype-staging` | `relai-staging-db` |
| `main`／production | `relai-prototype` | `relai-prod-db` |

`wrangler.jsonc` 是 Worker 名稱及 D1 ID 的設定來源。Vite 在建置時選擇環境；一般開發與建置指令預設選擇 staging。兩個環境使用不同的資料庫。根目錄的 `migrations/` 是唯一的 D1 schema 來源，目前包含 `0001_initial_core_schema.sql`、`0002_add_users_must_change_password.sql` 與 `0003_add_cefr_j_vocabulary_foundation.sql`。套用 migration 必須由操作人員明確執行，與 CI、部署分開。僅憑儲存庫內容無法判定遠端 migration 或部署的即時狀態。詳見 [D1 環境](docs/d1-environments.md)與 [migration 流程](docs/d1-migrations.md)。

## 儲存庫結構

```text
src/client/          React 頁面、登入狀態、API client 與模擬產品資料
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

## 交付與部署

GitHub Actions 只執行 PR 品質檢查。儲存庫核准的 staging 流程由 Cloudflare Workers Builds 負責從 `develop` 自動部署，使用 `npm run build:staging:validated` 與 `npm run deploy:staging:built`；後者部署經驗證的 staging 建置並檢查健康狀態。儲存庫本身無法證明 Cloudflare Dashboard 的 Git 連線目前是否啟用，應在 Builds 與 Deployments 頁面查核。Production 仍由 `main` 採受保護的手動發布流程。D1 migration 需另外審查並由操作人員執行，不會由 CI 或 staging 部署指令自動套用。設定與安全規則見 [develop 部署手冊](docs/develop-deployment.md)。

## 開發進度

- 平台與執行環境：已完成。
- D1 基礎與封閉測試身分驗證：已完成。
- 暫時密碼與首次登入變更密碼流程：已完成。
- 卡片、複習、統計與設定的 D1 repository：已完成；產品 API 與畫面整合尚未開始。
- CEFR-J A1–B2 schema：已加入儲存庫 migration；目錄匯入與 starter bootstrap 尚未開始。
- 後續階段：Gemini 擷取及 PWA／離線支援。

產品行為以 [PRD](ReLai_PRD_v3.4.md) 為準；實作與部署以本 README 及相關操作手冊為準。個別任務範圍以指定的 GitHub Issue 或產品負責人指示為準。
