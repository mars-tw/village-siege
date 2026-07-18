# Village Siege／村莊攻防

Village Siege 是一個 MIT 授權的瀏覽器即時戰略遊戲原型。它採用原創的中世紀等角視角美術、程式繪製素材與自有介面；節奏參考經典 RTS，但不包含《世紀帝國 II》的名稱、素材、音效或介面複製品。

## 立即遊玩

**[開啟公開單機版](https://mars-tw.github.io/village-siege/)**

公開網站由 GitHub Pages 自動建置。單機戰役可直接遊玩；多人功能目前仍是房間與連線架構原型，尚未提供完整同步戰場。

第一次接觸專案請先閱讀 **[繁體中文新手指南](docs/BEGINNER_GUIDE.zh-TW.md)**；內容包含五分鐘啟動、第一場戰役、完整操作、多人房間與常見問題。

目前已核准的開源原型里程碑包含：

- 三個可選村莊：松林堡、河谷鎮、高地寨。
- 五種 AI 性格：進攻、守備、發展、平衡、襲擾。
- 24×24、2:1 等角視角地圖，單位選取、移動、戰鬥與資源 HUD。
- 七個可玩兵種與三種中立外怪皆已接入專案原創 4×6 透明動作表；待機、走路、攻擊、施法、受擊、死亡都使用不同逐格姿勢，不再以單張 portrait 搖擺冒充動畫。
- 單機戰役使用 18×16 隱藏導航格、連續無格線地表、六種地形成本、南北雙進攻路線、A* 避障、三座怪物營地與兩座可占領烽火台。
- 戰局分為部署、交戰、增援、決戰四階段；占領烽火台持續取得勝點，先到 100 或殲滅對方主力獲勝，敵軍壓力與增援會逐步提升。
- 七兵種具有資料驅動護甲、傷害類型、克制矩陣、主動技能與狀態；缺少任何正式角色／外怪 PNG 會阻止開局，不會偷偷退回程序人偶。
- Colyseus 權威伺服器大廳：2–4 位玩家、六碼房號、準備／開始、10 Hz 權威 tick。
- 60 秒斷線重連窗口，以及房主、訊息大小、序號與單位擁有權的基本驗證。

## 環境需求

- Node.js 22.12 或更新版本。
- npm 11 或相容版本。
- 支援 WebGL 的現代瀏覽器。

## 本機啟動

先在專案根目錄安裝鎖定版本：

```powershell
npm ci
```

開啟第一個終端機啟動多人伺服器：

```powershell
npm run dev:server
```

伺服器預設監聽 `http://localhost:2567`。再於第二個終端機啟動遊戲：

```powershell
npm run dev:client
```

開啟 Vite 顯示的網址即可選擇單人模式，或在多人模式建立房間。第二個瀏覽器／無痕視窗可輸入同一個六碼房號加入。

單機戰役操作：

- 左鍵點選或拖曳框選；`Shift` 加選，`Ctrl+A` 全選我軍。
- `Ctrl+1`～`Ctrl+3` 儲存編隊，`1`～`3` 召回；`F` 切換楔形／橫列。
- 右鍵下達隊形移動或指定攻擊；`Q` 讓目前選取的全隊施放各自技能。
- `WASD` 或方向鍵平移戰場鏡頭；`R` 重開，`Esc` 返回戰前會議。
- 野外怪物維持中立，只有受到一方攻擊後才會對該方反擊。

若伺服器不在預設位置，啟動或建置客戶端前設定：

```powershell
$env:VITE_COLYSEUS_URL = "http://127.0.0.1:2567"
npm run dev:client
```

## 驗證與多人 smoke test

完整型別檢查、共享模擬測試與正式建置：

```powershell
npm run verify
```

可重跑的本機多人測試會自行建置、啟動獨立伺服器、建立兩個客戶端，最後關閉連線與伺服器：

```powershell
npm run smoke:multiplayer:local
```

它驗證以下行為：

- 房主建房、第二位玩家依房號加入同一房間。
- 非房主無法開始；玩家未全數準備時房主也無法開始。
- 非法 ready payload 遭拒。
- 斷線後可用原 session 自動重連。
- 兩位玩家準備後由房主開始，雙方收到相同的 playing 階段與持續增加的伺服器 tick。

若已另行啟動伺服器，可改用：

```powershell
npm run smoke:multiplayer
```

以 `COLYSEUS_URL` 指定非預設測試端點；自啟測試則可用 `SMOKE_PORT` 改變預設的 `26567` 連接埠。

## 專案結構

```text
apps/client/       Phaser 4 + Vite 瀏覽器客戶端
apps/server/       Colyseus 0.17 權威房間伺服器
packages/shared/   決定論模擬、內容定義、AI 與協定型別
scripts/           可重跑的多人整合 smoke test
spec/              產品與技術規格
plan/              實作計畫
docs/              美術方向與生產流程
audit/             主管／稽核紀錄與驗證證據
```

## 建置與發布

客戶端建置時必須把公開的 Colyseus HTTPS 端點寫入 `VITE_COLYSEUS_URL`，瀏覽器 SDK 會使用對應的安全 WebSocket：

```powershell
$env:VITE_COLYSEUS_URL = "https://game.example.com"
npm run build
```

- 將 `apps/client/dist/` 發布至靜態網站或 CDN。
- 以 `PORT` 指定伺服器連接埠，再執行 `npm run start:server`。
- 公開部署時應在反向代理終止 TLS、使用 `wss`、設定來源限制、速率限制、監控與健康檢查。

## 已知限制與發布風險

- 現階段多人模式完成房間、準備、開始、重連及權威 tick；戰場的完整共享模擬與客戶端指令仍未接到線上狀態，因此尚不是完整的線上對戰版本。
- 現有七兵種與三外怪已完成六動作、每動作四個獨立影格；目前六個邏輯朝向仍共用右向母版並以左右鏡像呈現，尚未完成六個方向各自獨立繪製的 multiatlas。
- 房間與比賽狀態僅存於單一 Node.js 程序記憶體，沒有資料庫、跨程序 presence、伺服器遷移或災難復原。
- 房號由客戶端提出，伺服器會正規化與篩選，但尚未提供全域唯一性保證或邀請權限。
- 目前沒有帳號驗證、完整 anti-cheat、每玩家速率限制、管理員工具與觀戰隱私控制；不可直接視為網際網路公開服務的安全完成品。
- Phaser 目前集中在單一大型前端 chunk。正式發布前應做場景／多人功能動態載入與資產分割。
- 2026-07-17 執行 `npm audit --omit=dev` 為 0 vulnerabilities。伺服器直接使用 `@colyseus/core`、schema、WebSocket transport 與 Express，沒有引入未使用的 Colyseus auth/playground meta-package 相依鏈；公開發布前仍應在 CI 持續執行 audit 與版本審查。

## 授權

程式碼使用 [MIT License](LICENSE)。目前遊戲視覺由程式產生，未引入需要額外署名的第三方素材；素材政策記錄於 [assets/ATTRIBUTION.md](assets/ATTRIBUTION.md)。
