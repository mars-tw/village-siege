# line-b phase-2 compressed handoff

- Source version: `sha256:660c0f49241035904988499a6c159570762e42406ac4980700f14b44a3219ae5`（`packages/shared` retained files；排除 `node_modules`）
- Decision: `APPROVED AFTER REWORK — CORE MILESTONE ONLY`
- Scope completed: B-W1 共用固定 tick 模擬、命令驗證／套用、資源／建造／訓練／移動／戰鬥／勝負／重播雜湊；B-W2 五種 AI、可見資訊觀測、固定 seed 決策、queue 飽和防護；B-S1 主管返工審核；B-Q1 獨立長跑稽核。
- Files changed: `packages/shared/package.json`、`packages/shared/tsconfig.json`、`packages/shared/src/{index,protocol,content,random,simulation,ai}.ts`、`packages/shared/src/{simulation,ai}.test.ts`、`audit/simulation-supervisor-review.md`、`audit/simulation-audit.md`、本交接檔。
- Interfaces and invariants: `TICKS_PER_SECOND=10`；`MAX_TRAINING_QUEUE_DEPTH=5`；每玩家單位上限 128；match 接受 2–5 factions；可玩村莊為 `pinehold|riverstead|highcrag`，資料容量另含 `marshwatch|sunfield`；AI 為 `aggressor|guardian|prosperer|balanced|raider`；所有人類／AI 意圖走 `CommandEnvelope -> validateCommand -> applyCommand -> DomainEvent`；sequence 單調；AI 只收到自身 state、目前可見敵人／資源、經清洗記憶與自身 producer queue depth，不得讀取敵方隱藏 state。
- Commands executed: `npm run test --workspace @village-siege/shared` 初次 8/8、返工後 10/10，均 exit 0；`npm run typecheck --workspace @village-siege/shared` 初次與返工後均 exit 0；B-Q1 `npx tsx .tmp/simulation-audit-probe.ts` 初次失敗並抓到 18 個 queue 飽和拒絕，返工後 exit 0、五人格各 10,000 tick、0 rejected。
- Evidence retained: `audit/simulation-supervisor-review.md`、`audit/simulation-audit.md`、`packages/shared/src/ai.test.ts` 的 queue 飽和與 10,000 tick 回歸測試、`packages/shared/src/simulation.test.ts` 的決定性與命令邊界測試。
- Risks and limitations: 本核准不涵蓋 Phaser 完整單機、Colyseus 權威戰鬥、斷線復原整合、負載／瀏覽器／E2E／發行測試；`rememberedEnemySites`、真實 `budgetMs` 中止與多命令規劃仍為後續能力。
- Rejected approaches: 首次僅採信 8/8 單元測試即核准的做法被 B-Q1 長跑否決；不以放寬 validator 或移除 queue 上限掩蓋缺陷，改為將自身 queue depth 納入 AI 合法觀測並在決策前防護。
- Next required work: C 線／整合主管將 shared core 接入 Colyseus authoritative room，讓 server tick 實際套用 validated commands 與 AI decisions；完成雙客戶端同步、重連、戰鬥、勝負與 room disposal 測試後，再進入整體 MVP 稽核。
- Cleanup performed: 已刪除已驗證且只屬本次稽核的 `.tmp/simulation-audit-probe.ts` 與空 `.tmp/`；`packages/shared/coverage`、`packages/shared/dist`、`packages/shared/.tmp` 無垃圾可清。保留 source、tests、`node_modules`、lockfile 與所有審核證據。
