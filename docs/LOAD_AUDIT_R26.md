# R26 首次載入稽核

稽核基準為 App 1.1.1、commit `8b6664bb9607ffc819358c4dbc744ad72863aa23`。R25 公網紀錄 `.audit-tmp/r25/public-1.1.1-final-smoke.json` 的 `battleReadyMs = 88212` 是一次特定 GitHub Pages／Chromium mobile emulation 冷載樣本；該次沒有固定傳輸條件。檔案頂層狀態是 `VERIFIED_WITH_NETWORK_DELAY`、功能狀態是 `VERIFIED`、冷載狀態是 `SLOW_OBSERVED_NOT_PASS`；其中 `originalFlow.status` 因後續 120 秒等待逾時而是 `FAILED`。因此 88.2 秒只證明曾觀察到慢載，不能拿來宣稱 R26 在受控網路下快了多少。

## 啟動邊界

`BootScene.preload()` 不下載美術，但 `createGame.ts` 靜態 import 所有 scenes，Vite 1.1.1 production bundle 因此仍是一個約 2,088,151 bytes 的主 JS。選單在 `VillageSelectScene.create()` 設定 CSS 背景；基準版會立即要求 `cover.webp`（455,970 bytes）與 `buildings.png`（2,085,918 bytes）。後者同時被當成選單三張聚落縮圖 atlas，單檔就佔已辨識選單圖片 bytes 的 82.1%，也是 R25 公網 `resourceTimings` 中最重的實際拖累：下載 2,085,918 encoded bytes、歷時 57,955.7 ms。

按「開始戰役」後，`VillageAssaultScene.preload()` 在 `createBattle()` 前同步等待以下素材完成。這是基準版的 battle-blocking 集合：

| 類別 | 檔案／數量 | bytes |
| --- | --- | ---: |
| 地景材質 | `landscape/materials.png` | 684,618 |
| 地景物件 | `landscape/nature.png` | 578,547 |
| 建築 atlas | `buildings.png` | 2,085,918 |
| 指令 icons | `command-icons.png` | 200,864 |
| 工匠六方向 | 6 PNG | 254,405 |
| 戰士六方向 | 6 PNG | 260,256 |
| 三隻怪物完整 action sheets | 3 PNG | 1,051,833 |
| 合計 | 19 個請求（若建築未由選單 cache 命中） | 5,116,441 |

若選單已成功下載 `buildings.png`，戰場仍需新增 3,030,523 bytes；若選單背景尚未完成或 cache 未命中，戰場準備會被同一個 2.09 MB atlas 繼續拖住。R25 公網 resource timing 也顯示，開始戰役後 `command-icons.png` 下載約 30.9 秒，六張工匠方向圖各約 31.5–35.4 秒；這些小檔在該次網路下並行排隊，表示請求數量也會拉長尾端。

三隻怪物在基準 loader 中無條件進入首次戰場 preload：`miremaw` 436,651 bytes、`ashwing` 319,530 bytes、`rootback` 295,652 bytes，共 1,051,833 bytes。它們不是選單資產，而且只有怪物首次進入可見／需要建立 actor 時才是必要素材，因此是可與核心戰場分離的最大一組。其餘可先維持核心的素材是當前畫面立刻需要的地景、建築、指令 icons、工匠與初始戰士；後續兵種本來已由 runtime 按出現需求載入。

## R26 工作樹觀察（尚非 after 結果）

稽核時工作樹已有其他 lane 的未提交修改：選單改指向 `buildings-menu.webp`（100,140 bytes），戰場建築改指向 `buildings.webp`（1,263,750 bytes），地景改為 `materials.webp`（653,090 bytes）與 `nature.webp`（508,776 bytes）。這些是來源與檔案大小證據，不代表瀏覽器量測已通過。與基準檔相比，四項候選編碼合計由 3,805,053 bytes 降至 2,525,756 bytes；其中選單 atlas 單獨少 1,985,778 bytes。原始 PNG 仍留存。

怪物 lazy loading 由另一 lane 實作與驗證，本文件不修改 loader。驗收時應確認怪物圖在按開始至戰場可操作的 blocking window 中沒有請求，並在怪物真正需要顯示時成功下載；不能只看總包大小推定 lazy 行為。

## 可比較的量測契約

量測 source 位於 `.audit-tmp/r26/r26-load-benchmark.cjs`。它要求新 Chromium context、起始頁 `about:blank`、空 browser cache，透過 Playwright `context.newCDPSession(page)` 呼叫官方 `Network.emulateNetworkConditions`：固定 400 KiB/s 上下載、60 ms round-trip latency。這是人造傳輸條件，不是手機或電信網路實測。

每個 before／after 樣本必須使用新的 CLI session，對同一台機器、同一個 production preview server、同一個 URL 形態各跑一次；正式三跑要等 root 宣告其他體驗與測試停止後才做。輸出 JSON 至 `.audit-tmp/r26/`，截圖與可公開摘要放 `docs/evidence/r26/`。不得沿用 service worker cache、用 route mock、操作 app 私有 global、改 DOM、放寬等待時間，或把 native browser／OS 畫面稱為 client 內控制。

JSON 固定保留：

- `navigationToMenuReadyMs`：navigation 到 `village-siege-ready`。
- `startClickToBattleReadyMs`：真實點擊「開始戰役」到畫面出現超過兩個既有 canvas controls。
- `menu`、`battleBlockingWindow`、`allToBattleReady` 的 requests／transfer bytes／encoded body bytes。
- 完整 `resourceTimings`、CDP `networkResponses`、最慢 20 項資源、page errors 與 request failures。

`battleBlockingWindow` 的「core bytes」是操作性定義：在 start click 後發起、battle-ready 前完成的所有 PerformanceResourceTiming 項目。它不是設計文件推測的核心清單；after 若有背景 prefetch 混入，必須在報告中另外標示，不能把它當成必要 bytes。

## 同條件 before／after 單次樣本

Root 以 static server 提供真實 GitHub Pages 1.1.1 artifact（run `36863152368`）於 `http://127.0.0.1:5175/village-siege/play.html`，並以相同 base 形態提供當時的 production 1.2.0 於 `http://127.0.0.1:5176/village-siege/play.html`。兩次各用全新 named Chromium session、清空 browser cache，套用相同 400 KiB/s 上下載與 60 ms round-trip latency。這裡只有各一跑，不是三跑 median，也不是實機網路。After 量測完成後 5176 又有 production rebuild；以下數字不能歸到最後鎖定的 asset hash，正式效能結論仍須在 final artifact 與其他測試停止後重跑。

| 指標 | 1.1.1 before | 1.2.0 after | 差異 |
| --- | ---: | ---: | ---: |
| navigation → menu ready | 5,569.9 ms | 5,642.8 ms | +72.9 ms（+1.3%） |
| Start click → battle ready | 13,095.3 ms | 7,656.2 ms | -5,439.1 ms（-41.5%） |
| menu encoded body | 4,699,959 B／8 requests | 2,735,756 B／11 requests | -1,964,203 B（-41.8%） |
| battle blocking encoded body | 5,116,441 B／19 requests | 2,880,885 B／10 requests | -2,235,556 B（-43.7%） |
| all-to-battle-ready encoded body | 9,816,400 B／27 requests | 5,616,641 B／21 requests | -4,199,759 B（-42.8%） |

選單下載量明顯下降，但此單次樣本的 menu-ready wall time 持平；不能只用 bytes 推論選單時間已改善。戰場首次可操作時間與 blocking bytes 則在相同人造傳輸條件下同時下降。公開摘要為 `docs/evidence/r26/load-before-summary.json` 與 `load-after-summary.json`，完整 resource timings 保留於 `.audit-tmp/r26/load-before.json`、`load-after.json`。

### Final locked build 單次 cold sample

最終凍結 production build 的主程式為 `assets/index-BH8sAHob.js`、樣式為 `assets/index-k2OXU4DG.css`。在所有其他 CLI contexts 與測試停止後，以同一組 400 KiB/s、60 ms、fresh context／empty cache 條件再跑一次：menu ready 5,649.1 ms，Start click 至 battle ready 7,614.5 ms；menu 為 11 requests／2,736,451 encoded bytes，battle blocking 為 10 requests／2,880,885 encoded bytes，all-to-battle-ready 為 21 requests／5,617,336 encoded bytes。相較 1.1.1 before，battle-ready 少 5,480.8 ms（41.9%），battle blocking encoded bytes 少 2,235,556 bytes（43.7%）。這仍是單次人造網路樣本，不是三跑 median。
