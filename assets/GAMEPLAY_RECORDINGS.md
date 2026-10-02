# 實玩錄影來源與授權

三段影片錄製自 Village Siege 公開 1.2.0，時間為 2026-10-02（Asia/Taipei），來源網址為 https://mars-tw.github.io/village-siege/play.html?v=1.2.0 。這是正常瀏覽器操作的遊戲畫面，不是生成的宣傳動畫。

| 檔案 | 內容 | 來源 |
| --- | --- | --- |
| economy.mp4 | 採集與兵營放置、施工 | 兩段正常新局錄影，剪接成 24 秒。 |
| movement.mp4 | 軍備科技與部隊移動 | 正常 UI 接續本線自有實玩存檔。 |
| battle.mp4 | 中央林緣野獸遭遇戰 | 正常 UI 接續同份存檔、拖曳鏡頭與攻擊移動。 |

檔案在 `apps/client/public/media/gameplay/`；影片、封面與 metadata 由 Village Siege／MARS-TW 以 MIT 授權公開，沿用專案 LICENSE。無音訊、旁白或第三方音樂，也不包含其他遊戲的畫面。

`gameplay-media-manifest.json` 固定七個按需檔案的大小與 SHA-256，發布時逐一驗證來源與產包。原始錄影只留本機 `.audit-tmp/r27/raw`；編碼程序與錄影過程見 `docs/evidence/r27/encode-gameplay.ps1` 及 `recording-report.md`。原始錄影器只有上方 800×450 是遊戲畫面，輸出裁除灰色填充後等比例放大為 960×540，不把放大說成原生高解析度錄製。
