# PWA 安裝與離線遊戲

這次實作提供電腦、手機與平板的網頁安裝入口、PNG 圖示、完整版本的離線下載，以及不打斷戰局的更新流程。尚未製作 App Store／Google Play 安裝包，也未加入 Capacitor。

## 已完成範圍

- `manifest.webmanifest` 使用相對的 `id`、`scope`、`start_url` 與 PNG 圖示，適用於 `/` 與 GitHub Pages 的 `/village-siege/`。
- `installPwa.ts` 只在正式建置及安全來源啟用 Service Worker。Vite 開發模式不會新增註冊。HTTPS 與瀏覽器認定的本機安全來源可用。
- 支援安裝提示的瀏覽器在主選單提供「安裝遊戲」。iPhone／iPad 提供 Safari「加入主畫面」操作說明。瀏覽器是否顯示安裝提示由瀏覽器決定。
- 圖示與介面不使用 SVG。主要圖示為 192／512 像素 PNG，另有 512 像素的 maskable 圖示。
- 每次正式建置，Vite 的 `village-siege-pwa` 外掛會依實際輸出檔案產生離線清單。HTML、JavaScript、CSS、manifest、圖示、地圖與正式戰鬥素材都在同一版本。
- 版本識別包含部署 base、檔名、檔案內容及 Service Worker 程式碼；只更新美術素材也會產生新版本。
- 離線清單同時固定每個檔案的 SHA-256 integrity。若部署在下載途中切換、或伺服器傳回另一版素材，瀏覽器會拒絕不符的下載；完整新版本不成立時保留原本可玩的快取。
- `assets/original/` 的 PNG 依 release asset manifest 的 `runtime: true` 白名單收錄，避開 CI 後續移除的製作來源檔。新素材必須登錄為正式素材，或放在其他公開素材目錄。

## 首次下載與離線範圍

首次開啟需要網路。遊戲載入後，Service Worker 會在背景下載完整離線版本，並在主選單顯示「正在下載離線遊戲…」。戰鬥圖集目前占大部分下載量；這不是只有幾 KB 的啟動畫面快取。

只有完整清單寫入成功並查核所有項目後，才顯示「離線遊戲已備妥」。下載中斷或儲存空間不足時，遊戲仍可連線遊玩，狀態顯示「離線下載尚未完成」。完成後再次開啟或重新整理遊戲，即可在離線狀態載入單人模式。瀏覽器可能清除網站資料；資料遭清除後需要重新下載。

離線功能包含單人戰役所需的程式與美術素材，並沿用現有本機存檔。多人對戰需要網路與可用伺服器，不會被包裝成離線對戰。

## 快取與版本安全

- 只快取建置時列出的同來源、同 base 靜態檔案。API、房間、health、未列出的資源、外部來源、帶查詢參數的素材及非 GET 請求不進入快取。
- `runtime-config.js` 每次直接以 `no-store` 取得，不寫入離線版本。斷線時回傳明確關閉 multiplayer 的空白設定，避免沿用過期部署端點。
- 導覽採用目前 Service Worker 已備妥的 HTML，讓 HTML 與 JS／CSS／美術保持同版，不會把新 HTML 配上舊程式。
- 新版本下載完成後會等待。程式不呼叫 `skipWaiting()`、`clients.claim()`，也不自動重新整理，因此正在進行的戰局不會被更新打斷。
- 主選單會顯示「新版已備妥，關閉所有遊戲分頁後再開啟」。使用者須關閉同一遊戲的所有分頁及已安裝視窗；再開啟時由瀏覽器啟用新版本。沒有「立即更新」按鈕，避免其他分頁仍在交戰。
- 新版本自然啟用後只清除同一來源及同一 base 的舊遊戲快取，不影響其他網站應用。
- 正式靜態伺服器對 `sw.js`、manifest 與 HTML 回傳 `no-cache`，manifest 使用 `application/manifest+json`。

## 驗證方式

```powershell
npm run typecheck --workspace @village-siege/client
node --test deploy/test/pwa.test.mjs
npm run build --workspace @village-siege/client -- --base=/village-siege/
npm run prune:runtime-art
```

建置後應確認 `apps/client/dist/sw.js` 的清單每一項都有實體檔案，沒有 `runtime-config.js`、製作來源圖或未替換的 marker。瀏覽器驗收使用正式建置的 preview，不使用開發伺服器。

1. 清除測試來源的網站資料，以 `/village-siege/` 開啟並等待「離線遊戲已備妥」。
2. 重新開啟，使頁面受 Service Worker 控制；切離線後重新整理，進入單人戰局。
3. 驗證正式素材完整載入，API 與多人連線仍需網路。
4. 維持一場戰局並準備新版建置，確認更新只進入 waiting，戰局不重新整理。
5. 關閉所有遊戲分頁後再開啟，確認新版本啟用及舊快取清除。

App 商店階段另需實機效能、觸控與安全區測試、音訊中斷處理、生命週期與背景恢復，以及簽章、商店圖示與上架資訊；這些尚未完成驗收。

參考：[MDN Service Worker 生命週期](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers)、[MDN 安裝 PWA](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Installing)、[MDN Web App Manifest](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest)。
