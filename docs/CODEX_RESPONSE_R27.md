# R27：實玩影片放進遊戲並開源

2026-10-02。App 1.3.0；rules 0.20.0、network 4、persistence 1 不變。基準 App 1.2.0／ee623082。

## 交付內容

以真實瀏覽器操作錄製三段各 24 秒的體驗影片：採集與建造、科技與部隊移動、林緣遭遇戰。採集及施工由兩段正常新局剪輯；軍隊段使用本線自己實際遊玩、經正常介面驗證匯入的存檔。沒有改資源、改時鐘、停 AI 或生成假遊戲畫面。[錄影過程](evidence/r27/recording-report.md)

影片為 H.264／960×540／24fps／`yuv420p`／faststart／無音訊。原始錄影器的有效畫面為 800×450，裁掉灰色填充後等比例放大，保留 HUD，不宣稱原生 HD。MP4、WebP 封面及 metadata 都公開於 `apps/client/public/media/gameplay`，來源與授權為 MIT。[授權](../assets/GAMEPLAY_RECORDINGS.md)、[媒體 manifest](../assets/gameplay-media-manifest.json)

## 遊戲內體驗

主選單右上角新增「實玩影片」，戰場入口位於「系統 → 鏡頭視角 → 實玩影片」。可切章、播放、暫停與拖曳進度；關閉停止載入並恢復焦點。單人戰局觀看時暫停，關閉後還原原狀；線上戰局維持伺服器時間。

冷啟動不要求影片、封面或 metadata；開播放器才下載封面，明確按播放才要求 MP4。切片、關閉與銷毀會解除舊來源，過期播放 Promise 不會把錯誤視窗或焦點帶回已關閉的 dialog。影片不進 PWA 的 54 檔必要快取，離線單人戰役維持可玩，影片沒有連線時顯示清楚提示。

伺服器新增 `video/mp4` 及 byte-range 206／416，維持原 MIME、路徑與 CSP 邊界。素材來源、metadata 與 runtime 產包逐檔核對大小、SHA-256、codec／尺寸／fps／時長及 MIT 授權；每檔 2 MiB、整包 20 MiB 上限沒有放寬。

## 實證與審查

- 全體 verify 通過：client 178、server 86、shared 262、ops 22，共 548 項；最後改片名後再跑播放器／PWA focused 5 項、typecheck 與正式建置。共享規則與存檔未修改。
- 正式 Pages 包 63 檔、13,173,420 bytes，包含七個按需媒體檔；來源原創 raster 91／91 hashes、37 runtime raster、七媒體 hashes／metadata 與產包一致。授權、秘密掃描與 production audit 通過。
- 1366×600、1024×768、844×390、667×375、390×844 五視口無水平溢出，關閉與產品按鈕可達、至少 44 CSS px；原生影片控制由瀏覽器管理。三片真解碼、播放時間前進、seek 到 12 秒、暫停、切片、Escape／焦點、戰局還原及 offline 提示都實測通過。[播放器驗收](evidence/r27/gallery-implementation.md)
- 最終新遭遇戰片另驗 960×540／24 秒、播放／seek／pause 與 error null；其後正常活動新局，桌機 1280×720 與 Windows Chromium 844×390 各三跑五秒，rAF p95 中位皆 16.8ms，沒有超過 18ms 的影格。這是本機暖機新局及手機視口模擬，非所有實機或大量部隊的效能保證。
- [獨立來源碼覆核](evidence/r27/independent-review.md)未見阻擋接線、按需下載、PWA 或 Range 的問題。

影片內容由本機 Qwen3.8-27B／LM Studio 審查。第一次 dispatcher 因本機 backend 未啟動失敗，恢復後採集與科技片通過；舊遭遇戰因小地圖遮擋收到 `NEEDS_REVIEW`，重新拖曳鏡頭錄製中央交戰後，以十二張更密的循序樣本通過。模型裁決涵蓋抽樣畫面內容，配合完整解碼、黑畫面與凍結檢查；沒有稱作完整逐幀動作或真人娛樂評測。[地端結果](evidence/r27/local-content-review.json)

本輪繁中文案直接套用台灣用語。原先「偵察與交戰」易讓遮擋片被誤當清晰戰鬥，改為依實際補拍內容命名「林緣遭遇戰」；「無旁白」可能暗示還有音效，改為「無音訊」。原始錄影、私有存檔及 browser trace 保留在 Git 忽略的 `.audit-tmp/r27`。
