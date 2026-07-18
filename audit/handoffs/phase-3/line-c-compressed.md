# line-c phase-3 compressed handoff

- Source version: content-addressed stable delivery; lock SHA-256 `7076394ad35a7edf0753a4f6a40a68fed994e102cdeb2f82677e199ee8a4711e`
- Decision: `APPROVED — NETWORK FOUNDATION MILESTONE ONLY`
- Scope completed: 2–4 人 Colyseus 私人房基礎、六碼房碼、host/member、ready/start、10 Hz authoritative tick、60 秒重連成功路徑、8 KiB 訊息檢查、command sequence/owner 基本驗證，以及可自行關閉的雙客戶端 local smoke。
- Files retained: `apps/server/src/**`、`apps/client/src/network/**`、`apps/client/src/scenes/MultiplayerLobbyScene.ts`、`packages/shared/**`、`scripts/multiplayer-smoke.mjs`、`scripts/multiplayer-smoke-local.mjs`、`README.md`、鎖檔與稽核文件。
- Interfaces and invariants: room `village_siege`；`roomCode` 經正規化與 `filterBy`；只有 host 能 start；至少 2 人且全員 connected/ready；伺服器每 100 ms 推進 tick；`allowReconnection(client, 60)`；非法 payload、owner mismatch、過期 sequence 由 server 拒絕。
- Commands executed: `npm audit --omit=dev` exit 0；`npm run verify` exit 0（3 workspace typecheck、2 test files/10 tests、client/server build）；`npm run smoke:multiplayer:local` exit 0；前後 26567 listener 檢查均無殘留。
- Runtime evidence: smoke `PASS`；2 players；同一 room ID；`HOST_ONLY`、`PLAYERS_NOT_READY`、`INVALID_PAYLOAD`；guest reconnect；雙方 `playing`；`serverTick >= 2`。
- Evidence retained: `audit/multiplayer-supervisor-review.md`、`audit/multiplayer-audit.md`、本交接檔，以及 source 中可重跑的 smoke scripts。
- Risks and limitations: 尚未把 shared 戰場模擬／Phaser 指令接入多人 room；無跨程序 presence/持久化；房碼無全域唯一性；缺完整 auth/anti-cheat/rate-limit/load/deployment hardening；僅測兩人與重連成功路徑；client chunk 尚大。
- Rejected claims: 不得稱為完整多人 RTS、完整線上戰鬥、公開服務就緒或整體 MVP 完工。
- Process note: 初次稽核命中 B-W2 中間態而失敗；未據此判定或清理。主管凍結穩定交付點後，C-Q1 重新完整重跑才核准。後續多線派工應採 worktree 或凍結窗口。
- Next required work: 將 shared simulation/command/event/snapshot 接入 server room 與 Phaser；加入 3–4 人、60 秒逾時/AI 接管、負載與部署安全測試；之後再由主管與獨立稽核決定是否提升里程碑。
- Cleanup performed: APPROVED 後解析並驗證專案內精確絕對路徑，再刪除可再生的 `apps/client/dist`、`apps/server/dist`；刪除後均確認不存在。C-Q1 未產生 run-scoped tmp/log；未碰 source、tests、`node_modules`、鎖檔或 audit evidence。
