# TASK-024 正式環境營運終審（2026-07-21）

## 結論

- Codex：APPROVE。
- Grok CLI 唯讀複審：`P0=0 P1=0 P2=0 APPROVE`。
- Grok 複審 session：`019f8457-4bb5-7aa2-aa11-93a6b363ef42`。
- 範圍：Caddy TLS/WSS edge、Redis/PostgreSQL secrets、正式 Compose、age 加密備份與確認式還原、Prometheus/blackbox/Grafana 監控、應用程式 metrics、告警規則、營運文件及 CI 正式環境閘門。

## 初審拒絕與修正

Grok 初審 session `019f844b-c217-7871-a630-5461fbb5b027` 曾判定 `REJECT`：

1. `P0`：公開 `/metrics` 的拒絕規則可能被 catch-all reverse proxy 遮蔽。
2. `P1`：Caddy healthcheck 只驗證設定，沒有驗證程序存活。
3. `P1`：CI 沒有啟動 Caddy，也沒有實測公開 `/metrics` 與 TLS WebSocket upgrade。
4. `P2`：CI 只檢查一個 metrics 名稱，無法防止告警依賴的 series 漂移。

修正後，Caddy 使用互斥 `handle` 先拒絕 `/metrics`；新增 loopback-only `/healthz`；CI 啟動完整 edge，實測 HTTPS、公開 `/metrics` 404、raw TLS WebSocket `101`，並逐一確認所有告警依賴的 server series。Grok 複審確認四項問題均已消除，且未引入 release-blocking 回歸。

## 已通過證據

- Server typecheck 通過。
- Server：11 files／86 tests 全數通過。
- `npm run verify`：client 10 files／78 tests、server 11 files／86 tests、shared 12 files／224 tests；所有 workspace typecheck 與 production build 通過。
- `npm run validate:ops`：11 個營運資產通過 secret-free 與結構契約檢查。
- Git Bash `sh -n`：server entrypoint、備份、還原腳本皆通過。
- CI、正式 Compose、Prometheus、blackbox、alerts 與 Grafana provisioning YAML 均可解析；Grafana dashboard JSON 可解析。
- 官方 Compose schema 驗證通過；`git diff --check` 通過。
- 本機實跑 server `/metrics`：Prometheus Content-Type、process metrics 及應用程式 metrics 存在；惡意 WebSocket Origin 被拒並使 counter 增加。
- 兩玩家標準 multiplayer smoke、真實 socket reconnect/recovery smoke、五陣營 adversarial smoke 均通過；最終權威 hash 一致。
- Grok 複審逐項確認：Caddy 路由互斥、liveness 不公開、edge 拒絕 metrics、WSS 使用允許的 exact Origin、CI series 與 alert 規則一致。

## 尚待遠端執行的發布閘門

本機沒有 Docker、Podman、Nerdctl、Caddy 或 promtool，因此沒有把設定驗證冒充容器實跑。GitHub Actions 的 `production-template` job 必須在 Linux runner 上完成：

1. Compose、Caddy 與 Prometheus 原生驗證。
2. 建置並啟動 PostgreSQL、Redis、server、client 與 Caddy。
3. 驗證 internal readiness、metrics 與 non-root runtime。
4. 驗證 live TLS edge、公開 `/metrics` 404 與 WSS `101`。
5. 無論結果皆清除 CI volumes。

因此 TASK-024 的程式與範本審核完成；整體發布仍需 TASK-025 遠端 CI 與品質閘門，以及 TASK-026 公開端點的雙瀏覽器真實戰局終驗。
