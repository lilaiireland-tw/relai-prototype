# 📄 ReLai（哩來語感特訓）— 產品需求與架構綱要 PRD v3.1

**文件版本**：v3.1（PM Challenge 整合修訂版）
**品牌歸屬**：哩來愛爾蘭（@lilaiireland）
**開發策略**：Vibe Coding（AI 輔助全端開發）/ 敏捷開發
**最後更新**：2026 年 6 月
**文件說明**：此為 Vibe Coding / 工程師交接 / 投資人簡報的最高指導原則（Master Context）

---

## 一、執行摘要與產品願景

### 核心理念

> **"Rely on AI, Rely on ReLai"**

ReLai 是一款以**英愛通用（British + Irish English）**為語言定位、以**愛爾蘭視角**為品牌底色的 AI 英語學習工具。

**現階段定位（v1.0–v2.0）：AI 英語第二大腦**
取代筆記本 + AI 整理工具。用戶上傳白板照片或輸入英文，5 秒內生成結構化閃卡，持續累積個人語言知識庫。

**未來定位（v3.0+）：英文能力提升平台**
在第二大腦的基礎上，延伸為具備考試備考（IELTS）與口說寫作評分能力的完整學習平台。

### 北極星指標（North Star Metric）

**Time-to-Value（TTV）**：從使用者按下送出到看見精美閃卡，目標 **5 秒以內**。

> ⚠️ **工程保障要求**：TTV 5 秒是產品承諾，必須有工程機制保障，而非僅為目標數字。
> **建議實作方向（由 Alex 決定具體技術選型）：**
> - Optimistic UI：先渲染骨架卡片（Skeleton Card），API 回應後填充內容
> - Streaming Response：邊生成邊顯示，不等 JSON 全部完成才渲染
> - 明確的 Timeout 機制：超過 8 秒觸發 fallback 體驗（友善錯誤提示 + 重試按鈕）
> - 弱網絡情境測試：須在模擬愛爾蘭語校 WiFi 品質的環境下通過 TTV 測試

### Speaking & Writing 的策略性留白

v1.0–v2.0 刻意不做 IELTS Speaking 和 Writing 的 AI 評分，這是可對外溝通的品牌論述：

> *「AI 可以幫你把 Vocabulary 和 Reading 練到頂，但 Speaking 和 Writing 要真正突破，需要真實的語言環境——這就是為什麼你需要來愛爾蘭語校。」*

此留白同時服務三件事：解釋功能邊界、強化語校必要性、將用戶推向哩來代辦業務。

---

## 二、成長路徑與版本規劃

```
Phase 1（v1.0）｜AI 第二大腦
核心：語校筆記 → AI 閃卡（Vocabulary + Error Log）
用戶：在愛爾蘭語校 / 打工度假的台灣學生（含哩來代辦直接導入）
護城河：Irish context 彩蛋 + 哩來品牌信任 + 唯一 Error Log 雙引擎

        ↓

Phase 2（v2.0）｜備考延伸 + 付費牆強化
新增：IELTS Vocabulary + Reading 刷題庫
     錯題一鍵加入個人閃卡庫（核心串聯功能，市場唯一）
     付費牆加強：匯出功能 / AI 重新解析 / 進階統計（待 v2.0 評估）
     Streak Freeze（Pro 功能）
     圖片儲存（Pro 功能）
用戶：擴及在台灣準備 IELTS 的族群（英國 / 愛爾蘭留學）

        ↓

Phase 3（v2.1）｜留存深化
新增：Spaced Repetition 演算法（FSRS）
     「智能複習模式」依遺忘曲線排程複習

        ↓

Phase 4（v3.0+）｜平台化
新增：IELTS Speaking AI 評分
     IELTS Writing AI 批改
     學習路徑規劃與預估 Band 分
     UGC 社群題庫
     多國語校擴展（local_usage + country_code 架構）
```

---

## 三、目標用戶與使用場景

### 三個用戶入口

**入口 A｜語校 / 打工度假族（Beachhead 核心用戶）**

身份：18-30 歲，赴愛爾蘭語校就讀或打工度假的台灣年輕人
主要獲客來源：**哩來代辦業務直接導入**——報名長期打工遊學課程的學生直接獲得 ReLai Pro

> ⚠️ **重要數據注意事項**：哩來代辦導入的早期用戶品質高（有明確出國計畫、使用動機強、有哩來信任關係），其留存率和轉換率數據屬於「偏樣本」。開放大眾下載後，需將兩個 cohort 分開追蹤：
> - **Cohort A**：哩來代辦導入用戶
> - **Cohort B**：App Store 自然獲客用戶

使用場景：
- 下課後拍下白板單字 → 5 秒生成 Vocabulary 卡
- 被老師糾正 → 生成 Error Log 卡永久留存
- 跟愛爾蘭人聊天聽到有趣俚語 → 收藏進卡片庫，看到 `irish_usage` 彩蛋
- 準備 IELTS → 課堂筆記轉化為可複習的練習素材

用戶旅程：
```
台灣出發前 → 報名哩來代辦 → 取得 ReLai Pro
        ↓
出發前 → 用 ReLai 刷 IELTS Vocab + Reading 備考
        ↓
抵達愛爾蘭 → 語校筆記 → 閃卡 → Error Log 累積
        ↓
IELTS 達標 → 找哩來申請愛爾蘭碩士
```

**入口 B｜IELTS 備考族**

身份：在台灣準備 IELTS、目標英國或愛爾蘭留學的學習者
場景：
- 碎片時間刷 IELTS Vocabulary + Reading 題庫
- 刷題遇到不懂的單字 → 一鍵加入個人閃卡庫
- 接觸哩來品牌內容後，可能轉往愛爾蘭留學路線

**入口 C｜外商職場英文族**

身份：在台灣想進外商或跨國公司、需要提升職場英文的上班族
場景：
- 把被主管糾正的英文錯誤存入 Error Log
- Vocabulary 卡累積商務英文詞彙
- 有出國進修念頭時，哩來就在那裡

---

## 四、競品定位分析

### 市場空白地圖

| 功能維度 | Anki | Quizlet | Flashka | StudyGlen | 刷刷庫 | **ReLai** |
|---------|------|---------|---------|-----------|--------|---------|
| 圖片 OCR 輸入 | 插件 | ❌ | ✅ | ✅ | ❌ | ✅ |
| 繁中原生支援 | 社群 | 部分 | ❌ | ❌ | ✅ | **✅ 原生** |
| Error Log 糾察系統 | ❌ | ❌ | ❌ | ❌ | ❌ | **✅ 市場唯一** |
| 英愛在地語境補充 | ❌ | ❌ | ❌ | ❌ | ❌ | **✅ 市場唯一** |
| IELTS 備考題庫 | 社群 | 社群 | ❌ | ❌ | TOEIC | v2.0 計畫 |
| 繁中 IELTS 刷題 | ❌ | ❌ | ❌ | ❌ | ❌ | **v2.0 市場空白** |
| 錯題串聯個人閃卡 | ❌ | ❌ | ❌ | ❌ | ❌ | **✅ v2.0 市場唯一** |
| KOL 品牌背書 | ❌ | ❌ | ❌ | ❌ | 哥倫布/Lily | **✅ 哩來** |

### 核心差異化三大護城河

**護城河一：Error Log 學習哲學**
把「犯的錯誤」系統化整理成可複習資產，市場唯一。這不只是功能，而是一個學習觀念的轉變——把「犯錯」從負面事件變成可累積的知識資產。任何 AI 技術升級都不會讓這個概念失效。

**護城河二：錯題串聯個人閃卡庫（v2.0 殺手鐧）**
刷 IELTS 題庫答錯的題目，一鍵自動轉換為個人 Vocabulary 卡。這是整個產品最具創新性的功能設計——打通了「公共題庫」和「個人知識庫」的橋樑，市場上無任何競品做到這件事。此功能應作為 v2.0 的主要行銷訴求。

**護城河三：哩來品牌通路**
@lilaiireland 既有社群 + 代辦業務直接導入 + 愛爾蘭本地人老師把關的內容品質，是任何競品都買不到的信任資產。

### 競爭威脅評估

**最大現有競爭者：Quizlet**
優勢：6 億用戶、品牌認知、AI 功能、題庫生態系
弱點：無繁中深度本地化、無 Error Log 概念、無 IELTS 專注深度
威脅程度：中（若認真做亞洲市場本地化則升為高）

**最危險間接競爭者：Apple Intelligence + iOS Notes**
威脅：若 iOS Notes 內建「拍照 → AI 整理學習卡片」，ReLai 的 v1.0 核心功能可能被平台化取代
應對策略：在平台功能追上之前，用品牌、Error Log 哲學、IELTS 深度建立不可替代性
威脅時間窗口：預估 3-5 年

**可能顛覆市場的新型競品：沉浸式 AI 語言夥伴**
代表產品：Speak App（已融資超過 $1.6 億）、Duolingo Max（GPT-4 驅動對話）
威脅模式：若此類產品加入「錯誤自動記錄 + 閃卡生成」功能，ReLai 的使用場景將被直接包含
應對策略：搶先建立「學習錯誤數據護城河」（見第十七節），以台灣學生在愛爾蘭的錯誤模式作為獨特數據資產

**3-5 年窗口期警示**
AI 卡片生成和 Vision OCR 在 3-5 年內將成為業界標配。ReLai 必須在此窗口期內完成從「技術差異化」到「品牌 + 數據 + 通路護城河」的轉型。窗口開著，但不會永遠開著。

---

## 五、功能範疇規劃（MoSCoW）

### v1.0 MVP — 當前衝刺目標

**P0（Must Have）：**
- 純文字輸入解析 → 生成 AI 閃卡（含 TTV ≤ 5 秒工程保障）
- 圖片上傳（Vision OCR）→ 生成 AI 閃卡
- 雙引擎閃卡：Vocabulary 卡 + Error Log 卡
- Supabase 資料庫寫入與讀取
- Gallery View 網格視圖 + 翻轉（Flip CSS 3D）動畫
- 連續天數 Streak 留存機制
- 今日學習進度（Daily Goal Progress）
- **新用戶 Onboarding 體驗**（設計原則：預載示範卡片 + 引導動畫，UI 設計階段細化）
- **PWA 基礎離線支援**：已生成卡片快取本地，離線可複習，上線後同步進度

**P1（Should Have）：**
- 基礎 CRUD：手動修改卡片內容 / 刪除卡片
- 里程碑徽章（第一張卡片 / 連續 7 天 / 累積 100 張 / 連續 30 天）
- **「最近 7 天未複習卡片」優先顯示邏輯**（解決第 8-30 天留存黑洞，詳見第十二節）
- **Error Log 輸入優化**：語音輸入 + 結構化模板（「我說了＿，正確應該是＿」）

**P2（Could Have，v1.0 彈性評估）：**
- 學習統計頁面（新增卡片數 / 複習次數 / 正確率）
- iOS / Android 主畫面 Widget（快速輸入，不需開 App）

### v2.0 — IELTS 題庫延伸 + 付費牆強化

- IELTS Vocabulary + Reading 仿題題庫（初期 500 題，擴充至 2,000 題）
- **錯題一鍵加入個人閃卡庫**（核心串聯功能，v2.0 主要行銷訴求）
- 繁中詳解（每題附錯誤分析，由愛爾蘭英語老師合作審核）
- Streak Freeze（Pro 功能）
- 圖片儲存 30 天（Pro 功能）
- 免費版每日刷題限制（1 回 / 約 10 題），Pro 版無限刷
- **付費牆強化評估項目（v2.0 決定是否納入）：**
  - 匯出功能（PDF / Anki .apkg 格式）→ Pro 功能
  - AI 重新解析（讓 AI 改寫 / 升級已有的卡片）→ Pro 功能
  - 進階學習統計（弱點分析 / 學習趨勢報告）→ Pro 功能

### v2.1 — 留存深化

- Spaced Repetition 演算法（FSRS）
- 「智能複習模式」UI（依遺忘曲線排程，資料庫 `next_review_at` 已在 v1.0 預留）

### v3.0+ — 平台化（遞延）

- IELTS Speaking AI 評分
- IELTS Writing AI 批改
- TTS 語音發音
- UGC 社群題庫
- 學習路徑規劃與預估 Band 分
- 多國語校擴展（`irish_usage` → `local_usage` + `country_code` 架構升級）

---

## 六、商業模式與定價策略

### Freemium 架構

| 方案 | 功能內容 | 定價 |
|------|---------|------|
| **Free** | 每日限生成 10 張卡片，複習不限次數 | NT$0 |
| **Pro（v1.0）** | 無限卡片生成、無廣告 | NT$799 / 年 |
| **Pro（v2.0 後）** | 上述全部 + IELTS 題庫無限刷 + Streak Freeze + 圖片儲存 + 待評估付費牆功能 | NT$1,499 / 年 |
| **金流工具** | 待決定（Stripe / Apple IAP / Google Pay）| — |

### 定價策略邏輯

**免費版設計原則：**
- 限制「生成」（每日 10 張），不限制「複習」
- 10 張讓用戶充分體驗 Aha Moment，重度學習者一週內自然遇到天花板
- 複習不限讓用戶每天有理由回來建立習慣
- v2.0 評估加入匯出 / AI 重新解析 / 進階統計等付費牆，針對輕度生成用戶也能觸及升級誘因

**付費版定價依據：**
- 競品對標：Quizlet 年費約 NT$1,100、刷刷庫年費 NT$2,880
- v1.0 NT$799：MVP 階段低阻力累積用戶，以回饋和數據優先
- v2.0 NT$1,499：IELTS 題庫上線後產品價值提升，仍比刷刷庫便宜 48%

### 哩來大禮包通路

**報名哩來長期打工遊學課程的學生直接獲得 ReLai Pro 年費資格**，作為哩來開局大禮包（€109）的組成項目。此為通路促銷策略，不影響 App 本身定價架構。此通路確保 v1.0 早期用戶品質高、使用動機強，是最重要的冷啟動機制。

---

## 七、系統架構與技術選型

### Tech Stack

| 層級 | 技術選擇 | 理由 |
|------|---------|------|
| 前端框架 | Next.js（App Router）+ React + TailwindCSS | 全端整合、SEO 友善、PWA 支援 |
| 後端 API | Next.js Server Actions | 隱藏 API Key，不需獨立後端 |
| 資料庫 / Auth | Supabase（PostgreSQL）| 關聯型資料、內建 Auth |
| AI 引擎 | Gemini 2.5 Flash（主力）| 詳見第八節 |
| 離線支援 | PWA Cache API / localStorage | 卡片本地快取，離線複習 |
| 部署 | Vercel | Next.js 最佳化部署 |

### 核心架構流程

```
使用者輸入（文字 / 圖片 / 語音）
        ↓
Next.js Server Action（隱藏 API Key）
        ↓
[Optimistic UI：先顯示 Skeleton Card]
        ↓
Gemini 2.5 Flash（Vision OCR + JSON 結構化萃取）
        ↓ 串流回傳（Streaming Response）
圖片解析完成後直接丟棄（不存入 Storage）← 免費版成本最佳化
        ↓
JSON 資料寫入 Supabase flashcards 表
        ↓
前端 Gallery View 渲染閃卡（Flip CSS 3D 動畫）
        ↓
[PWA Cache：同步更新本地快取供離線使用]
```

---

## 八、AI 模型策略

### 使用場景分析

| 場景 | 需求特性 | 呼叫頻率 |
|------|---------|---------|
| 文字輸入 → JSON 閃卡 | 結構化輸出、繁中理解、詞性判斷 | 高（每次輸入）|
| 圖片 OCR → JSON 閃卡 | Vision 能力 + 結構化輸出 | 中 |
| Error Log 糾察 | 繁中語境理解、文法分析 | 高 |
| v2.0 IELTS 題目生成 | 批量離線生成，非即時 | 低（一次性預生成）|

### 分版本模型建議

**v1.0 MVP 階段｜目標：接近零成本**

主力：**Gemini 2.5 Flash（免費層）**
- 免費層配額：每日 250 次請求，無需信用卡
- 前 200 位早期用戶的日均呼叫量不會超過此上限
- 等用量突破免費層時，代表產品已有真實用戶基數

備用：**Gemini 2.5 Flash-Lite**（免費層每日 1,000 次請求，結構化任務品質足夠）

**v1.0 → v2.0 付費運營階段**

主力：**Gemini 2.5 Flash（付費層）**，$0.30/$2.50 per MTok

實際成本估算（文字輸入 → 3 張閃卡，約 1,100 tokens / 次）：
- 1,000 次呼叫：約 $0.60（Gemini）vs $0.83（GPT-4o mini）
- 圖片 OCR 成本：Gemini 約 $0.039 / 張，GPT-4o 約 $0.975 / 張（Gemini 便宜 96%）

**v2.0 IELTS 題庫生成｜一次性離線任務**

使用：**Gemini 2.5 Pro 或 GPT-5.4**（最強品質確保題目準確性）
一次性生成 500 題估算成本：約 $2-5 美元

**v3.0 Speaking / Writing 評分（遞延）**
屆時重新評估 AI 語音評分模型（Gemini Live API 或 OpenAI Whisper），需另行分析成本結構。

### 不採用 DeepSeek V4 的原因

雖然 DeepSeek V4 成本最低（輸出僅 $0.50 per MTok），但有兩個關鍵顧慮：
1. **資料隱私**：用戶學習筆記和英文錯誤記錄會經過中國伺服器，對台灣用戶的心理接受度和合規風險不低
2. **服務穩定性**：高峰期有服務中斷記錄，直接影響 TTV 指標

---

## 九、內容團隊分工

ReLai 的內容品質依賴三方協作：

| 內容類型 | 主要負責人 | 說明 |
|---------|----------|------|
| AI System Prompt 維護與更新 | **Arsha（主）/ Alex（輔）** | Arsha 以 PM 角色主導內容策略與品質標準，Alex 負責技術層面的 Prompt 工程優化 |
| IELTS 題庫人工校對 | **愛爾蘭英語老師合作夥伴** | AI 生成的仿題需經過具備 IELTS 教學經驗的本地英語老師審核，確保題目準確性和語言自然度 |
| `irish_usage` 彩蛋內容審核 | **愛爾蘭英語老師合作夥伴** | 本地人把關確保在地用法的真實性，同時是可對外溝通的品質背書故事 |
| 產品整體方向決策 | **Arsha + Alex 共同** | 重大功能取捨、版本規劃、定價策略 |

> **對外品質背書說法**：「ReLai 的英愛在地用法補充，由任職於都柏林的愛爾蘭英語教師審核把關。」這是 ReLai 與其他 AI 工具的可信度差異化。

---

## 十、資料庫綱要設計

### Table：`flashcards`

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | uuid, PK | 主鍵 |
| `user_id` | uuid, FK | 對應 Supabase Auth |
| `card_type` | Enum | `'vocabulary'` / `'error_log'` |
| `front_content` | Text | 卡片正面：單字或錯誤原句 |
| `back_content` | Text | 卡片背面：標準例句或正確句 |
| `part_of_speech` | Text, Nullable | 詞性 / 錯誤類型 |
| `zh_tw_definition` | Text, Nullable | 繁中定義 |
| `explanation` | Text, Nullable | 例句翻譯 / 錯誤詳解 |
| `irish_usage` | Text, Nullable | 英愛在地用法補充（有就顯示，無填 null）v3.0 擴張時改為 `local_usage` + `country_code` |
| `source` | Enum, Nullable | `'user_input'` / `'ielts_quiz'`（v2.0 刷題錯題來源標記）|
| `last_reviewed_at` | Timestamp, Nullable | 最後複習時間（用於 P1「7 天未複習」優先顯示邏輯）|
| `is_favorite` | Boolean | 收藏狀態，預設 false |
| `next_review_at` | Timestamp, Nullable | **v1.0 寫入 null，v2.1 FSRS 演算法使用** |
| `created_at` | Timestamp | 預設 now() |

### Table：`user_stats`

| 欄位 | 型別 | 說明 |
|------|------|------|
| `user_id` | uuid, FK | 對應 Supabase Auth |
| `streak_days` | Integer | 當前連續天數 |
| `last_active_date` | Date | 最後活躍日期（Streak 計算依據，時區 Asia/Taipei）|
| `total_cards_created` | Integer | 累積建立卡片數 |
| `total_reviews` | Integer | 累積複習次數 |
| `badges_unlocked` | Text Array | 已解鎖徽章列表 |
| `cohort_source` | Enum | `'lilai_referral'` / `'organic'`（用於分開追蹤兩個用戶群數據）|
| `updated_at` | Timestamp | 最後更新時間 |

### Table：`ielts_questions`（v2.0）

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | uuid, PK | 主鍵 |
| `question_type` | Enum | `'vocabulary'` / `'reading'` |
| `question_text` | Text | 題目內容 |
| `options` | JSON Array | 選項（A/B/C/D）|
| `correct_answer` | Text | 正確答案 |
| `explanation_zh` | Text | 繁中詳解（經愛爾蘭英語老師審核）|
| `difficulty` | Integer | 難度 1-5 |
| `ielts_topic` | Text | 題目主題分類 |
| `reviewed_by_native` | Boolean | 是否已通過英語老師審核，預設 false |
| `created_at` | Timestamp | 預設 now() |

---

## 十一、AI 核心提示詞（System Prompt）

> 負責人：Arsha（內容策略）× Alex（Prompt 工程）× 愛爾蘭英語老師（用語審核）
> 強制輸出 Strict JSON Array，`irish_usage` 選填，有明確英愛特色才填入。

```
# Role
你是「哩來愛爾蘭」專屬的語校特訓教練與資料提取引擎。目標是解析學生上傳的筆記照片（OCR）或文字，轉化為高度結構化的 JSON 知識資產。你熟悉英國與愛爾蘭的文化、俚語與日常生活用語（Hiberno-English / British English）。必須使用繁體中文輸出。

# Output Rules
你的唯一任務是輸出一個 JSON Array。
絕對不要輸出任何 Markdown 標記（如 ```json）或額外解釋文字。

【類型 A：單字庫（type: "vocabulary"）】
{
  "type": "vocabulary",
  "front_content": "單字或片語（String）",
  "part_of_speech": "詞性（v./n./adj./adv./pron./prep./conj./int./phrasal verb/idiom/slang）",
  "zh_tw_definition": "繁中定義（String）",
  "back_content": "標準英文例句（String）",
  "explanation": "例句繁中翻譯（String）",
  "irish_usage": "英愛在地用法或俚語補充（String，若無明確英愛特色則填 null）"
}

【類型 B：錯誤糾察隊（type: "error_log"）】
{
  "type": "error_log",
  "front_content": "使用者原本的錯誤句子（String）",
  "back_content": "正確的英文句子（String）",
  "part_of_speech": "錯誤類型（文法錯誤/台式英文/用詞不當/發音混淆）",
  "explanation": "錯誤原因與文法詳解（繁中，String）",
  "zh_tw_definition": null,
  "irish_usage": null
}

# Processing Rules
1. 若輸入為圖片，先進行 OCR 辨識，再進行語意解析
2. 若輸入混合了單字與錯誤句子，分別產生對應類型的卡片
3. 一段輸入可產生多張卡片（Array 中多個物件）
4. 若無法判斷內容，回傳空 Array：[]
5. irish_usage 只在詞彙確實有英愛在地特殊用法時填入，不要強制製造內容
```

---

## 十二、UI/UX 設計系統

### 設計美學

**風格定位**：極簡生產力工具（Minimalist Clean SaaS）
**視覺對標**：Notion 的留白感 × Linear 的操作流暢感

### 色彩系統

| 用途 | 色彩 | HEX |
|------|------|-----|
| 主色（CTA 按鈕）| 愛爾蘭綠 Irish Green | `#2D7A4F` |
| 輔色（Hover）| 深綠 | `#1E5C3A` |
| 背景 | 純白 | `#FFFFFF` |
| 卡片底色 | 淺灰 | `#F8F9FA` |
| Error Log 卡片 | 淺紅 | `#FFF0F0` |
| 文字主色 | 深灰 | `#1A1A2E` |
| 文字次色 | 中灰 | `#6B7280` |

### 新用戶 Onboarding 設計原則

> UI 設計階段細化，此處定義核心原則：

- **預載示範卡片**：新用戶第一次開 App 時，Gallery View 預載 2-3 張示範卡片（一張 Vocabulary、一張 Error Log），讓用戶立即看到成品長什麼樣子，消除空狀態焦慮
- **引導動畫**（30 秒內完成）：展示三個核心場景——輸入文字 → 生成卡片、上傳圖片 → OCR 生成、翻轉卡片複習
- **第一次成功慶祝**：用戶生成第一張真實卡片時，觸發明顯的慶祝回饋動畫（強化 Aha Moment）
- **哩來代辦用戶的客製化 Onboarding**：透過代辦業務導入的用戶，可在諮詢流程中預先示範 App 使用場景，Onboarding 體驗與出發前準備整合

### 頁面結構（v1.0）

```
/ （首頁 / 輸入頁）
├── 文字輸入框（最高優先視覺位置）
├── 圖片上傳按鈕（相機 / 相簿）
├── 語音輸入按鈕（P1，Error Log 快速輸入）
├── 今日學習進度環形圖
├── 連續天數 Streak（火焰圖示 + 天數）
└── 近期萃取列表

/cards （卡片庫）
├── Gallery View（網格）
│   ├── Vocabulary 卡（白底）
│   └── Error Log 卡（淺紅底）
├── 篩選：全部 / Vocabulary / Error Log / ★ 收藏
├── 「7 天未複習」優先排序（P1）
└── 單張翻面複習模式

/quiz （IELTS 刷題，v2.0）
├── 題型選擇：Vocabulary / Reading
├── 每日題數進度
└── 錯題 → 一鍵加入閃卡庫

/stats （學習統計）
├── 新增卡片數 / 複習次數 / 連續天數 / 正確率
└── 徽章牆（已解鎖 + 未解鎖灰色預覽）

/settings （設定）
├── 帳號管理
├── 每日目標設定（預設 10 張）
└── 訂閱方案
```

---

## 十三、Gamification 留存機制

### 必做（高效果 / 低開發成本）

**1. 連續天數 Streak**
- 實作：`user_stats.last_active_date` + 前端計數器
- 觸發：每日完成至少 1 張卡片複習
- 顯示：首頁火焰圖示 + 天數
- 時區：Asia/Taipei
- 研究依據：用戶建立 7 天 Streak 後，每日回訪意願提升 2.3 倍

**2. 今日學習進度（Daily Goal Progress）**
- 預設目標：每日複習 10 張卡片（用戶可在 /settings 調整）
- 達成 100% 觸發 CSS 慶祝動畫
- 開發成本：計數器 + 動畫，接近零

**3. 里程碑徽章**
- 第一張卡片生成 🎉
- 連續 7 天學習 🔥
- 累積 100 張卡片 📚
- 連續 30 天學習 🏆
- 未解鎖徽章以灰色顯示，增加期待感

**4. 「7 天未複習卡片」優先顯示（P1，解決第 8-30 天留存黑洞）**

> **設計背景**：Gamification 解決了第 1-7 天（Streak 建立）和長期（30 天徽章），但 v1.0 沒有 SRS 演算法告訴用戶「今天應該複習什麼」。Gallery View 裡有 50 張卡片、用戶不知道從哪裡複習，沒有方向感的複習會造成第 8-30 天的無聲流失。

- 實作：查詢 `flashcards.last_reviewed_at`，將超過 7 天未複習的卡片排在 Gallery View 最前方
- 顯示：加上「📌 需要複習」小標籤
- 開發成本：一條 Supabase 查詢 + 排序邏輯，無需 SRS 演算法
- 效果：給用戶每天一個「今天應該複習什麼」的錨點，有效降低第 8-30 天流失

### 遞延（v2.0 Pro 功能）

**Streak Freeze（保護盾）**
- 免費版：Streak 中斷即歸零
- Pro 版：每月 3 次保護機會，中斷不歸零
- 這是 Gamification 轉化付費的關鍵機制

### 刻意不做

- 聯盟排名（League）：需足夠用戶基數才有意義
- 好友對戰：社交功能工程成本高
- XP 點數：稀釋「記單字」的核心焦點

---

## 十四、User Stories

### Epic 1：無摩擦輸入

**US-001｜文字輸入生成閃卡**
```
身份：語言學習者
行動：在首頁文字框貼上英文單字、破英文句子或學習筆記
結果：系統在 5 秒內生成對應的 Vocabulary 卡或 Error Log 卡

驗收標準：
- 輸入到看見卡片 ≤ 5 秒（TTV，須有工程保障機制）
- 系統正確判斷 vocabulary vs error_log 類型
- Vocabulary 卡包含定義、例句、繁中翻譯
- irish_usage 有值時顯示「在地用法」標籤
- 弱網絡下（3G 模擬）仍在 8 秒內完成，並有 Skeleton Card 填補等待感
```

**US-002｜圖片上傳生成閃卡**
```
身份：語言學習者
行動：上傳白板照片或手寫筆記圖片
結果：系統 OCR 辨識後在 5 秒內生成閃卡

驗收標準：
- 支援 JPG / PNG / HEIC 格式
- OCR 能辨識印刷字體與清晰手寫字體
- 圖片解析完成後不存入資料庫（閱後即焚）
- 失敗時顯示友善錯誤訊息並提供重試選項
```

**US-003｜Error Log 快速輸入（P1）**
```
身份：剛被老師糾正的學生
行動：點擊語音輸入按鈕，說出「I didn't went there, 正確是 I didn't go there」
      或使用結構化模板輸入
結果：系統識別後生成 Error Log 卡，摩擦力最小化

驗收標準：
- 語音輸入支援中英混合（台灣學生說話習慣）
- 結構化模板：「我說了＿，正確應該是＿」，AI 自動填充 error_log 欄位
- 整個流程 30 秒內完成（從犯錯到存檔）
```

**US-004｜混合內容解析**
```
身份：語言學習者
行動：輸入同時包含單字和錯誤句子的混合筆記
結果：系統分別產生 Vocabulary 卡和 Error Log 卡

驗收標準：
- 一次輸入可產生多張不同類型的卡片
- Gallery View 中兩種卡片視覺明顯區分
```

---

### Epic 2：閃卡複習系統

**US-005｜Gallery View 瀏覽卡片**
```
身份：學習者
行動：進入卡片庫頁面
結果：所有卡片以網格排列，「7 天未複習」卡片優先顯示

驗收標準：
- 超過 7 天未複習的卡片排在最前方，顯示「📌 需要複習」標籤
- 可篩選：全部 / Vocabulary / Error Log / 收藏
- 右上角星號支援收藏
- 離線時可瀏覽本地快取的卡片
```

**US-006｜單張翻面複習**
```
身份：學習者
行動：點擊任一張卡片
結果：3D 翻面動畫展示背面完整學習資訊，複習後更新 last_reviewed_at

Vocabulary 背面：
- 詞性 + 繁中定義
- 英文例句 + 繁中翻譯
- 「在地用法」標籤（若 irish_usage 有值）

Error Log 背面：
- ❌ 原句（錯誤）
- ✅ 正確句
- 錯誤原因詳解

驗收標準：
- 翻面動畫流暢，無延遲感
- 點擊任意處翻回正面
- 底部「下一張 →」按鈕
- 複習後 last_reviewed_at 即時更新
```

**US-007｜卡片 CRUD**
```
身份：學習者
行動：點擊卡片右上角選單
結果：可編輯內容或刪除

驗收標準：
- 編輯後即時更新 Supabase
- 刪除前有確認彈窗
- 刪除後從 Gallery View 移除，無需整頁重整
```

---

### Epic 3：Gamification 留存

**US-008｜Streak 連續天數**
```
身份：每日學習者
行動：每天完成至少 1 張卡片複習
結果：首頁 Streak 計數 +1，有視覺動畫回饋

驗收標準：
- 以 Asia/Taipei 時區計算每日重置
- 免費版：超過 24 小時未複習則 Streak 歸零
- 7 天、30 天里程碑觸發慶祝動畫
```

**US-009｜今日學習進度**
```
身份：學習者
行動：打開 App
結果：首頁看到今日複習進度環形圖

驗收標準：
- 預設每日目標 10 張（可在 /settings 調整）
- 達成 100% 觸發完成動畫
- 進度即時更新，離線複習後上線同步
```

**US-010｜里程碑徽章**
```
身份：學習者
行動：達成特定成就
結果：收到徽章，可在 /stats 查看

驗收標準：
- 觸發為即時（達成後下次開 App 顯示）
- 未解鎖徽章以灰色呈現，增加期待感
```

---

### Epic 4：帳號與訂閱

**US-011｜新用戶 Onboarding**
```
身份：新用戶（含哩來代辦導入和自然獲客兩種）
行動：第一次開啟 App
結果：看到引導動畫 + 示範卡片，30 秒內理解核心價值

驗收標準：
- Gallery View 預載 2-3 張示範卡片（Vocabulary + Error Log 各一）
- 引導動畫 ≤ 30 秒，可跳過
- 第一次生成真實卡片後觸發慶祝動畫
- cohort_source 根據來源正確寫入（'lilai_referral' / 'organic'）
```

**US-012｜快速登入**
```
身份：新用戶
行動：點擊「開始使用」
結果：Google OAuth / Apple Sign In 一鍵登入

驗收標準：
- 登入後自動建立 Supabase user 和 user_stats 初始記錄
- 首次登入進入 Onboarding 流程（US-011）
```

**US-013｜免費版限制提示**
```
身份：免費用戶
行動：當日已生成第 10 張卡片後繼續嘗試輸入
結果：友善 Banner 提示已達每日限制，展示升級好處

驗收標準：
- 非強制 Modal 彈窗，而是頁面內 Banner
- 隔日自動重置（複習功能不受影響）
- 升級按鈕直連訂閱頁
```

**US-014｜Pro 訂閱**
```
身份：付費意願用戶
行動：點擊升級 Pro
結果：看到方案說明，完成付款後立即解鎖功能

驗收標準：
- 金流工具：待決定（Stripe / Apple IAP / Google Pay）
- 訂閱狀態同步至 Supabase user 記錄
- Pro 用戶首頁顯示 Pro 標章
- 付款失敗有清楚提示與重試機制
```

---

### Epic 5：IELTS 刷題（v2.0）

**US-015｜IELTS 題庫刷題**
```
身份：IELTS 備考用戶
行動：進入「刷題」分區，選擇 Vocabulary / Reading 題型
結果：逐題作答，每題附繁中詳解

驗收標準：
- 免費版每日 1 回（約 10 題），Pro 版無限刷
- 每題顯示正確答案 + 繁中解析（已通過愛爾蘭英語老師審核）
- 答題完成後顯示本回正確率
```

**US-016｜錯題加入閃卡庫（v2.0 核心串聯功能）**
```
身份：IELTS 備考用戶
行動：答錯某道題後，點擊「加入我的閃卡庫」
結果：該題自動轉換為 Vocabulary 卡，存入個人卡片庫

驗收標準：
- 一鍵操作，0 秒額外輸入
- 卡片 source 欄位標記為 'ielts_quiz'
- 加入後可在 /cards Gallery View 複習
- 這是 ReLai 獨有的刷題 × 閃卡串聯體驗，應作為 v2.0 主要行銷訴求
```

---

## 十五、IELTS 題庫建置策略

### 題目來源方案（優先順序）

**v2.0 主力：AI 自製仿題（Gemini 2.5 Pro 批量離線生成）**
- 不複製任何真實考題，自製符合 IELTS 題型格式的練習題
- 生成後由愛爾蘭英語老師人工審核（`reviewed_by_native` 欄位標記）
- 法律框架免責聲明：「本 App 為獨立教育工具，與 IELTS® 官方、劍橋大學、英國文化協會及 IDP Education 無關聯或背書。IELTS® 為其商標。」
- 初期目標：500 題（Vocabulary 300 + Reading 200），一次性生成成本約 $2-5 美元
- 擴充計畫：每季新增 200-300 題，逐步達到 2,000 題

**v2.1 探索：台灣 IELTS 補習班合作**
- 對象：具自製繁中題庫的本地補習班
- 合作模式：題庫授權 / 聯合品牌 / 內容換流量

**v3.0 長期：UGC 社群題庫**
等用戶基數足夠後開放，AI 審核 + 人工把關

### 題庫範圍決策

**v2.0 做：**
- IELTS Vocabulary：詞彙選擇、填空、定義配對
- IELTS Reading：短篇閱讀理解（200-300 字 + 3-5 題）

**v2.0 刻意不做（轉化為品牌論述）：**
- IELTS Speaking：需 AI 語音評分，技術難度高，過去是多數 IELTS App 失敗主因
- IELTS Writing：需 AI 批改四個評分維度，技術複雜度高

---

## 十六、核心戰略取捨

| 決策 | 選擇 | 理由 |
|------|------|------|
| AI 模型 | Gemini 2.5 Flash（主力）| 免費層足夠 MVP，Vision OCR 比 GPT-4o 便宜 96%，繁中能力相當 |
| TTV 保障 | 工程機制保障（Optimistic UI + Streaming）| 5 秒是承諾，不是願望，需要工程設計支撐 |
| 離線支援 | PWA Cache API | 都柏林通勤場景真實存在，離線複習是基本需求 |
| 圖片閱後即焚 | 解析後不存圖片 | 降低成本，Pro 版可開放儲存 |
| SRS 延後 | v2.1 再實作 | 先以「7 天未複習優先顯示」填補留存黑洞，資料庫已預留欄位 |
| Speaking/Writing 不做 | 轉為品牌論述 | 技術難度高 + 強化語校必要性論述 |
| IELTS 題庫選擇 | 非 DET，選 IELTS | 與哩來用戶的愛爾蘭留學需求完全匹配，繁中 IELTS App 市場空白 |
| 題庫製作 | AI 生成 + 本地老師審核 | 零版權風險，品質有真人把關，可對外溝通 |
| 免費版限制 | 限生成（10 張），不限複習 | 建立複習習慣，v2.0 加入更多付費牆觸點 |
| `irish_usage` | 降為品牌彩蛋，本地老師把關 | 量不足撐起核心定位，但作為有品質背書的在地驚喜有加分效果 |
| 語言定位 | 英愛通用 | 覆蓋愛爾蘭語校 + 英國留學 + 外商職場 |
| Gamification | Streak + 進度 + 徽章 + 7天未複習優先 | 研究支撐最強、開發成本最低的組合 |
| DeepSeek | 不採用 | 資料隱私風險 + 服務穩定性疑慮 |

---

## 十七、學習數據護城河策略

> **PM 前瞻建議**：ReLai 每天都在累積用戶的英文錯誤記錄、學習模式、複習行為。這些數據若被系統性利用，可建立任何競品難以複製的優勢。

**數據資產的三個應用方向：**

**方向一：IG 內容素材（立即可用）**
收集足夠的 Error Log 數據後，分析「台灣學生在愛爾蘭最常犯的英文錯誤前 100 名」，直接轉化為 @lilaiireland 的高互動內容——這是同時服務行銷和產品的飛輪。

**方向二：IELTS 題庫優化（v2.0）**
根據用戶最常犯的錯誤類型，針對性設計 IELTS 練習題。「專門針對台灣學生弱點設計的 IELTS 題庫」是無法被通用 AI 生成競品複製的差異化。

**方向三：AI 模型微調（v3.0+）**
累積足夠的台灣學生英文錯誤數據後，可以微調語言模型，使其對台式英文的辨識和糾察能力遠優於通用模型。這是真正的技術護城河。

> ⚠️ **數據收集前提**：需在隱私政策中明確告知用戶學習數據的使用方式，並提供選擇退出匿名數據分析的選項。

---

## 十八、成功指標（KPIs）

### v1.0 驗證目標（上線後 3 個月）

| 指標 | 目標值 | 追蹤方式 |
|------|-------|---------|
| TTV | ≤ 5 秒 | 前端效能監控 |
| Day-7 Retention | ≥ 30% | 分 Cohort A / B 追蹤 |
| Day-30 Retention | ≥ 15% | 分 Cohort A / B 追蹤 |
| Streak ≥ 7 天用戶比例 | ≥ 20% | user_stats |
| 免費 → Pro 轉換率 | ≥ 5% | 訂閱記錄 |
| 每用戶平均卡片數 | ≥ 20 張 | flashcards 計數 |
| Error Log 佔卡片比例 | ≥ 20% | card_type 分布 |

### v2.0 擴張目標

| 指標 | 目標值 |
|------|-------|
| IELTS 題庫 DAU 佔比 | ≥ 40% 的 Pro 用戶有使用刷題功能 |
| 錯題串聯功能使用率 | ≥ 60%（刷題用戶中有使用的比例）|
| Pro 年續訂率 | ≥ 60% |

---

## 十九、哩來生態系整合

```
【哩來完整生態系】

代辦業務                           ReLai App
─────────                          ─────────
愛爾蘭語校代辦     ←→     v1.0：語校筆記閃卡（在語校期間使用）
打工度假規劃       ←→     v1.0：Error Log 累積英文口語錯誤
愛爾蘭碩士留學     ←→     v2.0：IELTS 備考刷題（達標後申請）

【通路整合】
報名哩來長期打工遊學 → 直接獲得 ReLai Pro（大禮包組成項目）
出發前諮詢 → 整合 App Onboarding 示範
在愛爾蘭期間 → 持續使用 ReLai 整理語校筆記
IELTS 達標 → 找哩來申請愛爾蘭碩士

【數據飛輪】
Error Log 數據 → IG 內容 → 更多哩來用戶 → 更多 ReLai 用戶 → 更多 Error Log 數據
```

**Speaking & Writing 留白的對外溝通版本：**

> 「ReLai 可以幫你把 Vocabulary 和 Reading 練到頂。
> 但 Speaking 和 Writing 的真正突破，需要你開口說話的環境、需要被真實的語境修正。
> 這就是為什麼你需要來愛爾蘭。
> 一起把夢，過成生活。🌍✨」

---

*文件版本：PRD v3.1 | 哩來愛爾蘭 × ReLai | 一起把夢，過成生活 🌍✨*
