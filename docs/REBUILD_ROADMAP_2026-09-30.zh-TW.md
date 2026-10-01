---
goal: Village Siege 原創半手繪 RTS 重建與 Web／PWA／App 路線
version: 1.0
date_created: 2026-09-30
last_updated: 2026-09-30
owner: Village Siege
status: Planned
tags: [gameplay, art, rts, mobile, pwa, app]
---

# Village Siege 完整更新計畫

這次重建採用暖色半手繪等角畫風，先把村落、建築、選單與戰場資訊做成同一套視覺，再改善短局 RTS 的操作與策略選擇。沿用 Phaser、Colyseus 與既有 shared 模擬，將同一款遊戲依序交付成電腦網頁、手機／平板網頁、可離線 PWA、Android App 與 iOS／iPadOS App。

本文件是施工計畫。已完成項目與實測數字應記入當輪報告；下列未來內容、效能目標、商店上架與裝置支援均不能因文件存在就視為完成。本輪範圍見 [R21 八面向計畫](OPTIM_PLAN_R21.md)。

## 1. 現況與保留範圍

基準為本機檢出的 `f4489e310c783731508d6b98cbedb8c3a41b8e3e`，套件版本 `0.20.0`。2026-09-30 已讀取 README、內容定義、模擬、角色 manifest、技術／美術草稿及 CI；本文件作者沒有執行遊戲測試，測試結果由實作線另記。

| 項目 | 原始碼現況 | 本次處理 |
|---|---|---|
| 客戶端 | Phaser `4.2.1`、Vite `8.1.5`、TypeScript；2:1 等角投影，格位 `96×48` | 保留框架與投影，改素材及呈現層 |
| 規則 | `packages/shared/src/content.ts`、`simulation.ts` 管理 10 Hz 模擬、採集搬運、三階聚落、科技、生產、城防、迷霧、技能與勝負 | 維持單一規則來源；調平衡時同步 rules version 與重播測試 |
| 內容 | 3 個可玩村莊、7 兵種、3 外怪、14 種建築、7 項科技、5 種 AI 性格 | 先改善現有內容的辨識與節奏，再增加任務和村莊分支 |
| 動畫 | 戰士、弓箭手、持盾槍衛各有 6 方向×6 動作×4 格；其他 4 兵種與 3 外怪使用單一動作母版 | R21 保留真影格動畫；完整美術輪逐角色補獨立方向及更多關鍵姿勢 |
| 工匠 | 共用戰士影格並加工具標記 | 專屬採集、搬運、施工、修理動畫列為高優先缺件 |
| 單機教學 | 已有 7 段實際命令驅動的教學 | 改入口、目標提示與失敗回饋；新增獨立入門情境 |
| 多人 | Colyseus `0.17`；權威戰局、逐玩家迷霧過濾、120 秒重連骨架 | 保留；公開長期 WSS 與真實雙裝置測試另設閘門 |
| 持久化 | 已有版本化存檔與重播 | 補使用者可操作的自動存檔、續玩與版本錯誤流程 |
| 手機 | 既有點選、拖曳鏡頭、固定七格指揮塢、方向與全螢幕處理 | 重做密度和觸控優先順序；加入平板及瀏覽器工具列測試 |
| App | 基準沒有 Web App Manifest、Service Worker 或 Capacitor 專案 | PWA 先行；原生建置與商店發布分開驗收 |

`docs/rework/technical-gap-draft.md` 描述的空白 preload、未接權威模擬等問題屬較早草稿，已有大量項目完成。`art-bible-draft.md` 的長動畫規格仍是製作目標，不能拿它當現有成品清單。方向、尺寸及公開功能現況以 runtime manifest、shared 規則和實際測試為準。

## 2. 產品範圍與玩法

### 一局的目標

預設對戰以 8～15 分鐘為設計目標，另提供可存檔的 20～30 分鐘標準局。這是待驗證的節奏假設；需以真人對 AI 的完整局紀錄調整。玩家持續在「採集與運輸→聚落發展→偵察→混兵→控制通道／攻破村落」間取捨。

| 模式 | 目標與內容 | 完成條件 |
|---|---|---|
| 邊境入門 | 3 個小情境：運輸經濟、混兵交戰、城門破口；每段約 2～4 分鐘 | 新玩家能透過觸控完成，不需先讀長指南；每段可重試、略過及返回 |
| 快速遭遇戰 | 3 地圖、3 村莊、5 AI 性格；選擇主要勝利條件 | 同一 seed 可重播；勝負、投降、重試、回主選單都可到達 |
| 標準遭遇戰 | 較長經濟期、完整科技、地圖規模依效能實測增加 | 冷開機載入及續玩可靠；不能靠加大地圖掩蓋 AI 或路徑問題 |
| 邊境戰役 | 第一季 6 關；各關有不同地形／限制／目標和 1 個自選支線 | 每關有明確起點、轉折、勝負及存檔；不只是同地圖加敵人血量 |
| 合作守村 | 2 人對 AI 波次，有共同施工／補給目標 | 公開多人先通過 live gate；離線版可先用友方 AI 驗證規則 |
| 私人對戰 | 房號邀請；先 1v1，再 2v2 或 5 陣營混戰 | 兩台真實裝置完成建房、準備、戰鬥、結果及重連 |
| 種子挑戰 | 固定地圖 seed 與條件，單機成績保留本機 | 重播能證明同一規則結果；網路排行榜待帳號及驗證服務完成 |

### 優先改善的可玩性

| ID | 改動 | 實作位置與驗收 |
|---|---|---|
| PLAY-01 | 開局直接標出三種資源、卸貨點與閒置工匠；資源不足列出差額 | `VillageAssaultScene.ts` 與 `assaultPublicPresentation.ts`；60 秒內看得懂下一個合法行動，資訊來源維持 shared |
| PLAY-02 | 點選面板顯示角色職責、有效克制、攻擊／防禦姿態與技能冷卻 | `combat.ts`、Canvas 指揮塢；7 兵種文字和圖示覆蓋，鎖定技能說明原因 |
| PLAY-03 | 可選勝利規則；主要進度常駐，達成前發出可讀警報 | `VictoryPolicy`、`victoryPresentation.ts`；中域／銅標倒數不應讓新玩家無預警落敗 |
| PLAY-04 | 小地圖、受襲定位、閒置工匠循環選取、常用部隊組 | `VillageAssaultScene.ts`、`squadControls.ts`；鍵鼠與觸控各完成同一段實戰，不遮住指揮塢 |
| PLAY-05 | 桌機右鍵下令、框選與控制群組；觸控明確切換「選取／命令」 | 輸入層集中產生 `GameCommand`；拖曳、雙指、長按結束後不得意外下令 |
| PLAY-06 | 指令排程與更清楚的集結／生產佇列 | `protocol.ts`、`simulation.ts`、`VillageAssaultRuntime.ts`；排程需版本化，取消只針對穩定 job ID |
| PLAY-07 | 路徑重規劃、窄門排隊可視回饋，施工／採集者占住單格出口時可讓路；兵營出生格須連到有效出口 | shared 移動與產兵系統；40 單位雙格門、R21 `(4,6)`／`(5,6)`堵塞、盾兵`(3,5)`靜態封閉出生格回歸必過，不能以客戶端穿模解決 |
| PLAY-08 | AI 難度獨立於性格：入門、標準、進階 | `ai.ts` 的決策參數與觀察；可調決策頻率／組隊策略，維持合法資源與視野，難度不靠偷看迷霧 |
| PLAY-09 | 3 村莊各一條有代價的研究分支 | `content.ts`、`combat.ts`；松林補給／河谷機動／高地城防都有可反制手段，同等資源下不能一家全面占優 |
| PLAY-10 | 戰後摘要：資源收入、閒置時間、兵種損失、勝利進度與重播 | shared 事件衍生統計；按隊伍隱私顯示，不在對戰途中洩漏敵方數據 |
| PLAY-11 | 本機自動存檔、損壞檔拒載、更新後續玩提示 | `VillageAssaultRuntime.ts`、新增存檔 repository；採原子替換，保存失敗時保留上一份可用存檔 |
| PLAY-12 | 戰鬥音效與視覺一致：開始、蓄力、命中、倒地、技能就緒 | 新增 `apps/client/src/render/CombatEventPresenter.ts`；音量獨立、靜音、背景切換可恢復，遊戲傷害仍由權威 tick 決定 |

調整順序採「操作錯誤與資訊不明→兵種行為→資源／人口成本→生命／護甲→傷害倍率」。每輪只改一個主要平衡槓桿，記錄 seed、村莊、AI、勝利方式、首次交戰時間、局長及部隊組合。

平衡閘門：每村至少 20 個相同條件 seed、5 種 AI 各有完整長跑、3 種不同混兵能完成標準難度。AI 對 AI 數據用來找異常，不能替代真人操作。技能、勝途及新科技改動必須保留回放雜湊與迷霧邊界測試。

## 3. 新畫風與無 SVG 素材產線

### 固定美術契約

畫面以暖白石灰牆、陶紅屋瓦、木梁、松綠植被、河谷藍水面及銅色指揮點為主。環境採筆刷紋理和克制的細節，建築與人物保留清楚輪廓；俯視方向、左上光源及腳底投影在全套素材一致。

| 層 | 製作規格 | 驗收 |
|---|---|---|
| 主選單 | 繪製村落全景，文字與按鈕另由 DOM 顯示；主行動保持可見 | 背景不得烘焙文字、按鈕或無效遊戲資訊；小螢幕裁切不丟重要構圖 |
| 地形 | 2:1 格位 `96×48`；草、土、道路、河岸、岩地各有 3 個變體與過渡邊 | 採樣相鄰格無明顯接縫，合法通路仍清楚；裝飾不改導航 |
| 建築 | 14 種建築獨立剪影；尺寸依 shared footprint，腳底對齊占地 | 議事堂、倉庫、兵營、塔不能靠換色區別；預覽、完成、受損、殘骸可辨 |
| 圍牆／門 | 2 軸向、開門／關門／受損／破口 | 視覺狀態與權威導航一致；霧中僅呈現最後目擊 |
| 角色 | 7 兵種、1 工匠、3 外怪；六方向及真影格動畫 | 原有 3 套六向先保留；工匠與其餘角色分批替換，缺方向不得宣稱完整 |
| 圖示 | 資源、建築、兵種、技能、系統採 PNG／WebP，附文字與選取標記 | 48px 與 64px 仍可辨，透明邊緣乾淨；不能依賴 emoji 當作固定素材 |
| 特效 | 箭、弩、火器、法術、衝鋒、盾牆、破口採小型點陣動畫 | 作用範圍、敵我與冷卻可讀；不遮住選取圈及生命列 |

禁止 `.svg`、inline `<svg>`、SVG data URI 和產圖後轉 SVG。UI 的框線、文字、選取圈、冷卻環可用 CSS／Canvas 繪製；角色、建築與主場景使用正式點陣素材，不用方塊素體代替。

### 生產步驟

1. 在 `docs/art/` 保存畫風、色票、鏡頭高度、光源、比例及素材清單，先做一張完整場景與一組建築對照。
2. 用 ImageGen 生成原創點陣概念／建築候選。後續引用已選參考圖，不讓每批素材重新發明材質和服裝。
3. 分開產生素材：透明建築、地形 tile、圖示、人物 key pose。大場景概念圖只用於風格與入口，不直接當可互動的整張戰場。
4. 檢查 alpha、透視、光源、腳底 anchor、shared footprint；整理來源、提示詞與版本。AI 候選經過整理與遊戲內驗證才轉成 runtime 素材。
5. 用 `sharp` 打包 PNG／WebP atlas，記錄 source／runtime／sha256／尺寸／方向／狀態。沿用 `runtime-art-policy.mjs`、compliance 和 directional validator，不繞過 provenance 閘門。
6. Phaser Loader 依 manifest 載入，地形、建築、人物分組。先載可開始的一局；概念、候選、來源大圖不進正式 bundle。
7. 在主場景以常用鏡頭距離、遠景、64px 裁圖驗收，保存 before／after。確認人物在新地形上仍可辨，再逐角色換動畫。

初期新增一套 2D 建築 atlas 與主選單背景就能形成可玩視覺切片。完整角色產線則應逐個通過，不一口氣生成數千影格後再找方向、肢體與錨點錯誤。獨立方向不能用鏡射冒充；攻擊至少看得出蓄力、命中、收勢。

新角色品質沿用 R21 色彩門檻：可見像素的正規化亮度 0.30～0.75、近黑比例 <35%、平均飽和度 ≥0.32、低飽和比例 <20%。測量僅取 alpha ≥128 的像素，RGB 各除以255；亮度採 `L=0.2126R+0.7152G+0.0722B`，近黑指 `L<0.10`；飽和採 HSV `S=(max-min)/max`（max=0 時 S=0），低飽和指 `S<0.20`。這是固定的美術統計方法，不是文字對比度標準；色彩數據與正／側／背及縮圖辨識共同判定，不能以數據通過取代造型審查。

### 可選的 Blender 預繪路線

後期若要穩定六方向與長動畫，使用 Blender MCP 建立原創簡模、骨架、材質與固定等角相機，渲染透明 PNG 影格，遊戲仍載入 2D atlas。這能把方向與動畫一致性納入可重跑的來源場景。

本 session 的 Blender MCP 工具已暴露；主線於 2026-09-30 實際呼叫 `get_addon_status`，回應 `Could not connect to Blender. Make sure Blender addon running.`。目前工具已安裝，Blender 連線未就緒，故本文件只列可選路線。啟用前重新讀取 addon status／`get_scene_info`，確認另存專案檔，再以一個工匠完成 6 方向×採集／搬運／施工概念驗證。Hyper3D、Tripo、Sketchfab 或 PolyHaven 的帳號、付費額度與授權另行確認；沒有必要為首版 2D 新增它們。

## 4. 電腦、手機與平板操作

| 行動 | 電腦 | 手機橫向 | 平板 |
|---|---|---|---|
| 單選／多選 | 左鍵選取；Shift 加選；拖框選 | 點選；「加選」切換；選取模式可拖框 | 觸控同手機；接鍵鼠時同電腦 |
| 移動／攻擊／採集 | 右鍵依目標下令；保留左鍵相容模式 | 選取後點合法目標；取消按鈕持續可見 | 同手機，允許較大的選取與生產面板 |
| 鏡頭 | WASD／中鍵拖曳／滾輪 | 拖曳空地；拉近／拉遠；雙指縮放待手勢閘門 | 拖曳／雙指；鍵鼠相容 |
| 技能 | 快捷鍵與指令列；Esc 取消選點 | 點技能→顯示範圍→點目標；點取消不消耗 | 同手機；選點操作不被其他面板搶走 |
| 建造 | B→建築→位置；合法預覽、旋轉、取消 | 建造頁→建築→位置；成本／占地可見 | 同手機；大圖示配文字 |
| 部隊組 | 數字鍵建立／選取，固定組列 | 底部 3～5 個部隊組入口，長按編輯需可取消 | 5 個組入口；外接鍵盤快捷鍵 |
| 暫停／存檔 | 系統選單／P；僅單機可暫停 | 系統按鈕；切背景先保存單機 | 同手機；多人不暫停伺服器 |
| 聽覺／可達性 | 靜音、音量、鍵盤焦點、文字代理 | 震動可關；畫面縮放不能縮小命中區 | 所有核心行動不依賴長按、hover 或雙擊 |

以上新快捷鍵、框選、雙指縮放與控制群組是目標行為，需逐項實作與驗收。現有單指拖曳鏡頭不能直接和拖框選同時啟用；輸入狀態機必須明確決定目前是在選取、下令、建造或平移。

最低命中區 44×44 CSS px，主要行動目標 48×48 px。手機橫向主資訊與命令合計目標不超過高度 30%；直向提供可操作的教學／選單及橫放提示，不能只把戰場壓成不可點的縮圖。建築佇列與系統頁沿用分頁，返回／關閉／取消常駐，不把所有功能堆進一頁。

驗證視口：`1920×1080`、`1366×600`、`1280×640`、`1024×768`、`1366×1024`、`568×320`、`667×375`、`844×390`、`390×844`。每個視口測主選單、教學、戰場、生產、技能選點、系統、結果，記錄元素命中矩形及遮擋。真機另測瀏覽器地址列伸縮、瀏海 safe area、方向切換、100%／125% 桌面縮放、背景恢復與連續多點。

## 5. SKILLS／MCP／工具安裝安排

Skill 是工作指引，MCP 是工具連線，npm 套件是遊戲相依，Android Studio／Xcode 是 App 建置環境；四者分開記錄。

| 能力 | 已有／待驗證 | 用途與安裝決策 |
|---|---|---|
| `game-engine` | session 已列出，已讀 | Phaser、遊戲迴圈、輸入、碰撞、效能；首版直接使用 |
| `frontend-design` | session 已列出 | 原創入口、字級、版面與控制密度；不需安裝新的 UI skill |
| `imagegen`＋ImageGen 工具 | session 已列出工具 | 產生 PNG／WebP 概念與正式候選；初期美術主路線 |
| `create-implementation-plan` | session 已列出，已讀 | 有界任務、檔案、依賴與測試；本次依指定路徑存 docs |
| `speak-human-tw` | 已讀；核心規則 mode 2 | 遊戲教學、按鈕及報告採自然繁中；直接整理後附語句調整摘要 |
| `game-optimization-round` | 本機 `.claude/skills` 已讀 | 八面向與發布閘門，映射到 R21；不需重復安裝 |
| `playwright`／瀏覽器控制 | skill／Cua 工具已列出 | 跨視口操作、截圖、console、offline 與更新；可用現有工具，若寫 CI 再把 runner 鎖為 dev dependency |
| DevSpace MCP | 工具已列出；主線觀察 receiver `awaiting_client` | 可讀寫／測試；跨對話派工需真正 ready receiver，不能把工具在線當作委派成功 |
| Blender MCP | 工具已列出；`get_addon_status` 實測無法連上 Blender | 後期 3D 預繪轉 2D atlas；先處理 live addon 連線，初期無新增 MCP 安裝必要 |
| `sharp` | R21 更新為 `0.35.5` | 裁切、alpha、尺寸、atlas 與素材檢查；沿用 |
| Capacitor | 基準尚未安裝 | 到 Android 階段才加入 `@capacitor/core`／`cli`／`android`，iOS 階段加 `ios`；選同 major 並記錄鎖定版本 |
| Android Studio／SDK／JDK | 本文件未查本機安裝 | Android 原生階段逐項驗證工具鏈後安裝缺件，保存 `sdkmanager`／Gradle／adb 證據 |
| macOS／Xcode／Apple 帳號 | 本機 Windows，未提供 Mac 建置證據 | iOS 階段需可用 Mac 或合法雲端 Mac 建置與實機，不把 Windows 網頁截圖當 iOS App 測試 |
| Figma plugin | 本 session 推薦但未安裝 | 只有需多人共編原生 Figma 設計檔時再導入，PNG／CSS 產線目前不需要 |
| Sentry／分析服務 | 不是首輪必要項 | 到 beta 再選擇，先做本機匿名錯誤紀錄及明確資料清單，不預先加入外傳 SDK |

首輪新增必要 SKILLS／MCP 安裝數量為 0。所需能力已在 session 或專案，先做可玩切片。App 階段安裝的重點是原生工具鏈與鎖定套件；第三方付費生成、雲端伺服器與商店帳號支出應按實際採用項目列出，這份計畫沒有啟用或購買服務。

## 6. 分階段實作與驗收

每階段需先通過前階段依賴；同階段不共寫同一檔的工作可平行。版本是規劃序列，正式發布前由維護者依實作差異確認。

| 階段 | 範圍／檔案 | 必交成果 | 通過閘門 |
|---|---|---|---|
| M0／基準 | `package.json`、shared 規則、現有 screenshots、`docs/evidence/frontier/` | 安裝鎖定相依、baseline 主選單／戰場、目前缺件與 console 紀錄 | 基準能建置；既有失敗逐項保存，不用新畫風掩蓋 |
| M1／R21 視覺可玩版 | `VillageSelectScene.ts`、`style.css`、`villageAssaultArt.ts`、art manifest、PWA 入口 | 原創入口、點陣建築／環境、清楚命令、玩法小改善、可安裝入口 | 無 SVG；三類裝置能啟動教學與完整單機局；既有回歸及素材 checks 通過；其他未測項目明列 |
| M2／完整美術版 | `combatAnimationManifest.ts`、`assets/original/`、地形／建築素材 | 14 建築多狀態、3 地圖完整環境、7 兵種＋工匠＋3 外怪的完整方向、圖示及音效 | 八面向畫廊、色彩測量、真影格、alpha／anchor／版本來源全過；不能把概念圖列為 atlas |
| M3／策略版 | `shared/content.ts`、`combat.ts`、`ai.ts`、`simulation.ts`、`protocol.ts` | 難度、勝途設定、3 村研究分支、控制群組、排程、戰後摘要及小地圖 | 決定論、fog、重播、40 單位門口、AI 長跑、完整局平衡紀錄 |
| M4／PWA 離線 beta | `public/manifest.webmanifest`、Service Worker、存檔 repository、設定頁 | 安裝、離線單機、續玩、下載狀態、更新時機與回復 | HTTPS 下冷啟動一次→斷網→重啟→完成一局；新舊資源不混用，更新不在對局中強刷 |
| M5／多人 beta | server rooms、network store、`deploy/` | 公開 WSS、2 裝置對戰／合作、健康與版本監測、重連 | 本機 smoke／recovery／adverse＋真實網路完成局；120 秒租約、隱私、備份及還原證據 |
| M6／Android beta | 新增 `apps/mobile/` 或 client native folder、Capacitor config | 安裝 APK、正式 AAB、生命週期、返回鍵、方向、檔案分享與觸感 | 至少 1 中階手機＋1 平板真機 20 分鐘；離線存檔、切背景、更新、音訊恢復全過 |
| M7／iOS／iPadOS beta | 同一 Web bundle＋Capacitor iOS、Xcode 專案 | 簽署 archive、TestFlight、safe area、背景恢復、檔案輸出 | 真 iPhone／iPad 完整單機及多人局；Mac／Xcode 建置紀錄，privacy manifest／商店資料完整 |
| M8／1.0 | 6 關戰役、遭遇戰、已驗證平台、release／rollback 文件 | 穩定版遊戲及完整素材來源／操作說明 | 8 面向、效能、RWD、回歸、內容、原生與商店審查分別簽收；公開發布需另記實際 URL／版本 |

M1 能先交付可玩的新風格版本；M2～M8 的缺件與外部環境仍是後續工作。全套動畫、戰役、公開多人及雙商店 App 是完整遊戲的出貨範圍，不能用本輪 2D 改造宣稱全部完成。

### PWA 設計細節

Manifest 定義 name、short_name、start_url、scope、display、theme_color 與 PNG `192×192`／`512×512` 圖示；GitHub Pages 子路徑要從 Vite base 推導。HTTPS／localhost 是安裝要求；離線需另實作快取，Service Worker 本身不是所有瀏覽器的安裝必要條件。[MDN 安裝規格](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)

Service Worker 以 build ID 分組預快取核心程式與已核准 runtime 素材，安裝完整成功才進入 waiting。新版本在返回主選單且已保存後提示套用；移除舊快取只在 activate 成功後執行。多人端點、座位 token、回執、runtime config 不進離線快取。離線只啟用本機模擬，連線失敗不得自動把線上局改成本機局。

安裝提示依瀏覽器能力顯示；iOS 沒有 `beforeinstallprompt`，需提供分享選單加入主畫面的說明，並驗證 Safari／主畫面啟動。[MDN 平台差異](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)

### Capacitor 與商店設計細節

Capacitor 包裝同一份 Web build，不另寫一套模擬。單機必需素材放在 App bundle，原生 bridge 僅處理生命週期、safe area、方向、檔案分享、觸感及儲存。預設不讓 release App 載入任意遠端腳本；多人仍連公開 WSS。

官方 Capacitor v8 文件目前支援 Android API 24+、需要 Android Studio；本遊戲實際最低 Android 裝置仍由 WebGL、記憶體和 FPS 真機測試決定，不能把框架最低版直接當遊戲支援承諾。[Capacitor Android](https://capacitorjs.com/docs/android)

官方 iOS 路線使用 WKWebView，v8 文件目前列 iOS 15+、Xcode 26.0+；iOS 建置需 macOS 或相應雲端 Mac 工具鏈。這台 Windows 可完成 Web／Android 工作與共用程式，不能獨立驗收 iOS 簽署成品。[Capacitor iOS](https://capacitorjs.com/docs/ios)、[環境需求](https://capacitorjs.com/docs/getting-started/environment-setup)

商店階段準備 Bundle ID／applicationId、簽署與金鑰保存、圖示／截圖、年齡分級、隱私政策、資料安全／privacy manifest、支援聯絡與刪除流程（若有帳號）。Apple 要求持續娛樂價值及超越網站重包裝的體驗；完整離線遊戲、原生生命週期與穩定操作是本案準備方向，不能保證審核結果。[Apple App Review Guidelines 4.2](https://developer.apple.com/app-store/review/guidelines/)

Google 目前對 2023-11-13 後建立的個人開發者帳號要求至少 12 名測試者連續加入 closed test 14 天，再申請 production access；需依實際帳號類別與送審當日政策確認。[Google Play 測試要求](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en)

## 7. 品質、效能與驗證

| 類別 | 測量／測試 | 出貨門檻 |
|---|---|---|
| 基本驗證 | `npm run verify`、`validate:compliance`、`prune:runtime-art`、`validate:runtime-assets`、`audit:prod` | 實跑通過，保留 command／exit code／版本；歷史 PASS 不當本輪結果 |
| 八面向 | R21 計畫逐項截圖、畫廊、色彩與操作證據 | 每項使用 VERIFIED／EXECUTED／待驗證／缺件；不得全表假綠 |
| RWD／可達性 | 上述 9 視口；控制矩形、重疊、DOM focus／Canvas 代理 | 主行動、取消及返回在畫面內；≥44px；無遮擋與死路 |
| 單機玩法 | 教學、採集→升階→產兵→技能→城防→合法勝利→結果→重開 | 至少桌機、觸控各 1 完整局；相同 seed 及規則可重播 |
| 路徑與 AI | 40 單位雙格門、五性格 18,000 tick、三至五陣營開局 | 無非法命令、永久卡死、穿建築或隱藏視野資訊 |
| 桌機／手機效能 | 乾淨環境固定場景、60 Hz、前景、warm-up 後各 3 跑；frame-time p95 的三跑中位 | 桌機／手機 p95 ≤18ms；另列模擬耗時、entity count、掉幀及裝置；未達則降效果／分批載入，不改權威 tick |
| 資源预算 | 靜態檔大小、實際下載、atlas 解碼尺寸、GPU／記憶體觀察 | 以既有 provenance budget 為上限；新增素材先量測再更新預算，不能只看壓縮檔大小 |
| PWA | install、offline、cache version、失敗下載、舊版更新與存檔 | 冷啟動素材完整，離線可續玩；混版、損壞存檔與網路失敗有回復途徑 |
| 多人 | local／recovery／adverse smoke，再真實 WSS 與雙裝置 | 權威結果一致、120 秒重連、拒絕偽造指令、霧外資料不送玩家 |
| App | 真機 lifecycle、方向、音訊、返回、檔案、離線與升版 | Android 和 iOS 各留 build／裝置／OS／screen recording；Web 模擬不代替 |

效能量測期間停止其他圖像生成、建置及 GPU 推論工作。量測低畫質時仍播放真影格，可降特效、裝飾、材質尺寸或動畫 FPS；不能退化成單張人物晃動。瀏覽器模擬視口只能證明版面與部分輸入行為，不能證明真手機 FPS、耗電、Safari 音訊或 App 穩定性。

新增 UI／藝術變更優先測相關 client、素材與完整局；shared／協定變更必須加決定論、replay、fog 和多人測試。CI 執行順序沿用 `.github/workflows/ci.yml`，不要以只跑 build 代替它。

## 8. 風險、範圍與交付紀錄

- **規則風險**：`simulation.ts` 已是大型權威模組。視覺輪不一起全面拆檔；拆系統時逐段保持 hash、事件排序與版本契約。
- **素材風險**：AI 產圖不保證占地、alpha 或逐幀肢體一致。候選與 runtime 分開；人物缺件保留現有動畫並明列，先完成建築與環境。
- **效能風險**：2048×2048 RGBA 解碼約 16 MiB，檔案 WebP 壓縮後很小仍不代表 GPU 記憶體小。大背景、atlas 與粒子需分組及量測。
- **輸入風險**：點地命令、框選與拖曳鏡頭會衝突；明確輸入模式及取消語義先於複雜手勢。
- **已實測的玩法限制**：R21有界runtime驗證完成真採集、施工、5名產兵、玩家盾牆、交戰與stronghold，完整勝利尚未通過。施工者先被固定採集者堵住，移開後經敵火力區陣亡；另發現初始盾兵出生格被三個建築格與可再生食物節點包圍。詳見[單機規則紀錄](evidence/r21/SINGLEPLAYER_RUNTIME_CHECK.zh-TW.md)，M3需增加出生可達性、通道讓路與安全施工空間的回歸。
- **網路風險**：GitHub Pages 單機上線不等於公開多人完成。長期主機、WSS、origin、監控、還原與 live gate 逐項記錄。
- **App 風險**：原生工具鏈、商店帳號、真機與審查結果是外部條件。未取得證據時保持待驗證，不能改寫成已支援。
- **時程假設**：每個里程碑以成果與閘門收斂，不對尚未製作的完整動畫與商店審查承諾固定天數。M2 素材規模及 M7 Mac／真機可用性決定後續排程。
- **發布範圍**：本輪在本機實作、驗證及整理可審查結果；依核心規則保持 local-only。若尚未實際 push／deploy／送審，報告不得提供假的新版公開網址或 App 下載。

每輪交付 `docs/CODEX_RESPONSE_Rxx.md`，至少含：改動、使用者可見結果、實跑命令與結果、截圖路徑、缺件、平台範圍、完整局验證、效能量測條件與發布狀態。推送、公開服務與商店送審均記錄實際操作及結果。

繁中文案調整例：

| 原句 | 原因 | 採用寫法 |
|---|---|---|
| 全平台完美暢玩 | 沒有真機與 App 證據，承諾過大 | 電腦、手機與平板先驗證網頁版；App 依原生階段驗收 |
| 全面升級遊戲體驗 | 沒說清楚玩家會遇到什麼變化 | 村莊與建築換成同一套半手繪素材，指令、勝利進度和續玩入口更清楚 |
| 安裝更多 MCP 就能完成 | 工具數量不能取代成品與測試 | 現有 ImageGen、Phaser 與瀏覽器工具可先完成 2D；App 階段補原生工具鏈 |
