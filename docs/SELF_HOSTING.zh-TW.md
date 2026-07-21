# Village Siege 自架指南

本指南對應 v0.18 的 TASK-023：以公開、無正式憑證的 Docker 範本啟動前端、單一 Node.js 權威伺服器、Redis 與 PostgreSQL。它適合本機驗證與建立自己的部署基礎；公開網際網路服務仍必須完成 TLS/WSS、備份、監控與公開雙客戶端驗證。

## 前置需求

- Git。
- Docker Engine／Docker Desktop，且包含 Compose v2。
- 至少 4 GB 可用記憶體。

## 版本化容器映像

每個正式 GitHub Release 都會發布兩個 MIT 授權、可匿名拉取的多架構映像，並附 SBOM 與 GitHub provenance attestation：

- `ghcr.io/mars-tw/village-siege-client:<版本>`
- `ghcr.io/mars-tw/village-siege-server:<版本>`

`linux/amd64` 與 `linux/arm64` 都受支援。前端映像不會把維運者的網域寫死在 JavaScript；容器啟動後由 `PUBLIC_CONNECT_ORIGIN` 動態提供 `/runtime-config.js`，因此同一個 digest 可部署到不同網域。正式環境的完整步驟請依照[正式環境操作指南](PRODUCTION_OPERATIONS.zh-TW.md)。

## 本機啟動

在專案根目錄複製範例設定：

```powershell
Copy-Item .env.example .env
```

打開 `.env`，把 `POSTGRES_PASSWORD` 與 `REDIS_PASSWORD` 都換成不同的長隨機值。`.env` 已被 Git 排除；不要把密碼、Token、私鑰或正式連線字串加入 commit。

先檢查展開後設定，再建置並等待健康檢查：

```powershell
docker compose --env-file .env config --quiet
docker compose --env-file .env up --build --detach --wait
docker compose --env-file .env ps
```

開啟 `http://localhost:8080` 可玩容器化單機版。健康與版本端點：

```powershell
curl.exe --fail http://127.0.0.1:8080/_health
curl.exe --fail http://127.0.0.1:2567/health/live
curl.exe --fail http://127.0.0.1:2567/health/ready
curl.exe --fail http://127.0.0.1:2567/version
```

範例前端刻意使用 `VITE_MULTIPLAYER_ENABLED=false`，避免尚未接上 HTTPS/WSS 時顯示會誤導玩家的公開多人入口。要在同一台電腦測試多人，可保留 Compose 的 server、Redis、PostgreSQL，另執行：

```powershell
npm ci
$env:VITE_COLYSEUS_URL = "http://127.0.0.1:2567"
npm run dev:client
```

Vite 的 `http://localhost:5173` 已列入範例 `ALLOWED_ORIGINS`；用一般視窗與無痕視窗即可建立、加入同一房間。

## 停止與資料

```powershell
docker compose --env-file .env logs --tail 200
docker compose --env-file .env down
```

一般 `down` 會保留 `postgres-data` 與 `redis-data`。只有確定不需要任何戰局恢復資料時才使用 `docker compose down --volumes`；該操作會永久刪除本機資料卷。

## 正式部署硬條件

- `NODE_ENV=production`。此模式缺少 `REDIS_URL` 或 `DATABASE_URL` 會直接拒絕啟動，不會靜默退回記憶體儲存。
- `ALLOWED_ORIGINS` 只填實際 HTTPS origin，不含路徑、查詢或憑證；production 即使誤列 HTTP origin 也會拒絕。
- 由反向代理或負載平衡器終止 TLS，對外只開 80/443；Node、Redis、PostgreSQL 不直接公開。
- 正式容器映像保持 `VITE_MULTIPLAYER_ENABLED=false` 且不寫入 `VITE_COLYSEUS_URL`；啟動時由精確的 `PUBLIC_CONNECT_ORIGIN=https://server.play.example.com` 同時產生 runtime config 與只開放該 HTTPS/WSS 端點的 response CSP。只有另行發布至純靜態 CDN、無法使用 runtime config 時，才在自建 bundle 設定 `VITE_MULTIPLAYER_ENABLED=true` 與精確的 `VITE_COLYSEUS_URL`。所有 `VITE_*` 都會寫入瀏覽器 bundle，絕對不能放秘密。
- 目前固定單一 server replica。尚未加入跨程序 Colyseus Presence/Driver、戰局自動重建協調與跨區容錯，不得只把 replica 數量調大。
- 程序內 checkpoint、journal、fenced lease 與 120 秒重連已實作；伺服器程序啟動後自動掃描並重建所有舊房間仍不在 v0.18 保證範圍。

TASK-024 的 TLS/WSS、age 加密備份與 Prometheus/Grafana 範本已放在 `deploy/`，正式操作見 [production 操作指南](PRODUCTION_OPERATIONS.zh-TW.md)。TASK-026 只有在公開網址完成兩個獨立瀏覽器的建造、產兵、研究、戰鬥與斷線恢復後才可宣告公開多人版上線。

## 供應鏈與驗證

```powershell
npm ci
npm run verify
npm run audit:prod
npm run --silent sbom > village-siege.cdx.json
```

`village-siege.cdx.json` 是 CycloneDX SBOM。GitHub CI 另會建置兩個映像、啟動完整 Compose、檢查健康／版本端點，並確認 client 與 server runtime UID 都不是 root。正式發布仍需在實際部署環境執行容器 CVE、秘密、授權與資產署名閘門。
