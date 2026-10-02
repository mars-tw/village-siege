# R28：實玩介紹放在開源主頁

2026-10-02。App 1.3.2。依使用者澄清修正上輪範圍：錄影給第一次造訪專案的人了解遊戲。

## 主頁交付

README 開頭改為遊戲簡介、遊玩連結，以及可直接播放的 72 秒實錄。使用 GitHub 正式 README 編輯器的 Attach files 上傳，不是外部假播放器，也不需要先進入遊戲。預覽實測得到原生 `video`、controls、960×540、72 秒；以正常鍵盤播放到 72 秒、error null。附件網址記於[上傳證據](evidence/r28/github-attachment.json)。

三段內容依序為採集建造、科技與移動、林緣遭遇；24＋24＋24 秒，stream copy 串接、無音訊，沒有新生成畫面、變速或改遊戲資源。三原片的 SHA-256 不變。影片、封面與 metadata 移至 `docs/media/gameplay`，來源與 MIT 授權保留。[媒體對帳](evidence/r28/documentary-media-report.json)

## 移除誤加功能

刪除遊戲內影片按鈕、原生 dialog、專屬 UI 檔與測試，以及觀看時的暫停／輸入接線。戰前與系統選單恢復原有功能，PWA 與靜態伺服器恢復原有用途；產包守門拒絕影片與文件媒體殘留。

客戶端、伺服器及共享規則的遊戲行為維持一致；規則 0.20.0、network 4、persistence 1 沒有變更。原先的 R27 報告與影片審查保留為歷史紀錄，目前功能與媒體位置以本輪及 README 為準。

## 驗證

- verify：client 177、server 86、shared 262、ops 21，共 546 項；typecheck、真動作契約及正式建置通過。
- 正式 Pages 包 56 檔、9,134,880 bytes，91／91 原創素材 hash、37 runtime raster、文件媒體八檔與四 H.264 stream 對帳通過；遊戲包含零部文件影片。每檔 2 MiB、遊戲整包 20 MiB 上限不變，72 秒文件介紹片另有 10 MiB 附件上限。
- 三視口 1366×600、844×390、390×844 等待 PWA 出現後驗收；原選單控制至少 44px、中心點可命中、無溢出。遊戲內 video／gallery／影片請求均為零，正常戰役、系統與科技關閉恢復、原生全螢幕通過。[玩家驗收](evidence/r28/player-acceptance.md)
- 模型與建置停止後，1280×720 與 844×390 各獨立正常新局、暖機後三跑五秒，rAF p95 中位皆 16.8ms。這是本機活動新局與觸控模擬，非大軍壓測或實體手機保證。[影格證據](evidence/r28/public-performance.md)
- 四支文件影片完整 FFmpeg 解碼零錯誤；本機 Qwen3.8-27B 對 72 秒介紹的十八張循序採樣直接裁決 PASS，沒有詳細理由，也沒有把採樣結果說成逐幀或真人娛樂評測。[地端審查](evidence/r28/local-overview-review.json)

原始錄影、私人存檔及操作 trace 留在 Git 忽略的 `.audit-tmp`。公開的是遊戲來源碼與主頁實錄介紹。
