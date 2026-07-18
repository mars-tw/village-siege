# 企業主里程碑審核（模擬）

- 日期：2026-07-17（Asia/Taipei）
- 專案：Village Siege／村莊攻防
- 決定：`APPROVED — OPEN-SOURCE PROTOTYPE MILESTONE`
- 發布決定：`NOT APPROVED — MVP RELEASE OR PUBLIC INTERNET SERVICE`

## 企業主結論

本次「開始製作」里程碑已依規劃完成派工與關卡：每條產品線均有兩位工作人員、主管審核、獨立稽核、壓縮交接及核准後清理。交付內容可作為 MIT 開源原型繼續開發：原創程序式等角客戶端、三個村莊、五種可選 AI、決定性 shared 模擬、Colyseus 私人房間基礎，以及可重跑的多人與瀏覽器驗證。

本決定不把原型誤稱為完整 MVP。完整多人戰場尚未把 shared 權威模擬、Phaser 指令、狀態同步與勝負接在一起；因此目前可核准原型原始碼與下一階段開發，不核准宣稱完整線上 RTS、公開服務就緒或 MVP 發布。

## 派工與關卡結果

| 線路 | 兩位工作人員 | 主管 | 獨立稽核 | 決定 |
|---|---|---|---|---|
| A 客戶端與原創美術 | Phaser 客戶端；HUD／程序美術 | A-S1 | A-Q1 整合後重稽核 | `APPROVED — RE-AUDIT` |
| B 共用模擬與 AI | 模擬工程；AI 工程 | B-S1 | B-Q1 長跑稽核 | `APPROVED AFTER REWORK — CORE MILESTONE ONLY` |
| C 多人與品質 | 網路工程；品質／發布 | C-S1 | C-Q1 鎖檔與雙 client 稽核 | `APPROVED — NETWORK FOUNDATION MILESTONE ONLY` |

規劃線另由兩位規劃工作員交付 specification、implementation plan 與 production workflow，經主管及獨立稽核 `APPROVED` 後才開始產品線製作。

## 核心證據

- 穩定交付點 `npm run verify`：client/server/shared 三 workspace typecheck 通過；shared 2 檔、10 測試通過；client/server production build 通過。
- B-Q1：五種 AI 各 10,000 tick，返工後全部 0 rejected；原 `prosperer` queue saturation 缺陷已關閉。
- C-Q1 local smoke：同 room、`HOST_ONLY`、`PLAYERS_NOT_READY`、`INVALID_PAYLOAD`、斷線重連、`playing` 與權威 tick 全通過。
- A-Q1 Chromium：三村正式名稱、五 AI 選項、三種人格 HUD 實測、另外兩種型別完整映射、多人作戰室入口；console Errors 0、Warnings 0。
- `npm audit --omit=dev`：0 vulnerabilities；伺服器已移除未使用的 Colyseus meta-package 相依鏈。
- 授權：專案 MIT；目前視覺為 CSS／Phaser Graphics 程序生成，未納入《世紀帝國 II》或其他第三方商業素材、名稱、音效與 UI 複製品。

## 核准範圍

- 三個可選村莊：松林堡、河谷鎮、高地寨。
- 五種 AI：侵略、守備、發展、均衡、襲擾；shared AI 固定 seed 可重現且不讀隱藏敵方狀態。
- 24×24、2:1 等角程序式原型戰場，具選取、移動、戰鬥、資源 HUD 與 AI 戰術差異。
- shared 核心具三資源、六建築、六單位、三村可玩及五村容量、命令驗證、勝負／復建與 replay hash。
- Colyseus 2–4 人私人房間基礎：房碼、ready/start、10 Hz tick、60 秒重連成功路徑與基本輸入／權限驗證。
- README、規格、實作計畫、生產流程、可重跑 smoke script 與完整稽核軌跡。

## 未核准範圍與下一關卡

1. 將 shared `MatchState`／Command／Event／snapshot 真正接入 Colyseus room 與 Phaser `MatchScene`，讓多人採集、建造、戰鬥及勝負由伺服器唯一判定。
2. 完成 3–4 真人、AI 補位、完整 60 秒逾時／AI 接管、房間終止與勝負整合測試。
3. 加入每玩家明確 rate limit、帳號／邀請驗證、房碼唯一性、來源限制、TLS/WSS、負載測試、監控與公開部署硬化。
4. 補完正式六建築／六單位前端內容、人口與生產 UI、sprite／動畫／音訊授權表，並拆分約 1.51 MB client chunk。
5. 下一里程碑完成後，三條受影響線必須重新走「兩工作員 → 主管 → 獨立稽核 → 壓縮 → 清理 → 企業主」關卡。

## 最終清理確認

所有稽核摘要先落盤才清理。已確認 2567、26567、4173、5173 無專案 listener；`apps/client/dist`、`apps/server/dist`、`.playwright-cli`、`.tmp` 均不存在。這些都是可再生／一次性輸出；source、tests、`node_modules`、`package-lock.json`、README、規格、計畫、稽核文件與五張客戶端 PNG 證據均保留。
