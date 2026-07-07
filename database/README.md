# ReLai Database

這個目錄用來整理 ReLai 的資料模型設計、schema 草案與 seed 規劃。

它的角色不是直接承擔部署，而是作為資料層設計與實作之間的中間層：先把產品需要的資料結構定清楚，再把正式 migration 放進 `infra/supabase/`。

## 這裡放什麼

`database/` 主要放：

- schema 草案
- table 設計說明
- seed 規劃
- 資料關係與欄位命名討論

建議原則：

- `database/schema/`：放資料表設計草稿、欄位定義、ER 說明
- `database/seeds/`：放本地測試或設計用 seed 資料

真正要部署到 Supabase 的內容，放在：

- `infra/supabase/migrations/`
- `infra/supabase/policies/`
- `infra/supabase/seeds/`

## 資料庫選型

ReLai v1 預設資料庫為：

- `PostgreSQL`

並透過：

- `Supabase`

承接以下能力：

- PostgreSQL 託管
- Auth
- Storage
- migration 與 policy 管理

不採用 MySQL 的原因很簡單：

- Supabase 的核心就是 PostgreSQL
- 如果再引入 MySQL，資料層會分裂
- auth、storage、schema、migration、權限規則都會變複雜

對 ReLai 這種 v1 產品來說，這個成本沒有必要。

## v1 核心資料模型

目前第一版規劃的核心資料域如下：

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

下面是每張表的大致責任。

## Table Planning

### 1. `profiles`

用途：

- 補足 `auth.users` 之外的產品層使用者資訊

建議欄位：

- `id`
- `auth_user_id`
- `display_name`
- `avatar_url`
- `cohort_source`
- `created_at`
- `updated_at`

說明：

- `auth_user_id` 對應 Supabase Auth 的 user id
- `cohort_source` 用來標記來源，例如 `lilai_referral`、`organic`

### 2. `source_items`

用途：

- 紀錄使用者提交的原始學習素材

可能來源：

- 貼上的文字
- 圖片 OCR
- 後續擴充的檔案、文章、題目內容

建議欄位：

- `id`
- `user_id`
- `source_type`
- `raw_text`
- `source_image_url`
- `detected_language`
- `processing_status`
- `created_at`
- `updated_at`

說明：

- `source_type` 可用 `text`、`image`
- `processing_status` 可用 `pending`、`processed`、`failed`

### 3. `flashcards`

用途：

- 存放由 AI 抽出的 vocabulary 卡片

建議欄位：

- `id`
- `user_id`
- `source_item_id`
- `word`
- `phonetic`
- `part_of_speech`
- `definition_zh`
- `example_en`
- `example_zh`
- `irish_usage`
- `card_status`
- `is_favorited`
- `last_reviewed_at`
- `created_at`
- `updated_at`

說明：

- `source_item_id` 讓卡片可回溯到原始輸入
- `card_status` 可用於封存、刪除、啟用

### 4. `error_logs`

用途：

- 存放 AI 抽出的錯誤修正卡

建議欄位：

- `id`
- `user_id`
- `source_item_id`
- `wrong_sentence`
- `correct_sentence`
- `error_type`
- `explanation`
- `is_favorited`
- `last_reviewed_at`
- `created_at`
- `updated_at`

說明：

- 與 `flashcards` 平行存在
- 這是 ReLai 很重要的差異化資料類型

### 5. `review_events`

用途：

- 紀錄每一次複習行為

建議欄位：

- `id`
- `user_id`
- `card_type`
- `card_id`
- `review_result`
- `reviewed_at`

說明：

- `card_type` 可標示 `flashcard` 或 `error_log`
- `review_result` 可依 v1 輕量設計，例如 `viewed`、`known`、`needs_review`

### 6. `user_stats`

用途：

- 存放首頁與成長統計需要的彙總數據

建議欄位：

- `id`
- `user_id`
- `current_streak`
- `longest_streak`
- `total_reviews`
- `total_flashcards`
- `total_error_logs`
- `last_active_date`
- `created_at`
- `updated_at`

說明：

- 這張表偏向聚合資料
- 避免首頁每次都從 event raw data 即時計算

### 7. `user_settings`

用途：

- 存放個人學習設定

建議欄位：

- `id`
- `user_id`
- `daily_goal`
- `timezone`
- `created_at`
- `updated_at`

說明：

- `daily_goal` 是 v1 明確需要的設定
- `timezone` 影響 streak 與每日切日計算

### 8. `achievements`

用途：

- 定義勳章或 milestone 規則

建議欄位：

- `id`
- `code`
- `name`
- `description`
- `threshold_type`
- `threshold_value`
- `created_at`

說明：

- 這張表定義規則本身
- 可支援例如 `7_day_streak`、`100_reviews`

### 9. `user_achievements`

用途：

- 紀錄使用者已獲得的勳章

建議欄位：

- `id`
- `user_id`
- `achievement_id`
- `awarded_at`

## 關係概念

可以先這樣理解：

```text
auth.users
   |
   v
profiles
   |
   v
source_items
   | \
   |  \
   |   --> flashcards
   |
   ---> error_logs

profiles
   |--> user_stats
   |--> user_settings
   |--> review_events
   \--> user_achievements --> achievements
```

## 命名原則

建議採以下規則：

- table 名稱用複數：`flashcards`, `error_logs`
- 主鍵統一 `id`
- 外鍵命名清楚：`user_id`, `source_item_id`, `achievement_id`
- 時間欄位統一：
  - `created_at`
  - `updated_at`
  - `last_reviewed_at`
  - `reviewed_at`

欄位命名以可讀性為先，不追求過度縮寫。

## v1 設計原則

### 1. 先支援產品核心，不做過度抽象

v1 的重點是：

- 能接收輸入
- 能生成 vocabulary / error log
- 能複習
- 能累積 streak / daily goal / stats

不要一開始就把 schema 做成複雜的通用學習平台。

### 2. 事件與聚合分開

- `review_events` 保留原始複習事件
- `user_stats` 保留聚合結果

這樣查詢速度與後續分析都會更穩定。

### 3. 能追溯來源

`flashcards` 與 `error_logs` 都應能回溯 `source_items`，不然後續很難分析 AI 抽取品質，也難做重新生成。

### 4. 把設定獨立出去

像 `daily_goal`、`timezone` 這些與使用者偏好有關的資料，不要混進 `profiles`，獨立成 `user_settings` 會更乾淨。

## 後續落地順序建議

建議 schema 落地順序：

1. `profiles`
2. `source_items`
3. `flashcards`
4. `error_logs`
5. `review_events`
6. `user_stats`
7. `user_settings`
8. `achievements`
9. `user_achievements`

原因：

- 先把主學習流程打通
- stats 與 gamification 可以在核心流程穩定後補齊

## 與 `infra/supabase/` 的分工

這裡是設計層，`infra/supabase/` 是部署層。

分工如下：

- `database/`：討論 schema、欄位、關聯、責任
- `infra/supabase/migrations/`：正式 SQL migration
- `infra/supabase/policies/`：RLS 規則
- `infra/supabase/seeds/`：正式 seed

這樣能避免產品設計討論直接污染 migration 檔案。
