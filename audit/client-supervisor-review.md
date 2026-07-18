# 客戶端線主管審核

- 審核日期：2026-07-17
- 審核角色：A-S1 客戶端與美術主管（主代理）
- 工作員：A-W1 Phaser 客戶端、A-W2 HUD／美術規範
- 最終決定：`APPROVED AFTER INTEGRATION AMENDMENT — RE-AUDIT REQUIRED`

## 主管檢查

1. `npm install`：新增 20 個套件，稽核 22 個套件，已知漏洞 0。
2. `npm run build`：TypeScript strict typecheck 與 Vite production build 通過。
3. Playwright 1280×720：村莊選擇畫面可操作，三個原創村莊與五種 AI 選項皆可聚焦並有文字狀態。
4. 單機入口：可進入 `MatchScene`；24×24 2:1 等角地圖、三村、程序建築／單位、資源成長與 HUD 正常呈現。
5. Canvas 互動：點擊松林堡單位後，HUD 顯示「村衛」、陣營及耐久值，證明選取鏈路可用。
6. 瀏覽器主控台：0 errors、0 warnings；favicon 404 已修正。
7. 原創性：畫面完全由 CSS 與 Phaser Graphics 程序繪製，未引入外部圖像、字型、音訊或商業遊戲資產。
8. 無障礙：按鈕具焦點樣式、`aria-pressed`、文字狀態及 reduced-motion；重要狀態不只以顏色表達。

## 主管退修與完成修正

- 移除被底部 HUD 遮蔽的重複操作提示。
- 將顯示名稱統一為松林堡、河谷鎮、高地寨。
- 加入空資料 favicon，清除瀏覽器 404。

## 保留證據

- `audit/evidence/client/village-selection.png`
- `audit/evidence/client/match-overview.png`
- `audit/evidence/client/unit-selected.png`

## 非阻斷限制

- Phaser 目前打入單一約 1.39 MB JavaScript chunk；gzip 約 365 KB，低於專案下載預算，但正式發布前應評估程式切割。
- 多人入口目前明示為規劃中；Colyseus 與真正的五人格決策器屬下一條 AI／連線生產線，未完成前不得宣稱 MVP 完工。
- 本線使用程序向量占位美術；正式 sprite sheet、動畫與完整六建築／六單位仍需後續內容里程碑。

## 主管結論

`APPROVED` — 客戶端線達成可建置、可瀏覽、可選擇、可進入戰場及可選取單位的第一個可玩原型，可送獨立稽核。

## 整合修訂與重新送審

原 A-Q1 核准後，整合階段加入 `MultiplayerLobbyScene`／`MultiplayerClient`，並修正兩項客戶端契約：選村頁顯示名稱統一為松林堡、河谷鎮、高地寨；`MatchScene` 現會讀取所選 AI 人格，使快速進攻、據點守備、先經濟後進攻、穩健發展與機動襲擾具有可觀察的目標／出擊時機差異。這仍是程序式本機原型，尚非 shared AI 的完整視野與經濟模擬。

主管於整合穩定點重跑 `npm run verify`：三 workspace typecheck、shared 10/10 測試、client/server build 全通過；客戶端輸出約 1.51 MB（gzip 約 401 kB），仍只有 chunk-size 非阻斷警告。因 production client 在原稽核後有變更，必須由 A-Q1 重新核對後才可更新壓縮交接與執行本線最後清理。
