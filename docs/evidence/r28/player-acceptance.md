# 1.3.2 遊戲端驗收

狀態：**PASS（functional）**。驗收對象是 immutable QA build 的遊戲入口 `http://127.0.0.1:5178/village-siege/play.html`。公開專案主頁上的實錄 overview 是第一次接觸專案時的介紹內容，不屬於遊戲 player；本驗收只確認遊戲內沒有播放器或影片功能。

## 初次進入與三視口

1366×600、844×390、390×844 均在 PWA 工具列可見後再等待 1 秒才量測。每個 viewport 都有 16 個可見、啟用的主選單按鈕；最小高度 44 CSS px，所有按鈕中心點均命中按鈕本身，沒有越界或水平 overflow。PWA 工具列保持在 viewport 內。

三個 viewport 都符合以下條件：

- 頁面文字沒有「實玩影片」或 gameplay film。
- `video` 元素為 0，gallery root 為 0，開啟中的 dialog 為 0。
- `/media/gameplay/`、gallery module、MP4／WebM 請求合計為 0。

## 正常遊戲流程

由「開始戰役」正常進入 HUD，再以公開 canvas controls 操作：

- 系統頁只有重新開始、暫停、鏡頭視角、存檔重播、全螢幕、離開戰役、返回。
- 鏡頭視角頁只有縮小、放大、置中基地、音效與返回系統，沒有影片 action。
- 開啟「科技與時代」、切換至「經濟」再關閉後，dialog 關閉、焦點回到科技 trigger，HUD 的 44 px 系統控制恢復可用。
- 原生全螢幕實際進入成功；`#game-root` 維持 1366×600，沒有水平 overflow，退出後 session 正常關閉。
- Console error 與 page error 都是 0。

## 證據

- `player-menu-1366x600.png`
- `player-menu-844x390.png`
- `player-menu-390x844.png`
- `player-battle-system-1366x600.png`
- `player-acceptance.json`

驗收全程只使用公開 UI，沒有讀寫 `privateGameRuntime`、simulation state 或 clock，也沒有修改已完成的 app UI source。

效能三跑已在 root 驗證、地端模型 review 與其他測試全部停止後執行並通過，詳見 `public-performance.md` 與 `public-performance.json`。
