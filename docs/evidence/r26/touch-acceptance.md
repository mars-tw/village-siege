# R26 production UI 獨立驗收

- 結論：**PASS**
- 驗收時間：2026-10-02（Asia/Taipei）
- 入口：`http://127.0.0.1:5176/village-siege/play.html`
- 畫面版本：`邊境篇 v1.2.0`
- 受測 development-production build：`/assets/index-BoB_fdYW.js`（僅標示本次受測 artifact，不代表最終 hash；本報告 CSS 分頁與截圖證據皆對應此 build）
- 方法：Playwright CLI 命名 session `r26-touch-acceptance`；只操作一般 UI，並讀取公開 DOM、`navigator.maxTouchPoints` 與截圖。未使用私有 runtime、內部 clock 或遊戲指令。
- 裝置聲明：1024×768 與 844×390 使用 Chromium generic mobile touch emulation（`navigator.maxTouchPoints = 1`），不是實機；1366×600 使用桌面 Chromium。

## 驗收結果

| 項目 | 結果 | 證據 |
|---|---|---|
| 1366×600 RWD | PASS | HUD 與目標 modal 均在 viewport 內；可見操作按鈕最小 44 CSS px。見 `1366x600-objectives.png`。 |
| 1024×768 touch RWD | PASS | 目標 modal 4 個可見按鈕皆 ≥44 CSS px，無越界、無 panel 內互相重疊。見 `1024x768-touch-objectives.png`。 |
| 844×390 touch RWD | PASS | 目標 modal 以每頁 2 張卡片分成 5 頁；按鈕尺寸：關閉 44×44、建造兵營 370×44、上一頁 56×44、下一頁 56×44；無越界、無 panel 內互相重疊。見 `844x390-touch-objectives.png`。 |
| 戰場目標 trigger / 分頁 / 關閉 | PASS | 一般 HUD 的「戰場目標」可開啟。1366×600 逐頁到 4/4，頁 2、3、4 均實際關閉並重開；844×390 顯示 1/5，關閉鍵保持可達。 |
| 目標 action → 合法建造 placement | PASS | 「建造兵營」關閉 modal 並進入一般 placement；公開 status 顯示「已選工匠，點空地建造邊軍兵營」。在可建草地正常點擊後顯示「開始建造 邊軍兵營」。 |
| 科技 modal 生命週期 | PASS | 由一般 HUD「科技與時代」開啟，切至「經濟」分類，再以「關閉科技與時代」關閉。844×390 再驗時 modal 13 個可見按鈕全部 ≥44 CSS px、無越界、無互相重疊。 |
| 關閉科技後 simulation 繼續 | PASS | 關閉後相隔 2 秒的兩張 viewport 截圖 SHA-256 不同（`9A4415F7…` / `6B7C3E73…`），且 HUD 回到「暫停」，表示 modal 自動暫停已解除、場景持續更新。 |
| 目標 → 科技 | N/A（條件未出現） | 初始發展卡只提供「建造兵營」；未出現直接前往科技 action，因此依「若可達」條件不額外聲稱通過。科技仍可由正常 HUD 入口到達。 |
| 兵營中途改派再續建 regression | PASS | 正常放置兵營後，以「採糧」中途改派所選工匠；重新點原工地後公開 status 顯示「繼續施工 邊軍兵營」。稍後一般科技 modal 前置建築顯示「✓ 邊軍兵營」，證明原址完成，沒有重付或另起工地。 |
| Console error | PASS | Playwright `console error` 回報 0 errors。 |

## 代表截圖

- `docs/evidence/r26/touch-acceptance/1366x600-objectives.png`
- `docs/evidence/r26/touch-acceptance/1024x768-touch-objectives.png`
- `docs/evidence/r26/touch-acceptance/844x390-touch-objectives.png`

## 本機完整證據

完整 trace 與過程截圖保留於 `.audit-tmp/r26/touch-acceptance/`：

- `desktop.trace` / `desktop.network`
- `touch.trace` / `touch.network`
- `resume.trace`
- `844x390-build-preview.png`
- `844x390-resumed-barracks.png`
- `sim-after-tech-a.png` / `sim-after-tech-b.png`

未執行冷載 benchmark、影片或全局勝利流程；依本驗收範圍留給其他 lane。
