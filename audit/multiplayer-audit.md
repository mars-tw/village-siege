# C-Q1 多人連線與品質獨立稽核

- 日期：2026-07-17（Asia/Taipei）
- 線路：C — 多人房間與品質基礎
- 稽核員：C-Q1（未參與 C-W1、C-W2 實作或 C-S1 主管審核）
- 決定：`APPROVED — NETWORK FOUNDATION MILESTONE ONLY`

## 稽核結論

在主管宣告穩定交付點後，C-Q1 由鎖檔獨立重跑 production dependency audit、完整 verify 與本機雙客戶端 smoke，三者皆成功。smoke 證實兩個獨立客戶端進入同一 room、ready/start 權限規則、非法 payload 拒絕、斷線自動重連，以及雙方進入 `playing` 後權威 tick 前進。測試完成後 26567 無 listener，亦未發現符合 smoke/server 命令列的殘留 Node.js 程序。

此核准只認證「多人房間與品質基礎」，不代表完整多人 RTS、完整線上戰鬥或整體 MVP 已完工。

## 獨立重跑結果

| 檢查 | 結果 | 證據摘要 |
|---|---|---|
| 26567 埠前置檢查 | PASS | `PRECHECK_NO_LISTENER_26567` |
| `npm audit --omit=dev` | PASS | `found 0 vulnerabilities` |
| `npm run verify` | PASS | 3 workspace typecheck；shared 2 檔、10 測試；client/server build |
| `npm run smoke:multiplayer:local` | PASS | 2 players、同 room ID、`playing`、`serverTick: 2` |
| 權限與輸入拒絕 | PASS | `HOST_ONLY`、`PLAYERS_NOT_READY`、`INVALID_PAYLOAD` |
| 60 秒重連機制的成功路徑 | PASS | guest drop 後自動恢復 session，authoritative roster 回到 connected |
| 26567 埠後置檢查 | PASS | `POSTCHECK_NO_LISTENER_26567` |
| 殘留 smoke/server Node.js 程序 | PASS | 命令列篩選無結果 |

## 測試清理與 finally 檢查

- `scripts/multiplayer-smoke.mjs` 以 `finally` 對 guest、host room 依序呼叫 `leave()`，並將離房錯誤限制在清理階段。
- `scripts/multiplayer-smoke-local.mjs` 在同一 Node.js 程序動態載入 server；`finally` 一律呼叫 `server.gracefullyShutdown(false)`，沒有另啟一個難以追蹤的背景 server 子程序。
- smoke 成功後等待 500 ms 再查 26567，結果無 listener；CIM 命令列檢查也沒有殘留測試／server Node.js 程序。
- build 輸出只屬可再生產物；沒有把 `node_modules`、鎖檔、source、tests 或 audit evidence 納入清理。

## 工作區競態紀錄

稽核初次重跑時，恰逢 B-W2 修改 shared AI 的中間狀態，`npm run verify` 與 local smoke 的 server build 一度因 `packages/shared/src/ai.ts:103` union narrowing 錯誤失敗。C-Q1 隨即停止判定、未寫稽核結果、未清理，並回報主管。待 B-W2 完成、主管於穩定交付點重跑通過後，C-Q1 才重新執行全部命令並以穩定版本做最終判定。這不是最終產品缺陷，但顯示後續多線派工應使用獨立 worktree 或明確凍結窗口，避免共享工作區的中間態污染稽核。

## 保留限制

1. shared 戰場模擬與 Phaser 指令尚未接入多人 room；目前沒有可玩的完整線上採集、建造、戰鬥同步。
2. 目前只有單一 Node.js 記憶體程序；沒有跨程序 presence、持久化或災難復原。
3. 房碼由 client 提出，尚無全域唯一性與邀請授權保證。
4. 尚缺帳號驗證、完整 anti-cheat、每玩家 rate limit、來源限制、負載測試與公開部署硬化。
5. 自動化只覆蓋兩人與重連成功路徑；三至四人、完整 60 秒逾時／AI 接管仍未驗收。
6. client build 的單一 JS chunk 約 1.51 MB（gzip 約 401 kB），發布候選版應拆分。

## 可追溯版本

- `package-lock.json` SHA-256：`7076394ad35a7edf0753a4f6a40a68fed994e102cdeb2f82677e199ee8a4711e`
- `apps/server/src/rooms/VillageSiegeRoom.ts` SHA-256：`3fdf95754d16899a7b9d347225c087571bf492fcbbebe5cc67fcee02fc873485`
- `scripts/multiplayer-smoke.mjs` SHA-256：`f9b429f17a1f2300e9f4d594f93b106faa470573d8474af3d491b5c19675f72e`
- `scripts/multiplayer-smoke-local.mjs` SHA-256：`53e3761bc7aa4b8c962c3d1bfe60fb6320ba6d0463230d6a5b78f0c50e3f9a4c`

## 安全清理

決定為 APPROVED。C-Q1 以單一 PowerShell/.NET 流程先 `Resolve-Path`，確認下列兩個精確目標等於預期絕對路徑且位於專案根目錄內，才遞迴刪除並再次驗證不存在：

- `C:\Users\digimkt\Documents\Codex\2026-07-17\new-chat\village-siege\apps\client\dist`
- `C:\Users\digimkt\Documents\Codex\2026-07-17\new-chat\village-siege\apps\server\dist`

本次 C-Q1 沒有產生 run-scoped tmp/log，因此沒有其他清理目標。未清理其他線路的 `.tmp`、source、tests、`node_modules`、鎖檔或 audit evidence。兩個 `dist` 均可用 `npm run verify` 重建。
