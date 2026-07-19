# Village Economy Assault — Grok CLI 最終稽核

- 日期：2026-07-19（Asia/Taipei）
- 稽核基準：`97bfc988eab1d29a590970d87519bd811c41e7e7`
- 範圍：目前未提交的村莊經濟攻城垂直切片
- 最終 verdict：`PASS WITH P2`
- P0：無
- P1：無
- 發布定位：單人經濟攻城垂直切片；不代表多人戰場已完成權威同步

## 1. Grok CLI 實際環境

```powershell
Get-Command grok
& 'C:\Users\digimkt\.grok\bin\grok.exe' --version
& 'C:\Users\digimkt\.grok\bin\grok.exe' models
```

實際結果：

```text
Path: C:\Users\digimkt\.grok\bin\grok.exe
grok 0.2.101 (5bc4b5dfad) [stable]
You are logged in with grok.com.
Default model: grok-4.5
Available models: grok-4.5
```

CLI 可用且已登入。`models`、兩次唯讀稽核皆 exit `0`。

## 2. 唯讀執行方式

兩輪皆只開放 `Read,Glob,Grep`，並關閉網搜、子代理與記憶；Grok 沒有 shell 或寫檔工具。

```powershell
& 'C:\Users\digimkt\.grok\bin\grok.exe' `
  --cwd 'C:\Users\digimkt\Documents\Codex\2026-07-17\new-chat\village-siege' `
  --single $prompt `
  --tools 'Read,Glob,Grep' `
  --always-approve `
  --disable-web-search `
  --no-subagents `
  --no-memory `
  --max-turns 50 `
  --output-format plain
```

第一輪：

- session：`019f79a5-4b6a-7e63-b904-1aa5b45acbad`
- exit：`0`
- 原始 verdict：`FAIL`
- 執行期間其他施工線仍在更新工作樹，因此全工作樹 diff hash 前後不同；Grok 本身仍受限於唯讀工具。

第二輪增量複稽：

- session：`019f79ae-ca2c-7fe2-a06c-7f46e364cd5e`
- exit：`0`
- 原始 verdict：`PASS WITH P2`
- 前後 HEAD 相同。
- 對下列九個檔案逐一計算 SHA-256，執行前後完全相同：
  - `packages/shared/src/simulation.ts`
  - `packages/shared/src/simulation.test.ts`
  - `packages/shared/src/ai.ts`
  - `packages/shared/src/ai.test.ts`
  - `apps/client/src/game/villageAssaultRuntime.ts`
  - `apps/client/src/game/villageAssaultMap.ts`
  - `apps/client/src/game/villageAssaultArt.ts`
  - `apps/client/src/scenes/VillageAssaultScene.ts`
  - `apps/client/src/ui/canvasButton.ts`

複製 Grok 稽核工作階段：

```powershell
grok export 019f79ae-ca2c-7fe2-a06c-7f46e364cd5e
```

## 3. 第一輪原始結論摘要

第一輪 Grok 判定 `FAIL`，主要問題為：

- P0：進行中的純觸控流程沒有 restart／leave。
- P1：兵營七兵種塞滿七個槽，系統操作不可達。
- P1：aggressor、guardian、raider 缺少採集 fallback；train 失敗可能停擺。
- P1：guardian 無可見敵人時不會巡防或推進。
- P1：AI 用 `hitPoints === maxHitPoints` 推斷施工完成，受傷的已完工建築會被誤判。
- P2：全部 action sheet 於場景入口一次載入、AI 偵查記憶未接線、UI 有規則魔法數字、建造合法區未進 shared。

第一輪原始收斂句：

> FAIL——simulation 與玩家經濟環節可玩且藝術失敗路徑正確，但觸控進行中無法 leave/restart，且 AI 與兵營 dock 有多項阻擋。

## 4. 修正後 Grok 複稽

第二輪逐項確認前輪阻擋已關閉：

1. `VillageAssaultScene.ts:558-567` 的 system panel 提供 restart、pause/resume、zoom、fullscreen、leave、back。
2. `VillageAssaultScene.ts:590-603` 將兵營拆成兩頁；七兵種均可達，兩頁都保留系統入口。
3. `packages/shared/src/ai.ts:132-179` 為 aggressor、guardian、raider 補上 gather fallback；guardian 無敵時改為 defensive patrol。
4. `packages/shared/src/ai.ts:120-125` 使用 `ownIncompleteBuildingIds` 區分施工中與受傷的已完工建築。
5. `villageAssaultRuntime.ts:60-66,116-188` 只透過 `applyCommand`／`stepSimulation` 改變狀態；場景沒有直接竄改 wallet、population、queue 或 HP。
6. `simulation.ts:296` 以 `trainingQueue.length + command.count` 驗證佇列上限。
7. `villageAssaultArt.ts:82-93,176-178` 每次同步訓練倒數，不再被 `stateRevision` 閘住。
8. `simulation.ts:430-444,504-524` 在 shared 套用 gather、unit speed、tower armor 村莊 trait。
9. `VillageAssaultScene.ts:76-85` 的 `Record<UnitType, CombatArtId>` 完整涵蓋村民與七軍事兵種；`882-904` 對角色素材失敗提供明確錯誤畫面與返回路徑。

第二輪 Grok 原始收斂句：

> 前輪 FAIL 的七項 P0/P1 在目前檔案皆有對應實作與測試佐證，無殘留 P0/P1；切片在採集、建造、產兵、進攻與 568×320 可操作性上達可發布（附 P2）水準。

## 5. Codex 主管交叉核對

### Shared 單一真相

通過。資源、人口、施工、佇列、傷害與征服均由 `packages/shared/src/simulation.ts` 管理；`VillageAssaultRuntime` 只封裝 command envelope、AI 決策與固定 10 Hz simulation step；Phaser 場景只投影狀態與發出命令。

### AI 經濟到進攻

通過垂直切片門檻。五人格共享相同合法 command 路徑；施工中等待、受傷完成建築、queue 飽和、資源不足 fallback 與 guardian patrol 均有實作。shared 測試已涵蓋合法長跑、balanced 經濟到推進、受傷完成建築及 fallback。

### 568×320 指令列

通過。實際證據 `output/playwright/mobile-system-final.png` 為 `568×320`：七槽固定列完整顯示「重新開始、暫停、縮小、放大、全螢幕、離開戰役、返回」，沒有按鈕或文字跨槽。按鈕 hit zone 由 `140×92` logical 經獨立 UI camera 換算約 `69×45.4` CSS px，高寬均達 44 px 門檻。

### 建築、資源與產兵

通過。施工百分比、受損血量、資源耗損、訓練數量／倒數均有畫面投影；house 增加人口，lumber camp／farmstead 提供對應採集加成，barracks 可訓練七兵種，tower 與 town center 參與權威傷害／征服。

### 角色載入

通過。所有 `UnitType` 都有 action-sheet art 映射；manifest 或材質缺失採硬失敗，不以 primitive 或單張圖片靜默替代。場景入口仍一次載入本場可能訓練的全部七張 action sheet，屬效能 P2，不是角色缺失風險。

## 6. P0 / P1 / P2

### P0

無。

### P1

無。

### P2

1. 場景入口會載入全部 unit action sheets，而非依初始單位或訓練需求逐張載入；可在後續做 manifest-aware lazy loading。
2. `isSettlementBuildable` 與地形／保留道路仍是 client 規則；shared 建造驗證只檢查邊界與單格占用。若下一階段加入 footprint、牆、門與正式尋路，必須將合法區與 footprint 移入 shared。
3. `rememberedEnemySites` 尚未接入 `VillageAssaultRuntime`；本切片靠主動推進取得視野，但下一階段的 fog-of-war AI 應保存偵查記憶。

稽核後由 Codex 主管直接收斂三項低風險 P2：balanced train 失敗已接 `economyCommand` fallback 並新增回歸測試；UI queue 上限改用 `MAX_TRAINING_QUEUE_DEPTH`；征服倒數改由 `TOWN_CENTER_REBUILD_GRACE_TICKS` 與 `TICKS_PER_SECOND` 推導。

## 7. 驗證狀態

已確認：

- Grok 第二輪 exit `0`，監看檔案 SHA-256 前後一致。
- shared 最新測試：`40/40` 通過。
- shared typecheck：通過。
- client typecheck：通過。
- multiplayer lobby smoke：通過；這只驗證既有 lobby，不代表經濟攻城多人同步。
- 568×320 system panel 與 390×844 portrait blocker 有 Playwright 圖像證據。
- 清理殘留 Playwright／Vite 程序後，最新完整 `npm run verify` exit `0`：client、server、shared typecheck、40 項 shared tests、client production build 與 server build 全部通過。

附註：本輪曾有兩次 monorepo 驗證在沒有 TypeScript／Vitest 診斷時因殘留 Playwright、Vite 與 Node 程序資源壓力異常結束；精確終止本專案的暫存程序並清掉一次性快取後，重新執行即取得上述完整 exit `0`，未發現程式回歸。

## 8. 最終判定

`PASS WITH P2`。

Grok 與 Codex 主管交叉稽核一致：目前沒有阻止單人經濟攻城垂直切片發布的 P0/P1。稽核後已再消除 AI fallback 與 UI 規則常數兩類 P2；剩餘項目集中於素材載入效能與下一階段 shared footprint／fog-of-war 架構，不影響本輪「採集 → 建造 → 產兵 → 進攻主城」可玩循環。
