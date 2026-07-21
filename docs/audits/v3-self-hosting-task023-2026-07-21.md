# TASK-023 自架與供應鏈終審（2026-07-21）

## 結論

- Codex：APPROVE。
- Grok CLI 唯讀終審：`P0=0 P1=0 P2=0 APPROVE`。
- Grok session：`019f8427-795c-7cf2-9599-23200223670a`。
- 範圍：公開 client/server Dockerfile、`.env.example`、單 replica Compose、Redis/PostgreSQL 耐久資料、non-root/read-only、health/version、production fail-closed、origin policy、多人功能門閘、CycloneDX、dependency audit、CI 與自架文件。

## 已通過證據

- `npm run verify`
  - client：10 files／78 tests。
  - server：10 files／85 tests。
  - shared：12 files／224 tests。
  - 三個 workspace 的 typecheck 與 production build 全數通過。
- `npm run audit:prod`：0 vulnerabilities。
- `npm run --silent sbom`：CycloneDX 1.5，163 components，JSON 驗證通過。
- Production bundle 掃描：不含 `http://localhost:2567`。
- 靜態前端實際啟動：`/_health` 200、CSP 含 `frame-ancestors 'none'`、POST 405。
- Node 伺服器實際啟動：`/health/live`、`/health/ready`、`/version` 200；版本為 app `0.18.0`、protocol `village-siege-network/4`、rules `village-siege/0.17.0`；允許來源的 credentialed CORS 回傳 exact origin。
- `NODE_ENV=production` 且缺 Redis/PostgreSQL 時，程序以明確錯誤拒絕啟動。
- Compose 與兩份 GitHub workflow YAML 解析通過；Compose 靜態契約確認 client/server/redis/postgres、read-only 與持久卷存在。
- `git diff --check` 通過；server entrypoint 使用 LF。

## 本機限制與保留閘門

本機未安裝 Docker、Podman 或 Nerdctl，因此沒有把靜態檢查冒充為容器實跑。`.github/workflows/ci.yml` 的 `containers` job 會在 GitHub runner 執行：

1. `docker compose config --quiet`。
2. 建置 client/server 映像。
3. `docker compose up --detach --wait`。
4. 呼叫前端、readiness 與 version 端點。
5. 確認 client/server runtime UID 非 0。
6. 無論成功失敗皆關閉服務並刪除 CI 測試卷。

此 job 尚未在遠端跑綠，不得宣稱容器發布閘門已完成。TASK-024 仍需 TLS/WSS、備份、監控與 edge hardening；TASK-026 仍需公開端點、Pages 接線與兩個獨立公開瀏覽器的真實戰局終驗。
