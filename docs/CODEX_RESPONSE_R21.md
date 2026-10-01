# R21 交付與驗證報告

發布註記：2026-10-01 用戶另行授權推送至 `mars-tw/village-siege` 並更新公開遊戲；發布狀態請查看 [GitHub Pages 部署紀錄](https://github.com/mars-tw/village-siege/actions/workflows/deploy-pages.yml)。下文保留 2026-09-30 本機驗收時點的紀錄。

2026-09-30，本機版本0.21.0。已完成首輪可玩重製與完整更新計畫，未推送、未公開部署、未製作商店App安裝包。

## 已完成

- 原創河谷插畫入口、三聚落圖像選擇、五AI風格、三種真實難度、可關閉操作指南與教學入口。
- 十二種PNG等角建築接入遊戲；施工、受損、血量、敵我旗標與戰爭迷霧記憶仍正常。全案沒有SVG素材或UI。
- 地形配色、道路／水面細節與不規則地圖外緣；移除伸出場地的道路色塊。保留原來地形通行與shared規則。
- HUD與按鈕文字避免換行遮擋，手繪圖像採平滑顯示。桌機小地圖可定位鏡頭，維持選取，不把點擊當作部隊命令；小手機隱藏以保留戰場。
- 新戰役／再戰用新種子，同規則版本的存檔與重播保留原種子；匯入後再戰保留AI難度。
- 建造預覽占地改為符合共享規則：選中施工工匠可移開，其他存活單位會阻擋；使用可見資料避免迷霧洩漏。
- PWA安裝入口、PNG圖示、完整離線單機下載、版本快取與逐檔SHA-256完整性。多人與runtime config不進離線快取，更新等全部遊戲視窗關閉。
- sharp0.35.5、Vitest4.1.11及修補的傳遞相依；正式npm audit零漏洞。

## 實測證據

| 檢查 | 結果與範圍 |
|---|---|
| `npm run verify` | exit0；client97、server86、shared237，共420遊戲測試；另15ops測試；三workspace typecheck、18方向圖集驗證及正式建置全部通過。詳見[evidence/frontier/verify-final.log](evidence/frontier/verify-final.log) |
| 素材與runtime | 52個PNG／WebP來源及成品雜湊核對；27個正式點陣素材16,103,842bytes；裁剪後39runtime檔18,443,138bytes；來源母版不在正式包 |
| 相依與秘密 | `audit:prod`零漏洞；license allowlist與秘密掃描通過。發布前仍須再次掃描加入Git的新文字檔 |
| 選單RWD | 1920×1080、1440×900、1366×600、1280×640、1024×768、768×1024、844×390、667×375、568×320、390×844、390×667：按鈕≥44CSSpx、畫面內、互不重疊、SVG DOM零。見[控制矩陣](evidence/frontier/menu-qa-results.json) |
| 真正觸控模擬 | Chromium iPhone8 context：`maxTouchPoints=1`、coarse pointer；667×375實際tap選取3工匠並採集。這是瀏覽器觸控模擬，沒有冒稱實體iPhone |
| 小地圖 | 源碼只吃VisibleSnapshot；4測試涵蓋迷霧、實體allowlist、隊友與座標。真實點選移動鏡頭後3工匠仍被選取，無地面移動命令 |
| PWA子路徑 | `/village-siege/`正式建置、37個快取項目、SHA-256固定；斷網重新整理後實際點開始戰役、建築載入；瀏覽器錯誤0。安裝按鈕布局以合成beforeinstallprompt檢查，沒有宣稱原生安裝。見[PWA紀錄](evidence/pwa-2026-09-30.json) |
| 效能 | 同一Windows／Chromium前景、開局載量，1440×900三跑p95中位16.8ms；667×375瀏覽器視口三跑16.8ms。使用RAF幀間隔，非CPU執行耗時，也非真手機出貨驗收；初次桌機量測遇到另一個simulation run而丟棄，已在無併發建置／媒體工作時重測。見[performance.json](evidence/frontier/performance.json) |

遊戲流程驗證的最終狀態另外記於[evidence/r21/singleplayer-runtime-check.json](evidence/r21/singleplayer-runtime-check.json)。使用真採集、施工、訓練與技能指令，未贈送資源、刪除敵人、改勝利規則或改canonical state；模擬證據不冒稱完整觸控操作錄影。

## 畫面

[原入口](evidence/frontier/before-desktop.png)／[新正式入口](evidence/frontier/production-menu.png)、[正式戰場](evidence/frontier/production-battle-1440x900.png)、[手機觸控](evidence/frontier/world-touch-workers-selected.png)、[離線戰場](evidence/frontier/pwa-offline-battle.png)、[小地圖定位](evidence/frontier/world-minimap-camera-moved.png)。原戰場可由既有audit/evidence/client/match-overview.png對照；本輪起初戰場截圖已接入新建築，不能偽稱完整美術改造前畫面。

## 八面向與完整遊戲差距

入口、按鈕、選單、地圖建築與操作資訊已改善；角色、技能、色彩與動畫以沿用和缺件記錄。本輪沒有重新產出七兵種、工匠和三外怪的完整新畫風／六方向長動畫；牆與門仍是原有Canvas美術，角色與環境尚未全數一致。其他四兵種和外怪的方向缺件、真機效能、完整觸控局、音效、六關戰役、公開WSS與雙商店App仍須按後續里程碑驗收。

正式JS主檔約2.04MB（gzip約549KB），Vite有chunk尺寸警告；不把警告隱藏。完整PWA首次下載約18.4MB，需要連線，瀏覽器清理網站資料後要再下載。載量較高、長局與真機記憶體另測。

內建ImageGen未提供實際model slug，來源如實登錄，不能宣稱已核實gpt-image-2。Blender MCP工具已安裝但live addon未連上；DevSpace worker為awaiting_client，本輪沒有假稱已完成外部ChatGPT委派。此輪使用內建子代理分工與交叉檢查；PWA作者驗證自己的PWA部分，不冒充第三方稽核。

## 完整製作安排

[九階段更新路線](REBUILD_ROADMAP_2026-09-30.zh-TW.md)包含玩法、兵種反制、研究、六關戰役、動畫製作、PWA、公開多人及Android／iOS。首輪需要新增的SKILLS／MCP為0，現有game-engine、frontend-design、imagegen、Playwright等能力足夠。原生階段才安裝Capacitor同major套件與Android工具鏈；iOS需Mac／Xcode及實機，商店要求以送審時官方規定為準。

## 繁中介面整理（核心規則mode2）

| 原句 | 原因 | 改成 |
|---|---|---|
| 選擇你的村莊 | 開局需要同時理解地形與作戰 | 選擇聚落，配合具體地形說明 |
| 開始單機戰役 | 單機是當前主行動，語句過長 | 開始戰役 |
| 挑選地形與對手風格，開始單機戰役或進入私人多人房間。 | 資訊重複且擠占入口 | 分成聚落、對手風格、難度與私人連線按鈕 |

## 本機遊玩

正式預覽：[localhost:4173](http://localhost:4173/)。同網路手機可開[192.168.0.144:4173](http://192.168.0.144:4173/)，戰場採橫向；安裝PWA需HTTPS或瀏覽器認定的本機安全來源，一般手機LAN HTTP不能當作安裝驗收。

重啟：`npm run preview --workspace @village-siege/client`。重新製作正式包：`npm run build`，接著`npm run prune:runtime-art`。GitHub公開網站目前仍是先前版本。

## 最後的出兵修補與相容界線

規則已從 `village-siege/0.18.0` 更新為 `village-siege/0.18.1`，App維持0.21.0、network protocol維持4。新出生點要能沿固定四向離開生產建築周邊；兵營單格或雙格封閉口袋不再產生走不出的新兵。出口不成立時，已付費且剩餘0tick的佇列保留，正常採集打開通道後才恢復出兵；沒有搬動舊單位或贈送兵力。畫面顯示「等候出營」，說明移開部隊或採集阻擋通道的資源。3項新shared回歸與同模型獨立上下文覆核已通過。

這個有界出生點檢查沒有宣稱修正全城連通性。主城南側三格空間與工作工匠堵路仍屬開局配置／讓路改善項目，詳見實戰紀錄及完整計畫PLAY-07；第一輪完整勝利與觸控結局仍沒有通過驗證，不能用435項測試通過代替。

舊0.18.0存檔／重播會依既有版本檢查拒絕匯入；沒有偷偷改寫舊存檔。需要續玩舊檔時保留原始版本，正式相容遷移屬後續工作。已安裝PWA更新到新規則後也遵守同一界線。
## 最終多人回歸

0.18.1下三項本機Colyseus smoke通過：一般連線2真人／3伺服器AI、斷線恢復與有序命令重送、50～200ms延遲／掉包／亂序／真斷線重連；沒有重複扣款，接收者狀態雜湊一致。normal／recovery／adverse紀錄在evidence/frontier/。首次恢復測試以Windows程序錯誤碼-1073740791退出、未有JS診斷；同指令獨立重跑成功，未假稱已定位程序異常原因。

出生點修補後最終正式bundle也重新驗證離線開局，畫面與入口無瀏覽器錯誤。435項回歸包含420遊戲測試＋15ops測試。最後一項純文字換行改善另外通過client正式建置；不把來源改動前的逐像素截圖當作完全相同的bundle。
