# R27 實玩錄影報告

錄影日：2026-10-02（Asia/Taipei）  
公網來源：`https://mars-tw.github.io/village-siege/play.html?v=1.2.0`  
遊戲顯示版本：`1.2.0`

## 錄製方式與來源

三段素材均以 `@playwright/cli` 的 headed Chromium 正常 UI 操作與 `video-start`／`video-stop` 實錄，session 為 `r27-record-a`、`r27-record-b`、`r27-record-c`、`r27-record-d`。未呼叫私有 runtime API、未改資源、未改時鐘、未停用 AI，也未使用合成遊戲畫面。

`economy` 的採集與施工段都從全新戰局開始：先正常全選三名工匠並以右鍵派往林木；另一次全新戰局中正常選取三名工匠，依序操作「建造 → 邊軍兵營 → 點地圖放置」，消耗合法既有木材與石材後開始施工。施工原始錄影保留於 `.audit-tmp/r27/raw/economy-construction.webm`。`movement` 與 `battle` 透過遊戲內「系統 → 存檔重播 → 匯入存檔」正常 UI 匯入本線既有自有戰局 `.audit-tmp/r25/visual-final-owner-save.vssave`；畫面狀態列顯示「存檔已匯入」。這個存檔只用於接續實際遊玩進度。

## 片段內容

- `economy.mp4`：前五秒顯示工匠收到採集林木命令後移動；後十九秒顯示打開建造列、選擇邊軍兵營、地圖放置、地基出現及三名工匠施工。完整保留資源列、小地圖與命令列。
- `movement.mp4`：由原始錄影第 18 秒起取 24 秒，短暫展示城寨期軍備科技內容，接著全選兩名邊境戰士、下達移動命令，並持續呈現部隊沿右上方道路移動。
- `battle.mp4`：匯入同一份自有存檔後，以正常拖曳鏡頭將林緣野獸與兩名邊境戰士置於中央，再直接對可見野獸下達攻擊移動。畫面可辨敵方生命條、遇敵警報與近身接觸；野獸其後退場，HUD 顯示戰利品結果。原始錄影保留於 `.audit-tmp/r27/raw/battle-direct.webm`。

## 編碼與可重現性

執行 `docs/evidence/r27/encode-gameplay.ps1` 可從本機 `.audit-tmp/r27/raw/*.webm` 重建交付檔。四個 raw（含獨立施工錄影）均為 800×600，其中上方 800×450 為完整遊戲 viewport、下方 150 px 為錄影器灰色 padding；編碼時固定裁除 padding，再等比例放大為 960×540，不拉伸也不裁掉 HUD。三段交付均為 24 秒、960×540、24 fps、H.264 High、`yuv420p`、MP4 faststart、無音訊；每檔小於 2 MiB。原始錄影仍保留在 `.audit-tmp/r27/raw`，不納入發布。

## 確定性驗證

`ffprobe` 確認三段均為 H.264／960×540／24 fps／`yuv420p`／24.000 秒且無音訊。`ffmpeg -v error -i <file> -f null -` 三段完整解碼皆成功。`blackdetect=d=0.5:pix_th=0.10` 未回報黑畫面。

重編後再次執行 `freezedetect=n=-55dB:d=2`；逐格縮圖確認下列短暫區間是科技視窗停留、命令間隔或等待單位行走，並非損壞影格：

- `economy`：無超過兩秒的凍結區間。
- `movement`：3.208–6.375、10.583–12.708、20.667–22.958 秒。
- `battle`：12.125–14.125、17.458–20.500 秒；這些區段包含近身站位、警報停留與敵方退場後的結果畫面，前後影格仍清楚呈現生命條及狀態變化。

`movement` 的原先 0.5–24.5 秒切點確實偏重科技視窗；本次改取 raw 第 18–42 秒。最終循序縮圖可見科技頁、關閉視窗、選取兩名戰士、命令狀態與部隊連續向右移動，已不再以靜止科技頁冒稱移動展示。

影片與封面的位元組數及 SHA-256 收錄於 `media-summary.json`；產品讀取用資料在 `apps/client/public/media/gameplay/metadata.json`。

## 地端模型終審

錄影後先實查 `http://127.0.0.1:11440/health`，回應 `status: ok`、dispatcher `1.0.1`、`gpu_exclusive_active: false`、可用實體記憶體 37.95 GiB；`/v1/capabilities` 也列出 `vision → qwen38_27b_deep`。

依核心規則送出 `economy` 每四秒循序九宮格進行地端影片內容終審，task id `b92bab06-96ec-4af0-87bf-6834874ba493`。任務實際失敗：

```text
RuntimeError: all workers failed: qwen38_27b_deep: RuntimeError: HTTP 503: <urlopen error [WinError 10061] 無法連線，因為目標電腦拒絕連線。>
```

首次內容終審曾為 `BLOCKED`。之後恢復本機 LM Studio API、載入 Qwen3.8-27B，task `644c4e1a-8b2b-499b-9c6c-dba5f59dd949` 實際完成：採集、科技／移動為 PASS，遭遇戰因遮擋為 NEEDS_REVIEW。重新以正常 UI 把交戰移到中央錄製後，task `77cbe76d-c218-41b2-ab88-0b2de89baacd` 依十二張密集循序採樣完成，對新遭遇戰判 PASS。

目前三段地端抽樣內容裁決皆為 PASS；不是雲端替代或人工冒名。範圍是影片採樣畫面與完整解碼／黑畫面檢查，不宣稱模型逐幀看完影片或完成真人娛樂評測。實際模型回覆與最終片段 SHA-256 見 `local-content-review.json`。
