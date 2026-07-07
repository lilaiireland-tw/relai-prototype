# ReLai 哩來語感特訓 — UI Prototype

依 PRD v3.1 與 mockup 製作的視覺原型，使用 Next.js 14 (App Router) + TailwindCSS，全部資料為 mock data，不連接真實 API / 資料庫。

## 開發

```bash
npm install
npm run dev
```

開啟 [http://localhost:3000](http://localhost:3000)，畫面以手機版面（375px）為優先設計基準。

## 畫面

| 路由 | 說明 |
|------|------|
| `/` | 啟動頁（Splash） |
| `/home` | 首頁 / 輸入頁，含今日學習進度、學習統計、近期萃取 |
| `/flashcards` | 單字閃卡（Vocabulary），3D 翻轉動畫 |
| `/error-log` | 英語糾察隊（Error Log），錯誤句 / 校正句 / 解析 |

## 色彩系統

| 用途 | HEX |
|------|-----|
| 主色 Irish Green | `#2D7A4F` |
| Hover 深綠 | `#1E5C3A` |
| 背景 | `#FFFFFF` |
| 卡片底色 | `#F8F9FA` |
| Error Log 卡片 | `#FFF0F0` |

> 此為前端視覺原型，未串接 Supabase / Gemini，所有內容來自 `lib/mock-data.ts`。
