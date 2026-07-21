# TASK-025 本機發布品質稽核（2026-07-21）

## 結論

- Codex：`LOCAL_APPROVE`。
- Grok CLI 唯讀終審與追稽：`P0=0 P1=0 P2=1 LOCAL_APPROVE`。
- Grok session：`019f8478-6603-7852-804a-c5c0358030bc`。
- `REMOTE_GATE_PENDING=yes`：GitHub 的 source、containers 與 production-template jobs 尚未執行，TASK-025 不得在遠端全綠前標記完成。
- 唯一 P2：repo-native secret pattern scan 不做 entropy／二進位掃描，並有刻意的輸出目錄、檔案大小與自掃描排除；此限制不取代 GitHub secret protection 或人工憑證管理。

## 完整本機門閘

- `npm run verify`
  - client：10 files／78 tests。
  - server：11 files／86 tests。
  - shared：12 files／224 tests。
  - 三個 workspace 的 typecheck 與 production build 全數通過。
- `npm run audit:prod`：0 vulnerabilities。
- CycloneDX 1.5：163 components，JSON 驗證通過。
- 真實 Colyseus multiplayer smoke：2 玩家、5 陣營、3 個 server-owned AI、命令所有權、偽造拒絕、delta gap resync 與重複命令 once-only 全部通過。
- 真實 socket recovery smoke：斷線、重連、依序 pending replay、權威 tick 延續與無重複資源支出全部通過。
- adverse smoke：50／100／200 ms receive delay、每 recipient 精確 2% loss、reordering、gap resync、真實重連與最終 recipient hash 一致全部通過。

## 資產、授權、秘密與大小

- `npm run validate:compliance`：PASS。
- 34／34 個原創 PNG 的 SHA-256 與 byte count 符合 release manifest。
- 13 筆機讀 attribution 列完整，授權為 MIT；每個 PNG 恰好匹配一筆。
- Runtime 美術：10 個 action sheets，13,102,459／16,777,216 bytes。
- Stripped client 成品模擬：16 files、15,167,258／20,971,520 bytes。
- 119 個已安裝 production package licenses 位於 allowlist；5 個 platform-optional packages 在目前平台未安裝。
- 202 個文字檔秘密 pattern scan：0 findings。
- Client Docker builder 現在移除 source masters、portraits 與 `action-sheet-source.png`；local 與 production 容器 CI 都會在執行中的 `/app/public` 對 release manifest 逐檔重算 SHA-256，並檢查 10 個 PNG、總量、單檔上限與 non-root runtime。

## 真實瀏覽器證據

Playwright CLI 的 Chromium 驗收：

- 1280×720：選單 → 互動教學 → 鍵盤選取 3 名工匠 → 發出採糧命令成功。
- 844×390：document/body 為 844×390、canvas 為 843×390；7 個固定操作鍵完整可見，無 overflow 或重疊。
- 667×375：document/body 為 667×375、canvas 為 666×375；7 個固定操作鍵完整可見，無 overflow 或重疊。
- Console：0 errors、0 warnings；0 page exceptions。
- Network：未見失敗請求；抽查 unit/monster action sheets 皆為 HTTP 200。

保留三張最小證據：

- `output/playwright/task025-desktop-command.png`
- `output/playwright/task025-mobile844-final.png`
- `output/playwright/task025-mobile667-final.png`

重複的 TASK-025 截圖已移至 Windows 資源回收筒，可復原。行動版結果是實際 Chromium 行動尺寸與 touch-like viewport 驗證，不取代實體手機瀏覽器、旋轉、系統全螢幕與真實觸控終驗。

## Grok 初審修正

合規工作線先找出正式 client 映像會包含約 45.8 MB 原始美術樹的 P1；修正 Dockerfile pruning 與容器內 artifact gate 後，Grok 確認 P1 關閉。Grok 初次 `LOCAL_APPROVE` 留下容器未比對 SHA-256、production-template 未重跑資產閘兩項 P2；補上兩組執行中容器的 manifest SHA-256 驗證後，追稽確認兩項均關閉。
