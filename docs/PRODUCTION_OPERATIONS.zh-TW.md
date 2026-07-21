# Village Siege 正式環境操作指南

本指南對應 TASK-024 的公開、無秘密基礎設施範本。它提供 Caddy 自動 TLS/WSS、單一權威 server、內部 Redis/PostgreSQL、age 加密備份與 Prometheus/Grafana 設定。這些檔案可以自行部署，但**不代表官方公開多人服務已經上線**；TASK-026 還必須取得真實網域、部署主機並完成兩個獨立公開瀏覽器的整場驗證。

## 1. 網域與主機

準備兩個 DNS 名稱並把 A/AAAA 記錄指向同一台部署主機：

- `play.example.com`：遊戲前端。
- `server.play.example.com`：配對 HTTP 與 WebSocket。

防火牆只對外開放 TCP 80、TCP 443；若要使用 HTTP/3 再開 UDP 443。不要公開 2567、5432、6379、Prometheus、Grafana 或 blackbox-exporter。

## 2. 建立外部秘密

Production Compose 只引用主機上的 secret 檔，不把密碼寫入 Git 或 `.env`。Linux 範例：

```sh
sudo install -d -o "$(id -u)" -g "$(id -g)" -m 0700 /etc/village-siege/secrets
openssl rand -base64 48 | tr '+/' '-_' | tr -d '=\n' > /etc/village-siege/secrets/redis_password
openssl rand -base64 48 | tr '+/' '-_' | tr -d '=\n' > /etc/village-siege/secrets/postgres_password
chmod 0444 /etc/village-siege/secrets/*
```

Redis secret 必須是 32～128 個 base64url 字元；不符合時容器會 fail closed。請用主機的 ACL／檔案擁有者限制讀取權，不要把 secret 目錄放進專案。

## 3. 設定與啟動

`deploy/compose.production.yaml` 是**獨立** production Compose，不要再疊加根目錄的本機 `compose.yaml`，否則本機 port 與明碼 password env 可能被 Compose merge 保留下來。

```sh
cp deploy/production.env.example deploy/production.env
```

在 `deploy/production.env` 填入實際兩個 hostname、ACME email 與完整 Git commit SHA。所有 production Compose 指令一律透過 `deploy/production-compose.sh` 執行；它會強制檢查 secret 目錄為 `0700`、檔案為 `0444`。檔案權限讓容器內的非 root UID 可讀，但主機其他帳號無法穿越 `0700` 目錄，因此仍無法讀取。密碼不會寫入映像、Git、`.env`、程序環境或應用程式環境。先驗證，再啟動：

```sh
sh deploy/production-compose.sh config --quiet
sh deploy/production-compose.sh up --build --detach --wait
sh deploy/production-compose.sh ps
```

Caddy 會因 host matcher 自動申請憑證、將 HTTP 導向 HTTPS，並代理瀏覽器 SDK 的 WebSocket upgrade。前端建置會固定寫入 `https://server.play.example.com`，CSP 也只開放同一個 HTTPS/WSS origin。公網 `/metrics` 會由 Caddy 回 404。

Vanilla Caddy 沒有核心 rate-limit directive；範本不放假的 no-op 設定。正式服務仍需在可信任 CDN／WAF／負載平衡器做連線與配對速率限制，或另外建立、固定並稽核含 rate-limit module 的 Caddy image。

## 4. 健康與公開驗證

```sh
curl --fail --silent --show-error https://play.example.com/
curl --fail --silent --show-error https://server.play.example.com/health/live
curl --fail --silent --show-error https://server.play.example.com/health/ready
curl --fail --silent --show-error https://server.play.example.com/version
```

`/version` 必須回 app `0.18.0`、protocol `village-siege-network/4`、rules `village-siege/0.17.0` 與實際 commit。`/health/ready` 在 draining 或 Redis/PostgreSQL 失效時回 503。

Metrics 只能由 internal network 讀取：

```sh
sh deploy/production-compose.sh exec -T server \
  node -e "fetch('http://127.0.0.1:2567/metrics').then(r=>r.text()).then(console.log)"
```

## 5. 監控

`deploy/monitoring/` 提供：

- Prometheus 對 server `/metrics` 的內網 scrape。
- blackbox 對 server readiness 與 client health 的探測。
- recovery fail-stop、persistence failure、平均 tick 超過 80 ms、平均 persistence 超過 500 ms 與 endpoint down 告警。
- Grafana datasource、provisioning 與 overview dashboard。

依 [monitoring README](../deploy/monitoring/README.md) 將檔案唯讀掛載到自己管理的 Prometheus／Grafana stack。範本刻意不決定 Grafana 密碼、Alertmanager receiver 或第三方 API token；這些必須由外部 secret manager 注入。未經身分驗證與 TLS，不得公開監控 UI。

## 6. 加密備份

安裝 PostgreSQL client 與 `age`。建立離線保存的 age identity，並只把 public recipient 提供給備份工作：

```sh
age-keygen -o /etc/village-siege/secrets/backup-age-identity.txt
age-keygen -y /etc/village-siege/secrets/backup-age-identity.txt
```

設定 `AGE_RECIPIENT`、`PGHOST`、`PGPORT`、`PGUSER`、`PGDATABASE` 與 `PGPASSWORD_FILE` 後執行：

```sh
AGE_RECIPIENT='age1...' \
PGHOST='postgres' PGPORT='5432' PGUSER='village_siege' PGDATABASE='village_siege' \
PGPASSWORD_FILE='/run/secrets/postgres_password' \
BACKUP_DIR='/backups' BACKUP_TMPDIR='/tmp' RETENTION_DAYS='14' \
sh deploy/backup/backup-postgres.sh
```

腳本先在 `BACKUP_TMPDIR` 的 0700 目錄建立、驗證 0600 plaintext archive，再將 ciphertext 寫入 `BACKUP_DIR` 同檔案系統的暫存檔；只有 age 加密成功後才原子更名為 `village-siege-*.dump.age`。建議 `BACKUP_TMPDIR` 使用 tmpfs 或加密磁碟，並把 ciphertext 複製到異地主機／物件儲存。SIGKILL 或突然斷電無法執行 trap，因此仍要定期掃描與清理隱藏暫存檔。

## 7. 還原演練

先在隔離的測試 PostgreSQL 建立空資料庫，停止測試環境的遊戲寫入，再設定獨立目標的 `PGHOST`、`PGPORT`、`PGUSER`、`PGDATABASE`、`PGPASSWORD_FILE` 與 `AGE_IDENTITY_FILE`：

```sh
sh deploy/backup/restore-postgres.sh /backups/village-siege-20260101T000000Z.dump.age
```

Restore 會解密到 0600 temp、驗證 archive，接著要求 TTY 逐字輸入資料庫名稱與 `RESTORE <filename>` 兩次確認，最後才用單一 transaction 清除並還原。它刻意拒絕 `DATABASE_URL`，避免憑證出現在 `pg_restore` process argv。至少每次正式版本與每月各做一次隔離 restore drill，記錄耗時與 recovery record hash；不要第一次在事故當下才測試備份。

## 8. 升級、回滾與停止

每次部署以 immutable commit SHA 作 `VILLAGE_SIEGE_TAG`，先完成備份與 staging smoke，再更新 production。若新版本 health、version、WSS 或權威 hash 不符，停止新配對並回到前一個 image tag；不要回退 PostgreSQL volume 到未驗證的舊 schema。

```sh
sh deploy/production-compose.sh logs --tail 300
sh deploy/production-compose.sh down
```

一般 `down` 保留資料卷與 Caddy 憑證。`down --volumes` 會刪除 PostgreSQL、Redis 與 Caddy state，只能在已確認可還原且明確要銷毀環境時使用。

目前 server 必須維持一個 replica；尚無跨程序 Presence/Driver、自動掃庫重建舊房間與跨區容錯。程序內 120 秒 reconnect、checkpoint、journal 與 fencing 已完成，但不能把它描述成完整災難復原。公開多人上線仍以 TASK-026 的真實 Pages + WSS + 兩瀏覽器完整戰局為最後硬門檻。
