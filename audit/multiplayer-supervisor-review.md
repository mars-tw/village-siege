# C-S1 發布主管審核

- 日期：2026-07-17（Asia/Taipei）
- 線路：C — 多人連線與品質
- 工作員：C-W1 網路工程、C-W2 品質與發布
- 決定：`APPROVED — NETWORK FOUNDATION MILESTONE ONLY`

## 主管結論

Colyseus 私人房間基礎已可重現運作：2–4 人容量、六碼房碼、房主／成員、ready/start、10 Hz 伺服器 tick、60 秒重連、訊息大小及序號／擁有權基本驗證。C-W2 提供會自行啟動及關閉獨立伺服器的雙客戶端 smoke test，README 也明確揭露尚未完成完整線上戰鬥。本核准只涵蓋多人房間與品質基礎，不代表完整多人 RTS 或整體 MVP 完工。

## 主管修正與重跑證據

- 將 `colyseus` meta package 改為直接依賴 `@colyseus/core@0.17.44`、`@colyseus/ws-transport@0.17.13` 與 `express@5.2.1`，移除未使用的 auth/playground/Redis 相依鏈。
- `npm audit --omit=dev`：`0 vulnerabilities`。
- `npm run verify`：三 workspace typecheck 通過；shared 2 檔 8 測試通過；client/server build 通過。
- `npm run smoke:multiplayer:local`：`PASS`。
  - 兩個獨立 client 進入同一 room ID。
  - 非房主開始被拒：`HOST_ONLY`。
  - 未全員 ready 時開始被拒：`PLAYERS_NOT_READY`。
  - 非法 ready payload 被拒：`INVALID_PAYLOAD`。
  - guest 斷線後自動重連成功。
  - 雙方進入 `playing`，權威 `serverTick` 前進。
- 客戶端 build 警告：單一 JS chunk 約 1.51 MB（gzip 約 401 kB），不阻擋原型但需在發布候選版分割。

## 非阻擋限制與未完成範圍

1. 完整 shared 戰場模擬與 Phaser 指令尚未接入多人房間；目前線上功能停在大廳、開始、重連與權威 tick。
2. 房間只存在單一 Node.js 程序記憶體，尚無跨程序 presence、持久化或災難復原。
3. 房碼由 client 提出，伺服器會正規化與 filter，但尚無全域唯一性／邀請權限保證。
4. 尚缺帳號驗證、完整 anti-cheat、每玩家明確 rate limit、負載測試、來源限制與公開部署硬化。
5. 目前只以兩位 client 做自動化驗收；三至四人及完整 60 秒逾時清理仍待發布候選階段覆蓋。

## 稽核要求

C-Q1 必須獨立從鎖檔驗證 build、production audit 與 local multiplayer smoke；確認測試會關閉 client/server；只有稽核 `APPROVED` 後，才可依白名單清除 `apps/client/dist`、`apps/server/dist` 等可再生建置輸出並寫壓縮交接。
