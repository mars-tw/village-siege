# 實玩影片播放器實作

`createGameplayFilmGallery(host, hooks?)` 會把原生 `dialog` 掛到指定容器，回傳 `open()`、`close()`、`destroy()` 與 `isOpen`。戰場或選單接線時可透過 `opened`／`closed` 暫停及恢復 Scene；本模組不改動既有 Scene、選單或戰局規則。

建立 control 時不會填入 poster 或 video `src`。第一次 `open()` 才載入第一章封面與文字；玩家按「播放影片」後才設定 MP4 `src`，再由同一次手勢呼叫 `load()`／`play()`。關閉或切章節會暫停影片、移除 `src` 並呼叫 `load()` 釋放下載，重新開啟不會自動播放。載入失敗時可重試或關閉，Escape 也會關閉並把焦點還給原控制項。

三章影片固定使用 `media/gameplay/economy.mp4`、`movement.mp4`、`battle.mp4`，封面為同名 `.webp`。播放器保留原生 controls、`playsInline`、16:9 與 `object-fit: contain`，桌機、直式手機及低高度橫式畫面都保留可見的 44px 關閉與章節按鈕。

驗證：`npm run typecheck --workspace @village-siege/client` 通過；`npx vitest run apps/client/test/gameplayFilmGalleryMetadata.test.ts --no-file-parallelism` 通過 2 項測試，涵蓋三章名稱、部署 base path、影片與封面路徑，以及實玩／正常進度說明。完整 client test 曾執行 178 項，當時有 175 項通過；3 項既有 `pwaBuild.test.ts` 因測試 fixture 缺少 `assets/gameplay-media-manifest.json` 失敗，與本播放器模組無關。

初始實作先完成 UI 與按需載入契約；媒體到位後的瀏覽器驗收記錄如下。影片內容品質另由指定的地端模型裁決。

## 瀏覽器驗收

2026-10-02 使用 Chromium 對 1.3.0 production preview（`/village-siege/` base）進行正常操作。冷啟動只要求遊戲程式、介面圖片與圖示，沒有要求 `media/gameplay` 的 MP4、WebP 或影片 metadata；開啟播放器後才要求所選章節封面，按「播放影片」後才要求 MP4。

三支影片都由瀏覽器實際解碼為 960×540、24 秒，`currentTime` 持續前進；原生影片 API 可播放、暫停並 seek 到 12 秒。切換章節會暫停上一支影片並清除 `src`，不會自動播放下一支；Escape 關閉後 `src`、poster 都已移除，焦點回到「實玩影片」入口。播放器自有的關閉、章節與播放按鈕皆至少 44 CSS px；原生 controls 的尺寸由瀏覽器管理。

1366×600、1024×768、844×390、667×375、390×844 均無水平溢出，關閉按鈕完整可見，影片保持 16:9 且使用 `object-fit: contain`。戰場從「系統 → 鏡頭視角 → 實玩影片」開啟並關閉後，仍回到相同系統頁，原本的「暫停」狀態恢復。離線時播放會顯示「影片需要連線觀看；離線單人戰役仍可遊玩。」；關閉後戰場仍可操作。離線下載 cache 共 54 個公開 runtime URL，包含 `play.html`，不包含任何 `/media/gameplay/` URL。

公開截圖：`gallery-desktop-1366x600.png`、`gallery-landscape-844x390.png`、`gallery-portrait-390x844.png`。原始 trace 與 network log 保留在 `.audit-tmp/r27/gallery-ui.trace`、`.audit-tmp/r27/gallery-ui.network`。

本次 QA snapshot 的第三段仍是重錄前版本；只驗證播放器接線、解碼與操作。最終「林緣遭遇戰」內容需在正式產物換入後另做內容品質審查及一次快速解碼檢查。
