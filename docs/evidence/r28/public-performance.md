# 1.3.2 公開 UI 效能驗收

狀態：**PASS**。所有 build、驗證與模型工作停止後，才對 immutable QA build 執行本次效能量測。

桌面 1280×720 與 generic Chromium mobile emulation 844×390 各使用一個獨立 browser context。每個 context 都由主選單正常開始一場新單機戰役，HUD 出現公開 DOM `aria-label="暫停"` 後暖機 2 秒，再連續執行三次 5 秒 `requestAnimationFrame` 取樣。每次取樣前後都再次確認 label 仍是「暫停」，證明遊戲沒有處於暫停狀態。

| Profile | Run | Frames | Median frame | p95 frame | >18 ms | >33 ms |
|---|---:|---:|---:|---:|---:|---:|
| Desktop 1280×720 | 1 | 301 | 16.7 ms | 16.8 ms | 0 | 0 |
| Desktop 1280×720 | 2 | 301 | 16.7 ms | 16.8 ms | 0 | 0 |
| Desktop 1280×720 | 3 | 301 | 16.7 ms | 16.8 ms | 0 | 0 |
| Mobile emulation 844×390 | 1 | 301 | 16.7 ms | 16.8 ms | 0 | 0 |
| Mobile emulation 844×390 | 2 | 301 | 16.7 ms | 16.8 ms | 0 | 0 |
| Mobile emulation 844×390 | 3 | 301 | 16.7 ms | 16.8 ms | 0 | 0 |

六次取樣的 median 都低於 18 ms，browser error 為 0。量測前後 HUD 截圖：

- `perf-1280x720-before.png`
- `perf-1280x720-after.png`
- `perf-844x390-before.png`
- `perf-844x390-after.png`

本次只透過公開 DOM 確認遊戲正在執行，沒有讀寫 `privateGameRuntime`、simulation state 或 clock。這是正常新局的瀏覽器效能驗收，不是大軍壓力測試；844×390 是 generic mobile emulation，不是實體手機結果。兩個 owned browser contexts 均已關閉。
