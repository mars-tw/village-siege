# 2026-10-01 啟動畫面與修復驗證

新增初始 HTML 狀態畫面，在 main module 尚未下載或執行前就顯示文字。正常聚落選單建立後，`village-siege-ready` 隱藏狀態畫面；15秒只提示「遊戲仍在載入」，真正的程式下載／啟動例外才顯示失敗與手動恢復控制。

## 改動

- `apps/client/index.html`：初始狀態 DOM、外部 `startup.js`／`startup.css`、JavaScript 未啟用提示。沒有 inline JavaScript 或 SVG。
- `apps/client/public/startup.js`：ready／error／unhandledrejection、15秒仍載入、重新載入、使用者點擊後才修復。
- `apps/client/public/startup.css`：初始畫面與48px控制，hidden狀態不遮擋正常遊戲。
- `apps/client/test/startup.test.ts`：啟動與資料邊界的6個VM測試。

修復僅解除與deployment base完全相同origin／path的Service Worker註冊，僅刪除`village-siege:${encodeURIComponent(baseScopeURL)}:`名稱前綴的Cache Storage。其他遊戲／origin的註冊與cache、localStorage、IndexedDB不被清除。成功後只前往同origin、由可信deployment base推導的`play.html`。修復失敗或逾時會顯示訊息，不偷偷跳頁；普通重新載入也不刪資料。

## 實跑結果

`npm run test --workspace @village-siege/client -- startup.test.ts`實際執行整個client test目錄：17個檔案、109個測試通過，含本輪6個案例。

| 案例 | 結果 |
|---|---|
| 15秒尚未ready | 顯示仍載入，不冒稱失敗；稍後ready仍可隱藏 |
| module script載入失敗 | 保留失敗訊息及兩個手動控制 |
| 普通retry | 只reload，不移除cache或使用者儲存 |
| repair的scope／prefix | 僅本遊戲被處理，其他遊戲與foreign origin不變 |
| cross-origin data-base | repair停用，無清除或導航 |
| repair API被拒 | 顯示原始瀏覽器訊息，不導航、不刪存檔 |

獨立Chrome session在`1093×480` CSS視口完成以下browser smoke。使用專案`index.html`的相同內容，將BASE_URL解析為`/`，由route直接回應HTML，避免其他lane改檔時Vite HMR重載把15秒計時重置；這是明確故障注入，不是宣稱重現使用者本次根因。

1. 中止main module請求：畫面顯示「遊戲沒有完成啟動」，瀏覽器下載失敗訊息與兩個`225×48`px可用按鈕。
2. 移除中止規則，按「重新載入」：聚落選單正常出現，startup畫面隱藏。
3. 暫停main module請求超過15秒：顯示「遊戲仍在載入」，detail保持隱藏，兩個恢復控制可見。
4. 釋放請求：聚落選單正常出現，late-ready能清掉startup畫面。

原始結果：[startup-browser-2026-10-01.json](startup-browser-2026-10-01.json)。畫面保存在`output/playwright/startup-module-failure-2026-10-01.png`與`startup-still-loading-2026-10-01.png`。

另對原公開v0.21冷Chrome session檢查：開始鈕沒有disabled、中心命中為按鈕，指南關閉控制在視口內；開始後曾只剩空main、沒有Canvas控制或載入文字。warrior PNG請求耗時約4.14～10.34秒，稍後才出現7個戰場控制且console沒有error。這證明原載入過程存在看似無回應的空窗；不能單憑此排除使用者裝置的WebGL或舊cache問題。`1093×480`是125%等效CSS視口檢查，沒有冒稱真實OS／瀏覽器縮放測試。

繁中文案整理：

| 原本狀態 | 原因 | 改成什麼 |
|---|---|---|
| main下載前沒有可見文字 | 使用者無法分辨等待或當掉 | 正在載入遊戲程式，第一次開啟可能需要稍候。 |
| 啟動例外只有console | 無法在頁面恢復 | 遊戲沒有完成啟動，附瀏覽器訊息、重新載入與修復。 |
| 載入時間長時沒有狀態 | 逾時不能直接判定失敗 | 遊戲仍在載入，可繼續等候或重新載入。 |

本lane未commit、推送或發布；正式build、PWA subpath、play.html及公開網址驗證由主線整合。
