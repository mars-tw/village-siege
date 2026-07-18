# Village Siege 圖像角色整合稽核清單

狀態：`FINAL RUNTIME AUDIT / FAIL — 7 UNITS + 3 MONSTERS ILLUSTRATED PASS, SIX-DIRECTION ATLAS NO-GO`
範圍：CombatShowcaseScene、BootScene、七兵種與三外怪的 runtime 圖像、atlas／動畫／技能呈現。此文件只記錄驗收與證據，不修改 production code。

## 0. 第二輪最終稽核結論（2026-07-17）

**最終判定：FAIL／NO-GO，不得宣稱六方向逐幀角色美術已完成。**

七兵種與三外怪的「透明 illustrated portrait 載入與可玩 Showcase」里程碑已通過；返工後已確認十個正式角色的 runtime 都不會降級成程序圖形。但目前每個角色仍只有一張高解析立繪；`IllustratedCombatActor` 與 `IllustratedMonsterActor` 都以水平 flip、位移、縮放、旋轉和 tint 模擬六方向與動作。這不符合本清單的六個 authored directions、六個逐幀 actions、七兵種 2,310 authored frames、外怪逐幀 atlas、pixel atlas、team-color mask 與禁止鏡射門檻。

三外怪 `miremaw / ashwing / rootback` 已各有透明 PNG，Boot preload 與 `createIllustratedMonsterActor()` 採硬失敗策略；Showcase 對 monster 固定呼叫 strict illustrated factory，未知外怪 ID 或缺 texture 都直接拋錯，沒有 procedural fallback。這代表外怪 illustrated runtime 已完成，不代表六方向逐幀外怪 atlas 已完成。

### 0.1 最終結果表

| 項目 | 結果 | 第二輪證據與判讀 |
|---|---|---|
| 十份 runtime PNG | **PASS** | 七兵種位於 `assets/original/units/{sharedId}/portrait.png`，三外怪位於 `assets/original/monsters/{monsterId}/portrait.png`；十個正式 ID 都有檔案 |
| Reproducible metadata／來源 | **PASS** | `asset-metadata.json`、`monster-asset-metadata.json`、兩組核准來源圖與兩組抽取腳本均存在；metadata 記錄來源、處理方式與逐檔 SHA-256 |
| SHA-256 | **PASS** | 七兵種先前逐檔重算與 metadata 相符；本輪三外怪逐檔重算亦全部相符。完整值見 0.2、0.3 |
| Alpha padding | **PASS（透明立繪範圍）** | 七兵種皆為 RGBA、edge 0、corner 0；三外怪 metadata 亦為 4 channels、`cornerMaxAlpha: 0`。最終截圖未見矩形底色 |
| Hard pixel edge | **FAIL** | 七兵種每檔有 11,220–23,713 個 partial-alpha pixels；外怪最終畫面也維持 painterly 高解析立繪。整體不是 ART-005 要求的 hard-edged pixel sprite |
| Boot preload | **PASS（十張 image）** | `BootScene.preload()` 明列七兵種與三外怪；`FILE_LOAD_ERROR` 同時收集 `unit-art-*`／`monster-art-*` 缺圖 key，失敗時顯示錯誤並 `return`，不進 VillageSelectScene |
| 七兵種＋三外怪不 fallback | **PASS** | 缺 unit mapping 或已知 unit texture 直接 throw；monster 固定呼叫 `createIllustratedMonsterActor()`，該 strict factory 對未知 ID 或缺 texture 直接 throw，沒有 procedural actor 分支 |
| Shared → art ID | **PASS（runtime）／需型別強化** | 七個 camelCase → art ID 映射齊全且未知 unit fail-fast；但表仍宣告為 `Record<string, CombatArtId>`，不是清單要求的 `Record<CombatUnitId, CombatArtId>` 單一 typed contract |
| 原生縮放辨識度 | **PASS（單張立繪）** | 最終 formation 中七職業剪影可直接分辨；中央泥沼巨口、飛翼灰燼獸與披甲根背獸也呈現三種不同體型，不再是程序式幾何佔位物 |
| Team-color zone | **FAIL** | 十張角色圖本身都沒有驗證 8–14% 的兩個 team-color mask 區；目前主要依 HP bar、Ⅰ／Ⅱ team mark、選取 ring 與 aura 辨別陣營 |
| 六方向 authored frames | **FAIL** | 十個角色各只有一張 `portrait.png`；兩個 illustrated actor 都以 `setFlipX(facingLeft)` 鏡射西向，其餘方向由同圖變形，沒有六套非鏡射方向圖 |
| 六動作逐幀 | **FAIL** | 兩個 illustrated actor 的 `idle/walk/attack/hurt/death/cast` 都只改同一 image 的 transform／tint，沒有 manifest clip frames、release frame 圖像、七兵種 2,310 authored frames 或外怪逐幀組 |
| Atlas／projectile frames | **FAIL** | Boot 載入十張普通 image，不是 multiatlas；沒有七角色 252 clip groups、三外怪方向／動作 atlas、authoritative cue atlas 或箭矢／法術／火槍／重弩逐幀圖像資產 |
| 七角色選取／Q | **PARTIAL PASS** | 弓箭手選取面板與戰士碎甲擊冷卻有瀏覽器證據；靜態碼確認七 unit 都由 shared definitions spawn 且共用 Q 流程，但沒有逐一保存七角色 Q 的完整證據 |
| Browser console | **PASS（主管紀錄）／證據不完整** | 最終十角色畫面回報 0 errors／0 warnings，`illustrated-units-monsters-final.png` 可讀；仍未保留 machine-readable console/network log、三 viewport 與七角色逐一 Q 證據 |
| TypeScript | **PASS** | `npm run typecheck` exit 0，client/server/shared 全部通過 |
| Combat tests | **PASS** | `npm run test --workspace @village-siege/shared -- src/combat.test.ts`：18/18 通過 |
| Full shared tests | **PASS** | 最終重跑 28/28 通過 |
| Client production build | **PASS** | 最終 client production build 通過 |

### 0.2 七 PNG hash／alpha 證據

| Shared ID | PNG 尺寸 | SHA-256 | Alpha metadata |
|---|---:|---|---|
| `warrior` | 463×460 | `2011a5900bf9876fb824916f71ed51e9ddf3d6996b2e7d4c337b48d4e61d1d6e` | RGBA、edge 0、corner 0 |
| `shieldBearer` | 396×406 | `d45c4f415c96cda1e4c2138529d883c4d96e87c45576102807c8c886c46f2ec5` | RGBA、edge 0、corner 0 |
| `archer` | 350×473 | `b47df12a7289720351e7d4f0d7e9ccf53b3dbe19da538039252ea37fa80a6315` | RGBA、edge 0、corner 0 |
| `mage` | 365×477 | `7f0d71b94fcdfd4000825b9f2cac40b179b3e887c85e77e9373713de0c1fd0ec` | RGBA、edge 0、corner 0 |
| `musketeer` | 507×433 | `e104cc8e49518d0f2cf97e07a9a3a6616428fcd94350d44391ee6b88da79f3ba` | RGBA、edge 0、corner 0 |
| `boarRider` | 516×396 | `7048e0792c906ebe19fc9a6cf03d064fcda84bfeb7670317a8f4a125c841dcd0` | RGBA、edge 0、corner 0 |
| `heavyCrossbowman` | 604×414 | `bd7c845abdf3a87d6224a3a5bd786a1a8b036d8e1aa98a9fbe121fc8852f8e41` | RGBA、edge 0、corner 0 |

### 0.3 三外怪 PNG hash／alpha 證據

| Monster ID | PNG 尺寸 | SHA-256 | Alpha metadata |
|---|---:|---|---|
| `miremaw` | 612×572 | `9cbdb06ef1d36e2fd469977116dec4c7948ea2706d8c814e6d5ff7fb99cf3e11` | RGBA、corner 0 |
| `ashwing` | 607×742 | `5104bf34e68fe9648a2dd9c9817e7c007726ec8865ecb63151538e1f7d0bc222` | RGBA、corner 0 |
| `rootback` | 612×747 | `ef981f8fecbc2b1426af0954e3ec74a0eb932fef97652a924fa375005c9386ba` | RGBA、corner 0 |

### 0.4 瀏覽器證據

- [`output/playwright/illustrated-units-monsters-final.png`](../output/playwright/illustrated-units-monsters-final.png)：1280×720，七我方、七敵方與中央三外怪全部使用透明 illustrated PNG；三外怪外型可明確區分。
- [`output/playwright/illustrated-combat-formation.png`](../output/playwright/illustrated-combat-formation.png)：外怪美術接線前的歷史 formation 證據，只用於對照返工前後差異。
- [`output/playwright/illustrated-warrior-skill.png`](../output/playwright/illustrated-warrior-skill.png)：戰士「碎甲擊」已進入 11.8 秒冷卻，可確認 Q 指令被接收。
- [`output/playwright/illustrated-archer-selected.png`](../output/playwright/illustrated-archer-selected.png)：弓箭手選取 ring、HP 85/85、釘地箭雨與技能描述一致。

最終圖證明七兵種與三外怪的 illustrated portrait 已進入可玩場景，但不能證明六方向、六動作、七技能、三 viewport、alpha QA 背景與重開三次清理全部通過。

### 0.5 解除 No-Go 的最小返工

1. 以目前七張核准立繪作 design reference，製作每兵種 `e/ne/nw/w/sw/se` 六個獨立方向；不使用水平 flip 補方向。
2. 完成 `idle/walk/attack/hurt/death/cast` 實際 frames、固定 pivot、release／impact cue 與七兵種合計 2,310 frames；Boot 改載 approved multiatlas。
3. 建立 8–14% team-color mask、NEAREST pixel atlas、projectile／impact frame、manifest URL/hash/licensing validator。
4. 以 Playwright 逐一點選七角色並按 Q，保存七組 cast／projectile／cooldown 證據與三 viewport console/network log。
5. 以三張外怪核准立繪作 reference，補齊 `miremaw / ashwing / rootback` 六方向、六動作與 cue atlas；目前 strict illustrated portrait runtime 不能取代逐幀 atlas 驗收。

## 1. 第一輪原始快照（歷史基線，已由第 0 節取代）

以下表格保留返工前狀態供追溯，不代表目前 runtime；目前判定以第 0 節最終稽核為準。

| 檢查點 | 目前證據 | 判定 |
|---|---|---|
| 角色 renderer | `CombatShowcaseScene.spawnActor()` 固定呼叫 `createProceduralCombatActor()` | **NO-GO**：程序預覽不是七兵種成品 |
| Boot preload | `BootScene` 只有 `create()`，沒有 `preload()` 或專用 asset preload scene | **NO-GO**：沒有 atlas 載入與失敗處理 |
| Runtime 圖檔 | `apps/client/public/assets` 目前只有 `manifests/combat-art-v1.json` | **NO-GO**：沒有可載入 PNG／multiatlas JSON |
| Manifest 狀態 | `status: proceduralFallback`、`proceduralFallback: true`、`atlasRequiredForProduction: true` | **NO-GO**：manifest 自己已禁止當 final art |
| Shared roster | 七個正式 ID 已存在：`warrior / shieldBearer / archer / mage / musketeer / boarRider / heavyCrossbowman` | 準備完成 |
| 場景輸入 | 左鍵選取、右鍵命令、`Q` 技能、`R` 重開、`Esc` 返回已接線 | 待瀏覽器逐角色實測 |

只有所有「硬門檻」完成後才能把狀態改為 `GO`。概念圖、程序角色、單張立繪或缺方向 atlas 都不能解除 No-Go。

## 2. CombatShowcaseScene actor 介面契約

Atlas actor adapter 必須完整實作目前場景使用的最小 `CombatVisual` 介面，不得迫使場景辨識具體 renderer 類別：

```ts
interface CombatVisual {
  readonly container: Phaser.GameObjects.Container;
  play(action: "idle" | "walk" | "attack" | "hurt" | "death" | "cast", restart?: boolean): unknown;
  faceVector(gridDx: number, gridDy: number): unknown;
  update(deltaMs: number): unknown;
  destroy(): void;
}
```

整合檢查：

- [ ] `container` 的互動區以角色原生 frame／腳底 pivot 建立，不使用所有角色共用的 72×96 估算區造成點不到大型角色或透明區誤選。
- [ ] `play()` 只切換視覺；傷害與冷卻不得由 Phaser animation complete 或 frame callback自行決定。
- [ ] `faceVector()` 使用六方向 `e / ne / nw / w / sw / se`，零向量保留前一方向，邊界有 hysteresis。
- [ ] `update()` 可讓非循環動作停在最後合法 frame，`death` 不得因網路／場景更新回到 `idle`。
- [ ] `destroy()` 移除 sprite、shadow、事件與暫時特效；連續按 `R` 重開三次後，texture、input listener、tween 和 timer 數量不可持續增加。
- [ ] `ShowcaseActor.definition` 應直接消費 shared definition，或以明確 adapter 轉換；不可長期維護另一份鬆散 `string` 版本的 ability/status/projectile 型別。
- [ ] 程序 actor 只能存在於明確的美術 debug gallery；正式 Showcase 不得依資產缺失靜默切回程序 renderer。

## 3. Shared ID、Art ID 與 Phaser key 對照

### 3.1 七角色唯一合法映射

| Shared combat ID | Manifest／atlas actor ID | Animation key 範例 | 基本 projectile |
|---|---|---|---|
| `warrior` | `warrior` | `unit.warrior.attack.se` | 無，近戰命中特效 |
| `shieldBearer` | `shieldbearer` | `unit.shieldbearer.cast.ne` | 無，盾牆特效 |
| `archer` | `archer` | `unit.archer.attack.nw` | `proj.arrow.flight.nw` |
| `mage` | `mage` | `unit.mage.cast.sw` | `proj.arcaneCinder.flight.sw` 或經 manifest 明確映射的等價 key |
| `musketeer` | `musketeer` | `unit.musketeer.attack.e` | `proj.musketTrace.flight.e`；authoritative 規則仍為 hitscan |
| `boarRider` | `boar_rider` | `unit.boar_rider.cast.w` | 無，衝鋒塵土特效 |
| `heavyCrossbowman` | `heavy_crossbow` | `unit.heavy_crossbow.attack.se` | `proj.heavyBolt.flight.se` 或經 manifest 明確映射的等價 key |

硬門檻：

- [ ] 映射表型別必須覆蓋 `Record<CombatUnitId, CombatArtId>`，缺一個 ID 即 typecheck／validator 失敗。
- [ ] 刪除或禁止 `UNIT_ART_IDS[id] ?? "warrior"` 這類靜默替代；未知 ID 必須顯示可診斷的載入錯誤並阻止開局。
- [ ] Shared 的 camelCase ID、manifest 的 snake_case ID 只在單一 mapping 模組轉換；場景、BootScene、測試不可各寫一份。
- [ ] 每個角色恰好有 6 directions × 6 actions 的 clip，不能鏡射不對稱裝備來補方向。
- [ ] 動畫 key、frame key、projectile key 的大小寫必須完全一致；禁止在 runtime 用模糊搜尋或自動改 casing。
- [x] 三外怪保持同 ID `miremaw / ashwing / rootback`，透明 portrait、Boot hard failure 與 strict illustrated factory 已完成；六方向逐幀 atlas 仍未完成，不能冒充整體美術成品。

### 3.2 Cue 對齊

- [ ] `attack` 或 `cast` 的 `projectile / muzzle / meleeHit / guardActive / chargeActive / aoeCommit` cue 都存在於合法 frame 範圍。
- [ ] 弓箭、法術、重弩的 projectile spawn 畫面 cue 對齊 shared `commitTick`；命中仍以 shared `impactTick` 為準。
- [ ] 火槍在 commit 播槍焰、煙與短曳光，不能因 tween 飛行時間延後 authoritative hitscan 傷害。
- [ ] 網路／模擬事件慢於視覺時停在 telegraph hold frame；不得先播命中再等待傷害。
- [ ] 網路／模擬事件快於視覺時可縮短 recovery，但不得跳過風箏可讀性所需的 windup。

## 4. BootScene preload 硬門檻

正式 Go 前，`BootScene.preload()` 或等價的專用 preload scene 必須完成以下工作：

- [ ] 先載入版本化 art manifest／asset pack，再依明確 URL 載入七角色 multiatlas、projectile／impact atlas 及 team-color mask。
- [ ] Manifest 必須列出每個 runtime atlas JSON、所有 PNG page、SHA-256、`project-original` 授權與版本；目前只有 frame 契約，沒有可載入檔案 URL，不足以 Go。
- [ ] 對所有 `loaderror`、JSON parse、missing texture／frame、hash mismatch 建立明確錯誤畫面；失敗時不得開始 `VillageSelectScene`，也不得靜默啟用程序角色。
- [ ] 載入完成後逐一 assert 七角色的 252 個 clip group（7 actors × 6 facings × 6 actions）與所需 projectile／FX key。
- [ ] 七角色預期總 authored frame 數為 2,310；validator 必須依每個 manifest clip 的 frame count 檢查，不能只確認動畫 key 存在。
- [ ] Texture 設為 `Phaser.Textures.FilterMode.NEAREST`；瀏覽器縮放、camera zoom 與高 DPI 下都不能被 linear smoothing 汙染。
- [ ] Boot 的 progress／error listener 在 scene shutdown 時清理；重進遊戲不得重複註冊 animation key 或發出 duplicate-key warning。
- [ ] Runtime manifest 在批准成品時改為等價於 `status: approvedAtlas`、`proceduralFallback: false`；只改旗標但沒有實際 atlas 證據視同偽造，仍 No-Go。

## 5. Pixel、alpha、pivot 與 atlas QA

### 5.1 檔案與像素

- [ ] 所有角色頁為 RGBA8888 PNG、sRGB、straight alpha；禁止 JPEG、lossy WebP、內嵌色彩平滑或 mipmap。
- [ ] 角色本體採硬像素邊緣；除獨立陰影／VFX 外，半透明抗鋸齒邊不得混入角色輪廓。
- [ ] 完全透明像素的 RGB 為 `0,0,0`，在淺色、深色與高飽和測試背景上都沒有白邊／黑暈／前一幀殘色。
- [ ] Atlas packing 使用 padding 4 px、border 4 px、extrude 2 px；相鄰幀在極端縮放下不得 bleeding。
- [ ] 每頁 ≤2048×2048，manifest page 尺寸、frame rectangle、sourceSize 與 spriteSourceSize 均在 bounds 內且不重疊。
- [ ] 原生 frame 尺寸與 pivot 符合 manifest；同角色所有 frame 共用固定腳底 anchor。

### 5.2 動畫穩定度

- [ ] `idle` 腳底漂移 ≤1 px；`walk` 不滑步；左右腳接觸 frame 能和位移節拍對上。
- [ ] 攻擊武器尖端在 release/contact 前後漂移 ≤3 px，windup 必須改變整體剪影。
- [ ] `hurt` 不只靠全身白閃；身體、盾牌、武器或翅膀有可讀 recoil。
- [ ] `death` 完成前角色不裁切、不穿地；collision-off cue 後不可再被點選或受擊。
- [ ] 六方向的 handedness、武器側、衣物不對稱與 team-color zone 連續；禁止把三方向水平鏡射冒充六方向。

## 6. 七角色原生縮放可辨識度

測試必須在 1280×720、camera zoom 1、未顯示名稱、未依賴隊色的情況執行。

- [ ] 七角色輸出一張同尺寸 grayscale lineup；三名審核者逐一辨識，最低門檻為 21/21 正確。
- [ ] 即使全部改成相同灰階，以下輪廓仍能分辨：戰士寬斷刃、盾牌手下寬藤盾、弓箭手高弧弓、法師中空環杖、火槍兵全身斜槍、野豬騎士低長雙體、重弩手橫向弩臂與折架。
- [ ] 角色 weapon／role 差異在 100% 遊戲縮放即可辨認，不依靠放大 portrait、文字、色相或發光效果補救。
- [ ] Team color 佔可見像素 8–14%，至少分布在兩個分離區域；敵我可辨，但 team color 不是職業唯一識別線索。
- [ ] 敵我同兵種並排時保持相同角色設計與清楚隊色；不得用完全不同造型造成玩家誤判為另一職業。
- [ ] 大型野豬騎士與重弩不遮住相鄰角色的選取 ring、HP bar 或 Q 技能提示。

## 7. 七角色逐一選取與 Q 技能驗收

每個角色都要從 `CombatShowcaseScene` 的我方實體實際點選，不接受只呼叫內部函式或只看資料表。

| Shared ID | 選取面板必須顯示 | Q 後必須觀察 |
|---|---|---|
| `warrior` | 戰士、碎甲擊 | `cast` windup、近戰命中、碎甲狀態、冷卻開始 |
| `shieldBearer` | 盾牌手、盾牆 | 盾牆姿態／正面 cue、狀態顯示、冷卻開始 |
| `archer` | 弓箭手、釘地箭雨 | `cast`、箭矢 release、落點／slow、冷卻開始 |
| `mage` | 法師、餘燼法印 | 法印 telegraph、aoe commit、burn、冷卻開始 |
| `musketeer` | 火槍兵、定裝瞄擊 | 可讀長 windup、muzzle／trace、穿甲傷害、冷卻開始 |
| `boarRider` | 野豬騎士、獠牙衝陣 | 刨地／衝鋒 pose、位移、stagger、冷卻開始 |
| `heavyCrossbowman` | 重弩手、破城貫矢 | 架弩／絞盤 windup、巨矢、最多兩目標規則的視覺、冷卻開始 |

逐角色共通步驟：

- [ ] 左鍵命中角色可見像素／合理 hit area 後，選取 ring 只出現在該角色，面板 ID、名稱、角色定位、HP 與技能皆對應 shared definition。
- [ ] 在技能 ready 時按 `Q` 一次，只觸發選取角色的一次技能；未選取、死亡、cooldown、無合法目標時有明確回饋且不報錯。
- [ ] 按下 `Q` 後先出現 windup／telegraph，再到 commit／projectile；HUD 冷卻從 shared `cooldownMs` 開始遞減。
- [ ] 冷卻期間連按 `Q` 不重播 cast、不重複扣血、不重複建立 projectile。
- [ ] 技能完成後仍可右鍵移動／攻擊；`R` 後七角色 HP、冷卻、選取與動畫回到乾淨初始狀態。
- [ ] 每一角色保存「選取面板 + cast 關鍵 pose + projectile／impact」至少一組瀏覽器證據；不得只交一張全景圖。

## 8. 瀏覽器零錯誤與視覺證據

第二輪稽核至少執行 Chromium 的 1280×720、1600×900、1920×1080 三種 viewport。

- [ ] 從重整頁面開始記錄 `console.error`、`console.warn`、`pageerror`、unhandled rejection、HTTP 4xx／5xx 與 failed request；專案造成的數量全為 0。
- [ ] Phaser 不得出現 missing texture、missing frame、duplicate animation、WebGL context、tainted canvas 或 asset decode warning。
- [ ] 從村莊選擇進入 Showcase、逐一選七角色並按 Q、擊殺至少一目標、按 R、按 Esc 返回，全流程無錯誤。
- [ ] Screenshot 必須保留原生像素，不經文書軟體縮放／JPEG 重存；證據需標註 build commit、viewport、devicePixelRatio 與 manifest version。
- [ ] 在淺灰、深綠、純黑三種 QA 背景檢查 alpha fringe；至少保留一張 grayscale lineup 和一張六方向 animation gallery。
- [ ] 重開三次後瀏覽器 listener／timer／tween 不成長，離開 Showcase 後沒有殘留 projectile 或輸入反應。

建議第二輪自動化順序：

```text
manifest/PNG validator
→ shared/client typecheck
→ unit tests
→ production build
→ start clean preview server
→ Chromium console/network hooks
→ seven actors: click → assert panel → Q → assert cast/cooldown
→ restart/return cleanup
→ screenshots and audit record
```

## 9. 程序 fallback Go／No-Go 規則

### 立即 No-Go

符合任一項即拒絕成品：

- `BootScene` 沒有成功 preload 七角色 atlas，或任一 atlas／PNG 404、decode、hash 驗證失敗。
- 七兵種任一角色由 `createProceduralCombatActor()`、Phaser Graphics、圓形／三角形或單張旋轉圖呈現。
- 資產缺失時使用 warrior 或其他角色代替，或以 placeholder／fallback 繼續開局。
- 任一角色缺方向、缺 `idle/walk/attack/hurt/death/cast`、缺 release cue、pivot 漂移或只做三方向鏡射。
- 七角色中任一角色無法在場景選取，或 Q 技能沒有專屬 pose／projectile／impact／cooldown 回饋。
- 原生縮放無法靠剪影分辨職業，或隊色成為唯一識別方式。
- 瀏覽器出現任何專案造成的 error／warning、missing frame 或 failed request。
- Manifest 仍為 `proceduralFallback: true`，或雖改旗標卻沒有 atlas、hash、授權及瀏覽器證據。

### Go 條件

只有同時滿足以下條件才可核准「七兵種圖像整合」：

- 七兵種全部由已核准、project-original 的六方向 atlas actor 呈現，程序 renderer 在 production path 不可達。
- Boot preload、key mapping、frame／alpha／pivot validator 全部通過。
- 原生縮放 grayscale 可辨識度、team-color、逐角色選取與七個 Q 技能全部通過。
- 三 viewport Chromium 全流程 0 errors／0 warnings／0 failed requests。
- 主管保留 manifest、PNG hash、測試 log、逐角色截圖、六方向 gallery 與授權證據。

## 10. 第二輪稽核待辦

整合主管完成 production 修改後，獨立稽核需：

1. 重新讀取實際 BootScene、atlas adapter、mapping、manifest 與產出檔，不採信口頭完成聲明。
2. 執行第 8 節的自動化與瀏覽器流程，逐一勾選本文件，不可抽樣七角色。
3. 將結果寫成新的 signed audit，逐項列出證據路徑與 Go／No-Go；本準備文件本身不能當通過證明。
4. 稽核完只清除該輪可重建的 `dist`、暫時 server log、Playwright session／trace；保留 source atlas、runtime atlas、manifest、hash、測試 log、截圖與授權。
