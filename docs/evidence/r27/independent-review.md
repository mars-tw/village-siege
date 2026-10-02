# R27 獨立接線覆核

日期：2026-10-02  
範圍：主選單／戰役內實玩影片入口、播放器生命週期、optional media、PWA、靜態伺服器。此份覆核只檢查程式接線；實際影片內容與真機互動另由 production-ready 驗收負責。

## 結論

**PASS（source review）**。未發現會阻擋發布的接線問題。

- 主選單建立播放器時不設定影片 `src`；只有使用者按「播放影片」後才設定當前章節的 MP4 URL。`preload="none"`、`autoplay=false`，首次進場不會下載完整影片。
- 開啟播放器只解析並顯示目前章節的 poster；切換章節會先 `pause()`、移除 `src`、呼叫 `load()`，不保留上一段影片下載與播放狀態。
- `playGeneration` 同時保護播放 Promise、切片、關閉及錯誤回呼。舊 Promise 完成後不能隱藏新章節播放按鈕，也不能在已關閉 dialog 上顯示錯誤。
- 關閉按鈕、錯誤畫面的關閉按鈕、原生 dialog `cancel` 均走同一個 `close()`；關閉會釋放影片來源、移除 poster、恢復先前焦點並呼叫場景 hook。`destroy()` 也會釋放來源並移除 dialog。
- 戰役內開啟時會保存原本暫停狀態、停用 Phaser input 並清除 pointer gesture；單機才暫停模擬。線上戰局不改 `paused`，因此權威模擬可持續；關閉後還原開啟前狀態。
- dialog 是 top-layer modal。其 `keydown`、pointer 與 wheel 事件停止向上傳播，可避免 portrait 旋轉遮罩或 Phaser 的 P／B／Esc 等操作收到播放器內輸入；portrait 與低高度 landscape 均有獨立版面規則，按鈕維持至少 44 CSS px。
- PWA 只以 gameplay media manifest 的精確 `apps/client/public/` 相對路徑排除七個 optional media。影片、poster、metadata 仍存在 dist，但不列入 precache／integrity，因此首次安裝及「下載離線版」不會抓取它們，其他 runtime 檔仍照常固定 hash。
- 靜態伺服器僅在實際解析後檔案副檔名為 `.mp4` 時處理 Range；路徑仍先經 `decodeURIComponent` 與 root containment 檢查。MP4 回傳 `video/mp4`、`Accept-Ranges: bytes`；合法單段 range 回 206，無效或超界 range 回 416，未放寬 CSP 或既有 cache policy。

## 驗證證據

- `npm test --workspace @village-siege/client -- --run test/pwaBuild.test.ts`：32 test files、178 tests 全數通過。
- `npm run test:ops`：22 tests 全數通過，包含 MP4 MIME／完整回應／206 range／416 range。
- `npm run typecheck --workspace @village-siege/client`：通過。
- PWA fixture 明確建立七個 optional media，逐一確認檔案仍在 dist 且不在 precache。

## 待 production-ready 驗收

- 實際 MP4／WebP／metadata 落地後，仍須跑 `validate-gameplay-media.mjs` 的 ffprobe 解碼、H.264／無音訊、尺寸、fps、時長、bytes 與 SHA-256 對帳。
- 以指定 1366×600、1024×768、844×390、667×375 實際操作播放、拖曳、切片、關閉與回復焦點；此項屬瀏覽器／真實媒體驗收，未以 source review 冒稱完成。
