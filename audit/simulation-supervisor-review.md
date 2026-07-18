# B-S1 遊戲系統主管審核

- 日期：2026-07-17（Asia/Taipei）
- 線路：B — 共用模擬與 AI
- 工作員：B-W1 模擬工程、B-W2 AI 工程
- 審核範圍：`packages/shared`
- 決定：`APPROVED AFTER REWORK — CORE MILESTONE ONLY`

## 主管結論

本線已交付可脫離瀏覽器與網路執行的 TypeScript 共用領域核心：固定 10 Hz 模擬、三種資源、六種建築、六種單位、三個可玩村莊與五村資料容量、命令驗證與套用、勝負／復建規則、重播雜湊，以及五種可選且固定種子可重現的 AI 人格。主管初審後，B-Q1 以 10,000 tick 長跑發現 `prosperer` 在訓練佇列已滿時仍送 train；本線依流程退回 B-W2。修正後 AI 觀測加入自身 producer queue 深度、共用 queue 上限常數，並加入五人格各 10,000 tick 的即時命令合法性測試；主管與 B-Q1 重跑皆通過。因此核准核心里程碑，但不代表完整單機、多人戰鬥或整體 MVP 已完成。

## 主管重跑證據

- `npm run test --workspace @village-siege/shared`：2 個測試檔、10 項測試通過；含五人格各 10,000 tick 長跑。
- `npm run typecheck --workspace @village-siege/shared`：通過，零型別錯誤（B-W2 自檢）；整體 workspace typecheck 亦於整合關卡通過。
- 固定 seed：相同初始狀態、命令及 tick 的 state／replay hash 一致。
- 命令邊界：畸形、外來實體、資源不足與重複 sequence 會拒絕，原始 state 不被突變。
- AI：`aggressor`、`guardian`、`prosperer`、`balanced`、`raider` 均有明確行為差異；觀測依 ID 正規排序；敵方隱藏 HP、revision 與資源變更不影響 AI 觀測或決策。
- Queue 飽和回歸：`prosperer` 在 town center queue = 5 時改送合法採集；B-Q1 重跑為 114 emitted / 0 rejected。
- 內容契約：`pinehold`、`riverstead`、`highcrag` 可玩；`marshwatch`、`sunfield` 為擴充容量；建築與單位型別各六種。

## 非阻擋限制

1. AI 每次決策目前最多輸出一個命令。
2. `rememberedEnemySites` 由上層維護，目前人格策略尚未主動使用該記憶。
3. `budgetMs` 目前只作輸入有效性門檻，尚未實作真實運算逾時中止。
4. 共用核心尚未接入 Colyseus 房間成為完整多人權威戰鬥狀態；此項屬整合里程碑，不在本次 B 線核心核准範圍。

## 交付稽核

B-Q1 必須獨立重跑測試與型別檢查、核對內容數量和隱藏資訊隔離，並在稽核完成後輸出壓縮交接；只有稽核 `APPROVED` 才能清理本線一次性可再生輸出。

## B-Q1 退件紀錄

- 長跑情境：五人格各 10,000 tick。
- 結果：其餘核心檢查通過；`prosperer` 有 18 個輸出命令因 town center 訓練佇列飽和而被拒。
- 必要修正：AI 在決策前必須辨識 producer queue/cooldown 可用性，並加入可重現的長跑合法性回歸測試。
- 修正：新增 `MAX_TRAINING_QUEUE_DEPTH = 5` 共用常數、`ownTrainingQueueDepth` 自身觀測與 producer queue 防護。
- 重驗結果：shared tests/typecheck 通過；B-Q1 獨立 10,000 tick probe 五人格為零非法命令，原缺陷關閉。
