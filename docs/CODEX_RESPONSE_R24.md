# R24 公開單機版交付紀錄

日期：2026-10-01

本輪修正完整發展的資源缺口、友軍繞行、偵察後存檔 hash、自動存檔錯誤恢復與 AI 遺棄工地，並新增科技與時代面板、續玩入口、框選及中立外怪直接攻擊。完整程式、操作與產包驗證見下列證據；正式發布以相同 commit 的 CI 與 Pages 結果為準。

## 問題與結果

原版完成兩次升階、七科技、生產建築與七兵種最低需木材 3,845。即使取得雙方家園木材及全部外怪獎勵，也只有 2,780，少了 1,065；完整發展無法靠正常遊玩達成。每方家園木材調為 6,000、石材 4,000，仍須正常採集與運輸。標準均衡 AI 實測跑至工藝期並完成全部研究與兵種，再分支取得四種合法勝利。

科技面板把缺少的建築、材料、前置與佇列列在同一入口，可直接開始研究、升階或前往生產建築。研究中退出再繼續，tick、錢包、研究剩餘時間與兩種 hash 一致。舊版檔先驗證再移轉，不修改原始檔。

## 已完成

- `README.md`：把 1.0.0 正式公開單機 Web／PWA 放到頁首，更新公開網址與交付邊界。
- `CHANGELOG.md`：新增 v1.0.0 條目，記錄資源預算、友軍繞行、最後目擊 hash、舊檔升級、科技面板、自動儲存與操作更新。
- `docs/BEGINNER_GUIDE.zh-TW.md`：修正公開服務範圍、教學破壞目標、升階後才蓋射箭庭的流程、`Esc`、`Shift` 框選、中立目標與自動儲存說明。

## 證據範圍

- [`progression-resource-budget.json`](evidence/r24/progression-resource-budget.json)：規則版本 `village-siege/0.20.0`，記錄資源預算、友軍繞行、最後目擊 hash 與 AI 工地接手修正。
- [`full-progression-playthrough.json`](evidence/r24/full-progression-playthrough.json)：完整升階、七項科技與七兵種發展流程。
- [`full-progression-victories.json`](evidence/r24/full-progression-victories.json)：四條勝利路線均為 `VERIFIED`，並完成重播 hash 核對。
- [`final-native-research-autosave.json`](evidence/r24/final-native-research-autosave.json)：原生科技面板、研究排程、離場自動儲存與還原結果為 `VERIFIED`；30 秒定時儲存另由來源碼及存檔回歸驗證。
- [`verify-final.log`](evidence/r24/verify-final.log)：最終完整驗證 512 項通過，分別為 client 143、server 86、shared 262、ops 21；正式建置完成。
- [`runtime-final.log`](evidence/r24/runtime-final.log)：runtime bundle 為 9,708,422 bytes，85／85 資產 hash 完整，秘密掃描 0 筆，檢查結果為 `PASS`。
- [`audit-prod.log`](evidence/r24/audit-prod.log)：production dependencies 為 0 vulnerabilities。
- [`final-player-abilities.json`](evidence/r24/final-player-abilities.json)：桌機滑鼠與 844×390 Chromium 手機觸控模擬的七項技能皆接受；直接點中立野怪送出 `attack` 並接受，兩種裝置頁面錯誤皆為 0。手機結果只代表瀏覽器觸控模擬，不代表 Android／iOS 實機。

## 發布邊界

[終局 UI](evidence/r24/final-result-ui.json)另驗證桌機與觸控的勝利、下載重播、返回與再戰；新戰局回到 tick 0，保留 AI 設定。[效能量測](evidence/r24/final-render-performance.json)記錄兩版面各三次五秒活動戰場的 rAF 間隔，p95 三跑中位 16.8 ms，僅代表同一 Windows 主機的暖機場景，非實機手機保證。

Android／iOS 簽署原生 App、長期公開 WSS 多人服務與劇情戰役也不屬於 1.0.0 已交付範圍。
