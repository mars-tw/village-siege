# Village Siege 技術重工缺口草案

狀態：`Draft / read-only audit`
範圍：本文件只規劃重工，不修改 production code。第一個可玩垂直切片以單機 skirmish 為交付目標；多人權威接線列為緊接其後的施工線。

## 1. 現況缺口表

| 區域 | 現況證據 | 缺口與影響 | 處置 |
|---|---|---|---|
| 客戶端角色 | `apps/client/src/scenes/MatchScene.ts` 用 `Phaser.Graphics` 的圓、三角形、直線直接畫單位；`addUnit()` 只有 `scout / guard / archer` | 沒有角色設計、atlas、方向、walk/attack/hurt/death，也無攻擊命中與動畫同步 | 拆掉場景內程序角色繪製，改成 atlas 驅動的 entity view |
| 客戶端規則 | `MatchScene.updateUnit()`、`attack()` 直接移動並扣 HP；`apps/client/src/game/content.ts` 又定義一份三兵種數值 | 客戶端成為另一套規則真值，和 shared/server 分岔；無法重播或安全連線 | 刪除重複戰鬥資料；單機與多人都只消費 shared snapshot/event |
| 資產載入 | `BootScene.ts` 沒有 preload；`apps/client/public/` 沒有角色資產，只有根目錄 `assets/ATTRIBUTION.md` | 即使新增圖檔也沒有 manifest 完整性、授權或缺幀檢查 | 建立 typed atlas manifest、loader 與 CI validator |
| shared 兵種 | `packages/shared/src/protocol.ts` 固定舊六兵種；`content.ts` 只有 HP、傷害、射程、速度 | 缺 damage type、armor class、狀態、技能、施法、projectile、facing、animation cue | 以資料驅動 combat definitions 取代舊兵種契約 |
| shared 戰鬥 | `simulation.ts` 在攻擊冷卻結束時直接 `target.hitPoints -= attackDamage` | 沒有克制、護甲、範圍傷害、狀態、投射物飛行或可供呈現的戰鬥事件 | 拆為固定 tick 的 movement/combat/status/projectile systems |
| shared AI | `ai.ts` 只針對舊兵種，每次決策最多一個簡單指令 | 不懂七兵種克制、技能、外怪、集火與撤退；目前也未被 `MatchScene` 使用 | 保留 observation/controller 介面，替換 production/target/skill policy |
| server 權威 | `VillageSiegeRoom.ts` 開戰後只遞增 `serverTick`；`match.command` 僅做表面 envelope/sequence 檢查，未呼叫 `validateCommand/applyCommand/stepSimulation` | 指令沒有改變權威世界，傷害、技能與勝負無法同步 | 房間持有 shared `MatchState` 與 command queue，每 100 ms 驅動一次 shared step |
| server schema | `apps/server/src/schema/GameState.ts` 只含大廳、玩家及 tick | 沒有 recipient-scoped snapshot；若直接把完整世界放入全域 schema，會洩漏戰爭迷霧 | 大廳 schema 保留；戰場用逐玩家可見 snapshot/event message |
| 多人客戶端 | `MultiplayerClient.ts` 只投遞指令、取得大廳 snapshot；`MultiplayerLobbyScene.ts` 進入 `playing` 後仍停在大廳 | 沒有世界快照 store、插值、事件播放或 MatchScene 轉場 | 分離 transport/gateway/store；收到 `match.started` 後啟動同一個 MatchScene online adapter |
| 測試 | shared 目前測 replay、非法指令及 AI 長跑；多人 smoke 只測建房/ready/tick | 沒有克制矩陣、技能、狀態、投射物、動畫完整性、單機可玩流程或線上結果一致性測試 | 新增 combat、asset、skirmish E2E 與 authoritative convergence tests |

第一個垂直切片的硬門檻：七個攻擊兵種 `mage / archer / gunner / warrior / shieldBearer / boarRider / crossbowman`，以及至少三種原創外怪 `mireHound / stonehideOgre / hollowWraith`。十種角色全部必須有六個明確方向 `east / northEast / northWest / west / southWest / southEast`，以及 `walk / attack / hurt / death`；建議另做 `idle`。不得以 runtime 幾何圖形或單張旋轉圖冒充完成影格。

七兵種最低玩法契約：法師以奧術/燃燒拆重甲與盾陣；弓箭手以緩速箭牽制騎乘獸；火槍兵以破甲齊射拆重甲但怕貼身；戰士突進克遠程但怕盾；盾牌手以盾牆降低 projectile 傷害；野豬騎士衝鋒切後排但怕弩；弩攻手以穿甲弩克野獸與重甲但裝填慢。所有倍率、護甲、冷卻、施法前搖、狀態堆疊規則都放資料檔，不寫進 Phaser 類別。

## 2. 檔案級目標架構

### 保留並縮小責任

- `apps/client/src/game/isometric.ts`：保留 2:1 投影；補方向量化與 round-trip 測試，不承擔規則。
- `apps/client/src/game/createGame.ts`：保留場景註冊；加入 asset-loading/error scene。
- `apps/client/src/ui/hud.ts`：保留視覺語言；拆出技能列、冷卻、狀態與克制提示。
- `apps/client/src/scenes/VillageSelectScene.ts`：保留選村/AI 入口。
- `apps/client/src/scenes/MultiplayerLobbyScene.ts`：保留大廳 UI；修改 playing 轉場。
- `packages/shared/src/random.ts`：保留決定論 PRNG。
- `packages/shared/src/ai.ts`：保留 `AiObservation` / `AiController` 邊界，重寫決策資料。
- `apps/server/src/roomCode.ts`、大廳/重連骨架：保留並加測。

### 必須替換或拆分

- `apps/client/src/game/content.ts`：移除單位數值；若仍需村莊 palette，改名 `visualContent.ts`，規則一律 import shared。
- `apps/client/src/scenes/MatchScene.ts`：改成薄 orchestrator；刪除 `Actor` 規則狀態、`addUnit()` 幾何圖與本地 `attack()` 扣血。
- `packages/shared/src/content.ts`：保留村莊/建築，將舊 UnitDefinition 移往 combat definitions。原規格「六兵種」與新七攻擊兵種衝突，Phase 0 必須同步更新正式 spec；經濟村民可作第八個非戰鬥單位，舊 `militia/spearman/scout/batteringRam` 不可無聲混用。
- `packages/shared/src/protocol.ts`：拆出 combat types，新增 `castSkill` command、公開狀態與戰鬥事件。
- `packages/shared/src/simulation.ts`：拆成 state/create/validate/step 與獨立 systems，最後刪除 monolith。
- `apps/server/src/rooms/VillageSiegeRoom.ts`：只保留房間 lifecycle；模擬、投影、rate limit 移至 server match 模組。
- `apps/client/src/network/MultiplayerClient.ts`：拆出 transport、command gateway、snapshot store；不可再只暴露 lobby snapshot。

### 新增 shared 領域檔

```text
packages/shared/src/combat/types.ts
packages/shared/src/combat/units.ts
packages/shared/src/combat/monsters.ts
packages/shared/src/combat/skills.ts
packages/shared/src/combat/counterMatrix.ts
packages/shared/src/combat/damage.ts
packages/shared/src/combat/status.ts
packages/shared/src/simulation/state.ts
packages/shared/src/simulation/createMatch.ts
packages/shared/src/simulation/commands.ts
packages/shared/src/simulation/step.ts
packages/shared/src/simulation/systems/movementSystem.ts
packages/shared/src/simulation/systems/combatSystem.ts
packages/shared/src/simulation/systems/projectileSystem.ts
packages/shared/src/simulation/systems/statusSystem.ts
packages/shared/src/simulation/systems/victorySystem.ts
packages/shared/src/view/visibleSnapshot.ts
```

`damage.ts` 採整數/permille 管線：base → skill scalar → damage-vs-armor multiplier → armor/sunder → guard/projectile reduction → 最低傷害；固定 tie-break 依 entity id。`status.ts` 明定 `refresh / stack / replace`、最大層數與 tick 到期順序。投射物是權威 state，不以動畫 frame 決定命中；shared 發出 `attackStarted / projectileSpawned / damageApplied / statusApplied / entityDied`，client 只呈現。

### 新增資產與 Phaser 呈現檔

```text
apps/client/public/assets/original/atlas-manifest.json
apps/client/public/assets/original/units/<unit-id>/<unit-id>.png
apps/client/public/assets/original/units/<unit-id>/<unit-id>.json
apps/client/public/assets/original/monsters/<monster-id>/<monster-id>.png
apps/client/public/assets/original/monsters/<monster-id>/<monster-id>.json
apps/client/public/assets/original/projectiles/projectiles.png
apps/client/public/assets/original/projectiles/projectiles.json
apps/client/src/assets/AssetManifest.ts
apps/client/src/assets/AssetCatalog.ts
apps/client/src/render/Direction6.ts
apps/client/src/render/EntitySpriteController.ts
apps/client/src/render/ProjectileRenderer.ts
apps/client/src/render/CombatEventPresenter.ts
apps/client/src/match/MatchSource.ts
apps/client/src/match/LocalMatchSource.ts
apps/client/src/match/NetworkMatchSource.ts
apps/client/src/match/SnapshotStore.ts
apps/client/src/input/CommandController.ts
apps/client/src/ui/SkillBar.ts
apps/client/src/ui/StatusStrip.ts
```

Atlas key 固定為 `actor.<id>.<state>.<direction>.<frame>`；projectile 為 `projectile.<id>.<state>.<direction>.<frame>`。manifest 對每個角色列出六方向、四個硬門檻動作、fps、loop、release/hit cue、frame count、腳底 anchor、來源與授權。最低影格建議：walk 8、attack 8、hurt 4、death 8；arrow/bolt 的 flight 至少 4 frame、impact 至少 4 frame。validator 必須因任一缺方向、缺動作、重複 frame key、越界 anchor 或 attribution 缺漏而失敗。

### 新增 server 權威檔

```text
apps/server/src/match/AuthoritativeMatch.ts
apps/server/src/match/CommandQueue.ts
apps/server/src/match/CommandRateLimiter.ts
apps/server/src/match/AiSlotRunner.ts
apps/server/src/match/RecipientSnapshotProjector.ts
apps/server/src/match/MatchMessageRouter.ts
apps/server/src/match/MatchRuntime.test.ts
```

權威資料流固定為：client intent → envelope/room/rate/ownership 驗證 → 排入下一 tick → shared `stepSimulation()` → recipient-visible snapshot/events → client interpolation/render。local skirmish 用 `LocalMatchSource` 跑完全相同的 shared step；多人只把該 source 換成 `NetworkMatchSource`，不得另寫一套傷害公式。

## 3. 施工 phases 與派工

每條線固定兩位工作員、一位主管、一位獨立稽核；工作員不得共改同一檔。主管先整合，稽核後才產生 compressed handoff，並只刪除該線 run-scoped、可重建的一次性輸出。

### Phase 0 — 契約凍結

- P0-W1：更新正式 spec 的七攻擊兵種、三外怪、六方向與垂直切片驗收。
- P0-W2：定稿 combat type、counter matrix、skill/status/projectile event schema。
- P0-S：確認舊六兵種遷移、村民定位、命名及版本 `rulesVersion` 升級。
- P0-Q：拒絕任何 client/server 重複規則或未列出的 asset key。

### Phase 1 — B 線 shared 戰鬥（最先施工）

- B-W1：負責 `combat/*` definitions、damage、status 與單元測試。
- B-W2：負責 `simulation/*` systems、projectile/event、AI policy 與 replay 測試。
- B-S：整合為 10 Hz deterministic step，驗證七兵種與三外怪都能 spawn/cast/die。
- B-Q：以固定 seed 重跑 counter、status ordering、projectile impact、AI legality；輸出壓縮交接。

### Phase 2 — A 線角色資產與 atlas

- A-W1：法師、弓箭手、火槍兵、戰士、盾牌手、野豬騎士、弩攻手的十字比例、武器輪廓、六方向四動作成品。
- A-W2：三種外怪、arrow/bolt/spell/tracer/impact、atlas packing、manifest 與 attribution。
- A-S：逐角色檢查 native scale 輪廓、腳底 anchor、方向連續性、攻擊 release frame 與原創性。
- A-Q：跑 asset validator，逐方向 montage 審核；清掉未採用草圖、暫存輸出與中間 atlas，但保留 source master、成品、證據與授權。

### Phase 3 — C 線單機可玩垂直切片

- C-W1：`AssetCatalog`、`EntitySpriteController`、projectile/event renderer、snapshot interpolation。
- C-W2：`LocalMatchSource`、選取/移動/攻擊/技能輸入、SkillBar/StatusStrip、skirmish 勝負流程。
- C-S：把 `MatchScene` 收斂成 orchestration；確認玩家可操控七兵種，AI 會用技能，三種外怪會巡邏/索敵/掉落戰術資源或 buff。
- C-Q：實玩驗證 walk/attack/hurt/death、箭矢/命中、冷卻、克制提示與一局從開始到勝負；壓縮交接。

垂直切片必須同時滿足：七兵種各至少一個可操作技能；三外怪是三種不同 silhouette/behavior，不是換色；所有十種角色的六方向四動作可被測試畫廊與戰場觸發；傷害與狀態只來自 shared；玩家能以多選、右鍵與技能快捷鍵完成一局 skirmish；AI 不能只向城鎮中心直走。

### Phase 4 — D 線 server authority 與多人接線

- D-W1：`AuthoritativeMatch`、command queue、AI slot、recipient snapshot projector。
- D-W2：rate limit、message router、network source、lobby→match transition、重連 resync。
- D-S：以兩客戶端驗證相同 tick/checksum/勝負，並確認 client 偽造傷害、技能冷卻或實體 ID 全被拒絕。
- D-Q：斷線重連、霧外資料、跳號、spam、全局 schema 洩漏與資源清理稽核；壓縮交接。

## 4. 驗收命令與風險

施工完成後根目錄必須提供下列可重跑命令（缺 script 即不算完成）：

```powershell
npm ci
npm run typecheck
npm run test:shared:combat
npm run test:assets
npm run test:e2e:skirmish
npm run smoke:multiplayer:local
npm run verify
npm audit --omit=dev
```

細項驗收：

- `test:shared:combat`：七兵種/三外怪 registry 完整；每個技能合法；克制矩陣無 NaN/負值/未覆蓋組合；狀態堆疊順序、projectile impact tick、death/victory、fixed-seed replay hash 一致。
- `test:assets`：10 個 actor × 6 directions × 4 required states 全數存在；arrow/bolt flight/impact 存在；frame/anchor/cue/attribution 全合法；禁止 runtime-placeholder flag。
- `test:e2e:skirmish`：載入一局、選取七兵種、移動、普通攻擊、逐一觸發七技能、遭外怪傷害、死亡動畫、AI 交戰、出現勝負；瀏覽器 console 0 errors。
- `smoke:multiplayer:local`：兩 client 建房/ready/start 後收到世界 snapshot；合法技能在同 tick 產生相同結果；偽造/重複/超頻 command 被拒；斷線 60 秒內 resync。
- 人工證據：六方向 animation gallery、實戰 1280×720 截圖、角色 silhouette 對照、30–60 秒戰鬥錄影、原創性與授權稽核表。

| 風險 | 等級 | 控制方式 |
|---|---:|---|
| 十角色六方向四動作至少 1,680 個最低影格，量大導致混角/缺幀 | 高 | 先鎖 silhouette/key pose，再批次補間；manifest validator 與逐角色主管簽核；atlas 依角色 lazy load |
| 規則事件與動畫 release/hit frame 漂移 | 高 | 命中以 shared tick 為真；manifest cue 只做呈現，snapshot/event 可強制校正 |
| 舊六兵種規格與新七攻擊兵種衝突 | 高 | Phase 0 升 `rulesVersion` 並明確 migration；禁止新舊 ID 混用 |
| `simulation.ts` 大拆分期間 replay 行為倒退 | 高 | 先加 characterization tests，再逐 system 搬移；每步比較固定 seed hash |
| AI 產生非法技能或只會直衝 | 中高 | observation 不洩漏霧外資料；長跑 legality test + counter-aware target/retreat scenarios |
| 全域 Colyseus schema 洩漏不可見敵軍 | 高 | 房間 schema 只存大廳；每位玩家由 `RecipientSnapshotProjector` 個別送可見狀態 |
| projectile/狀態增加 snapshot 頻寬 | 中 | 10 Hz 增量事件、定期 checksum/full resync；短命 visual particle 不進權威 state |
| sprite atlas 記憶體與 draw-call 超標 | 中 | trimmed atlas、分組載入、texture budget；100 可見單位下 p95 ≥ 50 FPS |
| 美術過度接近既有商業 RTS | 高 | 依 `docs/art-direction.md` 原創 field-ledger 語言；保留來源/master/修改紀錄並做獨立原創性稽核 |
| 稽核清理誤刪成品 | 中 | 只刪稽核清單內 exact absolute run-scoped paths；保留 source master、production atlas、測試證據與 lockfile |

Go/No-Go：Phase 3 全部命令與人工證據通過前，不宣稱「有完成角色美術或可玩版本」；Phase 4 convergence、安全與重連通過前，不宣稱「可線上對戰」。
