# R28 遊戲內影片功能清理覆核

## 結果

遊戲 UI 已完整移除 R27 誤加的「實玩影片」功能。影片不再出現在聚落選擇頁或戰役系統選單，遊戲執行期也不再建立播放器、接管輸入或變更暫停狀態。

## 變更範圍

- `VillageSelectScene`：移除 gallery import、欄位、頁首按鈕、開啟 handler 與銷毀流程；頁首恢復原本 `v1.2.0` fallback 結構。
- `VillageAssaultScene`：移除 gallery import、欄位、建立流程、暫停與輸入 hooks、系統頁影片 action 及銷毀流程。
- `frontier-menu.css`：移除影片按鈕與 header actions 專屬樣式，並恢復短視口 intro 版型。
- `game/pwa.css`：橫向短視口工具列恢復 `max-width: 60vw`。
- 刪除 `gameplayFilmGallery.ts`、`gameplayFilmGallery.css`、`gameplayFilmGalleryMetadata.ts` 與專屬 metadata 測試。

## 驗證

- `rg` 檢查 `apps/client/src` 與 `apps/client/test`：找不到 `gameplayFilm`、`filmGallery`、`filmWasPaused`、`data-gameplay-film`、`frontier-film`、`frontier-header-actions` 或「實玩影片」。
- `npm run typecheck --workspace @village-siege/client`：通過。
- `npm run test --workspace @village-siege/client`：31 個測試檔、176 個測試全數通過。
- `git diff --check`：通過（僅 Git 提示工作目錄行尾將於下次寫入轉為 LF，無 whitespace error）。

此工作未修改版本、manifest、媒體、PWA build、README、Docker、部署設定或 shared 規則。
