# B-Q1 共用模擬與 AI 獨立稽核

- 日期：2026-07-17（Asia/Taipei）
- 身分：B-Q1 獨立稽核員
- 稽核範圍：`packages/shared`
- 依據：`spec/spec-design-village-siege.md`、`plan/feature-village-siege-mvp-1.md`、`docs/production-workflow.md`
- 主管輸入：`audit/simulation-supervisor-review.md`
- 決定：`APPROVED AFTER REWORK — CORE MILESTONE ONLY`
- 內容雜湊：`sha256:660c0f49241035904988499a6c159570762e42406ac4980700f14b44a3219ae5`（`packages/shared`，排除 `node_modules`）

## 稽核結論

共用模擬與五種 AI 已通過本核心里程碑。首次獨立長跑抓到 `prosperer` 在 town center 訓練佇列飽和後仍送出 train 的缺陷；本線依關卡退回 B-W2，沒有跳過主管或稽核。修正後，五種人格各跑 10,000 tick 均無例外，所有輸出命令都能立即通過同一個 `validateCommand`，原缺陷關閉。

此核准只涵蓋可獨立執行的 shared simulation／AI core；不代表 Phaser 單機流程、Colyseus 權威戰鬥、完整多人連線或整體 MVP 已完成。

## 獨立執行證據

1. 初次重跑 `npm run test --workspace @village-siege/shared`：2 個測試檔、8/8 通過。
2. 初次重跑 `npm run typecheck --workspace @village-siege/shared`：exit 0。
3. B-Q1 一次性探針將五人格各跑 10,000 tick；初次結果中 `prosperer` 發出 123 個命令，其中 18 個被拒絕為 `ACTION_ON_COOLDOWN`。B-Q1 判定為 TEST-004 核心阻擋並退件。
4. B-W2 修正：新增 `MAX_TRAINING_QUEUE_DEPTH = 5`、AI 自身的 `ownTrainingQueueDepth` 觀測，以及訓練前 producer／queue／資源／人口檢查；加入 queue 飽和與五人格長跑回歸測試。
5. 修正後重跑 `npm run test --workspace @village-siege/shared`：2 個測試檔、10/10 通過，exit 0。
6. 修正後重跑 `npm run typecheck --workspace @village-siege/shared`：exit 0。
7. 修正後再次獨立長跑：`aggressor` 6、`guardian` 3、`prosperer` 114、`balanced` 261、`raider` 6 個命令；五者皆到達 tick 10,000，拒絕數全部為 0。

## 契約核對

| 核對項 | 結果 | 證據摘要 |
|---|---|---|
| 固定 seed 決定性 | 通過 | 相同 seed 與 tick 的 state hash 相等；獨立 1,000 tick hash 為 `2b5578cb`。 |
| 非法與畸形命令 | 通過 | 額外欄位、資源不足及不可達目標由 validator 拒絕；拒絕不突變原 state。 |
| 外來／冒名命令 | 通過 | 外來實體為 `ENTITY_NOT_OWNED`；非成員 player 為 `NOT_ROOM_MEMBER`。 |
| 重複 sequence | 通過 | 已接受 sequence 再送為 `STALE_OR_DUPLICATE_SEQUENCE`。 |
| 五種人格差異 | 通過 | 開局建造、訓練、採集與目標優先序不同；同 seed 可重現。 |
| 10,000 tick 合法性 | 修正後通過 | 五人格全程無例外、0 個語義非法命令。 |
| 隱藏資訊隔離 | 通過 | 改動不可見敵方 HP、revision、wallet 不改變 AI observation 或決策；queue depth 僅包含自身建築。 |
| 村莊規模 | 通過 | `pinehold`、`riverstead`、`highcrag` 為 3 個可玩村莊；`marshwatch`、`sunfield` 保留 5 村容量；3 與 5 faction 初始化均成立。 |
| 內容數量 | 通過 | 建築 6 種、單位 6 種、資源 3 種；模擬固定 10 ticks/sec。 |

## 保留限制

- AI 每個決策週期目前最多輸出一個命令。
- `rememberedEnemySites` 由上層維護，五種人格尚未主動消費該記憶。
- `budgetMs` 目前只驗證為正有限數，尚未提供真實運算逾時中止。
- shared core 尚未成為 Colyseus 房間內的完整權威戰鬥狀態；此為後續整合關卡。

## 稽核後清理

核准後先解析並驗證絕對路徑位於專案根目錄內，才刪除一次性探針 `C:\Users\digimkt\Documents\Codex\2026-07-17\new-chat\village-siege\.tmp\simulation-audit-probe.ts`，並在確認 `.tmp` 為空後刪除該空目錄。刪除後兩者均不存在。`packages/shared/coverage`、`packages/shared/dist`、`packages/shared/.tmp` 原本就不存在；未刪除 source、tests、`node_modules`、lockfile、主管／稽核證據。
