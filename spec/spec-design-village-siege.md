---
title: 原創中古世紀村莊攻防即時戰略遊戲設計規格
version: 1.0.0
date_created: 2026-07-17
last_updated: 2026-07-17
owner: Village Siege 專案團隊
tags: [design, game, rts, multiplayer, phaser, colyseus, typescript, security]
---

# Introduction

本規格定義一款暫名為「Village Siege」的開源 2D 即時戰略遊戲（Real-Time Strategy，RTS）。遊戲採原創中古世紀等角視角美術，核心循環為採集資源、建設村莊、訓練單位、防守與攻擊其他村莊。產品支援單機對抗可選人格的電腦對手，以及 2–4 名玩家透過權威伺服器連線遊玩。本文件是遊戲設計、用戶端、伺服器、人工智慧、美術、品質保證及稽核工作的共同依據。

## 1. Purpose & Scope

### 1.1 目的

本規格用來：

- 將 MVP 的遊戲規則、功能邊界與驗收標準定義為可直接實作及測試的條目。
- 建立 TypeScript、Phaser 與 Colyseus 之間的資料契約，避免用戶端與伺服器產生不同規則。
- 定義五種可由玩家選擇的 AI 人格與可重現的決策行為。
- 定義多人連線的伺服器權威、安全性、斷線與同步規則。
- 建立原創美術界線，確保只借鑑中古世紀 RTS 類型的抽象玩法，不複製《世紀帝國 II》或其他商業遊戲的受保護資產與識別元素。

### 1.2 範圍內

- 一張支援 3–5 個不同村莊據點的等角視角戰場。
- MVP 提供 3 個完整村莊主題；架構與資料格式必須允許擴充至 5 個。
- 資源採集、建設、人口、訓練、移動、戰鬥、勝敗判定與有限戰爭迷霧。
- 五種可選 AI 人格：侵略者、守城者、繁榮者、均衡者及掠襲者。
- 單機模式與 2–4 人多人房間；多人房間可選擇由 AI 補足空位。
- TypeScript 共用領域型別、Phaser 用戶端與 Colyseus 權威房間伺服器。
- 基本防作弊、斷線重連、測試、自動化與開源發行需求。

### 1.3 範圍外

- 大型多人持續世界、付費道具、區塊鏈、玩家交易市場及即時語音。
- 完整劇情戰役、地圖編輯器、模組市集、排名賽季及跨房間公會。
- 複製任何既有遊戲的單位名稱、數值表、科技樹、地圖、介面配置、音訊、角色、建築輪廓、動畫或商標風格。

### 1.4 目標讀者與假設

- 目標讀者為遊戲設計、TypeScript 開發、網路程式、AI、美術、測試、資安與專案稽核人員。
- MVP 以現代桌面瀏覽器為主要平台，鍵盤與滑鼠為主要輸入。
- 所有遊戲規則均由可版本化資料定義；不得只存在於場景程式或介面程式中。
- 多人模式的最終判定只在伺服器執行；用戶端預測僅改善操作感，不得改變最終狀態。

## 2. Definitions

| 名詞 | 定義 |
|---|---|
| RTS | Real-Time Strategy，即時戰略遊戲，玩家在持續推進的模擬時間中管理經濟與戰鬥。 |
| MVP | Minimum Viable Product，本規格所定義的第一個可公開遊玩版本。 |
| 村莊 | 地圖上的可控制起始據點，由原創主題、起始位置、視覺組件與平衡化特性構成。 |
| 村莊主題 | 只影響原創視覺及一項受預算限制的特性；不得形成無法平衡的付費或隱藏優勢。 |
| AI 人格 | 控制電腦對手戰略權重的預設檔；不允許讀取戰爭迷霧外資訊。 |
| 權威伺服器 | 唯一可驗證指令並提交資源、戰鬥、移動及勝敗結果的執行環境。 |
| 本機權威模擬器 | 單機模式中使用相同領域規則的本機程序，不依賴遠端服務但仍經相同指令驗證。 |
| Tick | 伺服器推進一次遊戲模擬的固定時間單位。 |
| Snapshot | 某一伺服器 Tick 的可同步遊戲狀態。 |
| Command | 玩家或 AI 對權威模擬器提出的意圖，例如移動、建造或攻擊。 |
| Event | 權威模擬器接受 Command 後產生的已確認結果。 |
| 戰爭迷霧 | 限制玩家只能看到己方單位視野內動態資訊的機制。 |
| ELO/MMR | 競技配對評分；不屬於 MVP。 |
| Phaser | 負責 2D WebGL/Canvas 呈現、輸入、場景與音訊的用戶端遊戲框架。 |
| Colyseus | 負責多人房間生命週期、配對、狀態同步與重連的伺服器框架。 |
| TypeScript | 用戶端、伺服器及共用契約的主要程式語言。 |

## 3. Requirements, Constraints & Guidelines

### 3.1 核心玩法需求

- **REQ-001**: 每場戰局必須在一張等角格地圖上提供 3–5 個不同村莊據點；MVP 必須可實際選用 3 個，資料模型必須支援 5 個。
- **REQ-002**: MVP 的三個村莊主題定義為「松林堡」、「河谷鎮」與「高地寨」；名稱、徽記、建築與色盤均須為專案原創。
- **REQ-003**: 每個村莊主題最多只能有一項明示且可量測的微幅特性，其戰力或經濟效益預算不得高於基準值 5%。
- **REQ-004**: 每名玩家開局擁有一座城鎮中心、三名村民、基礎人口容量及等值起始資源；位置資源價值的差異不得超過 10%。
- **REQ-005**: MVP 必須提供木材、食物與石料三種資源；所有採集、消耗、退款與上限運算必須由權威模擬器執行。
- **REQ-006**: MVP 必須提供城鎮中心、住宅、伐木場、農莊、兵營及防禦塔六種建築。
- **REQ-007**: MVP 必須提供村民、民兵、槍兵、弓手、斥候與攻城槌六種單位，並以原創名稱、造型及數值表實作。
- **REQ-008**: 建造、訓練、移動、攻擊、巡邏與停止必須透過 Command 進入模擬器，不得由 Phaser 物件直接改寫領域狀態。
- **REQ-009**: 移動必須尊重可通行格、單位半徑、建築占地與地圖邊界；目的地不可達時必須回傳明確拒絕原因或最近合法位置。
- **REQ-010**: 戰鬥至少包含生命值、攻擊力、護甲、射程、攻擊間隔、移動速度與攻城加成；全部以資料驅動方式定義。
- **REQ-011**: 勝利條件為摧毀全部敵對城鎮中心且敵方無法於 60 秒復建；投降或所有對手離線逾重連期限亦可結束戰局。
- **REQ-012**: 戰爭迷霧必須隱藏視野外敵方單位的即時位置；最後已知的敵方建築可以非即時輪廓顯示。
- **REQ-013**: 暫停只允許單機模式使用；多人模式可以開啟選單，但模擬不得停止。

### 3.2 AI 需求

- **AI-001**: 開局前，玩家必須能分別為每個 AI 槽位選擇人格與難度。
- **AI-002**: 系統必須提供五種人格：侵略者、守城者、繁榮者、均衡者及掠襲者。
- **AI-003**: 侵略者必須提高早期軍事生產與首次進攻權重，目標是在標準資源設定下 6–10 分鐘內發動首次成編攻勢。
- **AI-004**: 守城者必須提高防禦塔、駐軍與反擊權重，不得在軍力劣勢時無條件出城。
- **AI-005**: 繁榮者必須提高村民、資源設施與科技型經濟投入，並在達到人口或資源門檻後轉為中期進攻。
- **AI-006**: 均衡者必須根據敵方軍力、經濟與地圖控制動態調整，不得有任一主要預算長期高於總可用資源的 50%。
- **AI-007**: 掠襲者必須偏好機動單位、側翼路徑與資源點目標；當預估損失高於預估目標價值時必須撤退或換目標。
- **AI-008**: AI 難度只能調整決策頻率、戰術誤差、資源規劃深度與反應延遲；不得獲得額外資源、額外視野或違反冷卻時間。
- **AI-009**: AI 必須與真人使用相同 Command 介面及驗證規則。
- **AI-010**: AI 決策必須接受固定亂數種子，使指定地圖、種子、人格與輸入事件可在測試中重播。
- **AI-011**: AI 不得讀取戰爭迷霧外的敵方即時狀態，只能使用可見狀態及有時間戳的記憶資訊。

### 3.3 單機與多人需求

- **NET-001**: 單機模式必須能在無網路狀態下啟動並完成一場玩家對 1–4 個 AI 的戰局。
- **NET-002**: 多人模式必須支援 2–4 名真人玩家建立或加入私人房間。
- **NET-003**: 房主必須能設定地圖種子、村莊數量、玩家／AI 槽位、AI 人格、難度、隊伍及勝利條件；戰局開始後設定鎖定。
- **NET-004**: 真人與 AI 合計的可控制陣營數不得超過地圖宣告的村莊據點數，且不得超過 5。
- **NET-005**: Colyseus 房間必須是多人戰局的唯一權威來源；Phaser 用戶端不得提交生命值、資源結餘、傷害或勝敗結果。
- **NET-006**: 伺服器必須以固定 Tick 推進模擬；MVP 基準為每秒 10 Tick，狀態同步頻率可以較低但不得低於每秒 5 次。
- **NET-007**: 每個玩家 Command 必須包含戰局 ID、玩家 ID、遞增序號、用戶端 Tick、指令種類與有效負載。
- **NET-008**: 伺服器必須對重複序號做冪等處理，對過期、跳號過大或不屬於該玩家實體的 Command 拒絕並記錄原因。
- **NET-009**: 玩家斷線後必須保留席位 60 秒；在有效重連憑證與期限內應恢復同一玩家狀態並收到差異或完整 Snapshot。
- **NET-010**: 斷線超過 60 秒後，房間設定可選擇由 AI 接管或判定投降；選擇結果必須在戰局開始前公開。
- **NET-011**: 房間若暫時沒有任何連線玩家，伺服器最多保留 60 秒；無人重連即安全終止並清理一次性房間狀態。
- **NET-012**: 用戶端必須顯示連線狀態、延遲、重連倒數與伺服器拒絕指令的可理解訊息。

### 3.4 美術、體驗與授權需求

- **ART-001**: 美術方向必須為「原創中古世紀、2:1 等角格、低解析手繪質感」，不得描述為複刻或重製任何特定商業遊戲。
- **ART-002**: 禁止擷取、臨摹或重描《世紀帝國 II》及其他遊戲的圖像、UI、字型、標誌、音樂、音效、配音、地圖、角色或建築輪廓。
- **ART-003**: 所有外部素材必須具有相容的開源或公有領域授權，並在資產清單記錄來源網址、作者、授權、修改內容及必要署名。
- **ART-004**: 三個 MVP 村莊必須以原創色盤、屋頂輪廓、旗幟徽記和環境裝飾清楚區分；玩家陣營色不得成為唯一辨識方式。
- **ART-005**: 單位必須在 100% 縮放下以輪廓、武器及動畫區分；不得只靠細小文字辨識。
- **UX-001**: HUD 至少必須顯示三種資源、人口、選取資訊、小地圖、建造／訓練動作、網路狀態及目前目標。
- **UX-002**: 所有可點擊操作必須有鍵盤替代路徑；關鍵狀態不得只以紅綠顏色表達。
- **UX-003**: 在 1280×720 至 2560×1440 的 16:9 畫面中，HUD 不得遮擋超過 25% 的可玩視區。
- **LIC-001**: 原始碼必須以專案選定的開源授權發布；第三方程式與素材必須通過相容性清單稽核後才能合併。

### 3.5 安全、效能與工程限制

- **SEC-001**: 伺服器必須驗證玩家身分、房間成員資格、實體所有權、資源、冷卻、距離、視野及指令速率。
- **SEC-002**: 房間加入碼及重連憑證不得記錄於一般用戶端遙測；重連憑證必須具有效期且只能用於原房間與原玩家。
- **SEC-003**: 伺服器必須限制每名玩家每秒 Command 數量及有效負載大小；超限需丟棄、計數並可中止惡意連線。
- **SEC-004**: 聊天不屬於 MVP；玩家顯示名稱仍必須做長度限制、Unicode 正規化及輸出編碼。
- **SEC-005**: 對用戶端傳入的座標、識別碼、列舉值與文字不得信任；任何無效值必須安全拒絕，不得造成房間崩潰。
- **PER-001**: 在基準桌面硬體上，100 個可見單位及 60 個建築時，Phaser 呈現的第 95 百分位畫面更新率不得低於 50 FPS。
- **PER-002**: 四名真人、總計 300 個單位的房間中，伺服器 Tick 的第 95 百分位計算時間不得超過 80 毫秒。
- **PER-003**: 正常網路下 Command 至畫面顯示確認的第 95 百分位延遲目標為 250 毫秒內；超過時介面仍須顯示待確認狀態。
- **CON-001**: 用戶端、伺服器與共用領域契約必須使用 TypeScript 並啟用嚴格型別檢查。
- **CON-002**: Phaser 只負責顯示、輸入、用戶端預測及音訊；不得成為遊戲規則的唯一實作位置。
- **CON-003**: Colyseus 負責多人房間與同步，但領域模擬必須能在不啟動網路堆疊的測試程序中執行。
- **CON-004**: 所有時間運算必須使用模擬 Tick 或伺服器單調時間；不得依賴用戶端系統時鐘判定規則。
- **GUD-001**: 領域邏輯應優先採純函式或明確狀態轉換，以支援重播、除錯與決定性測試。
- **PAT-001**: 所有玩家及 AI 操作採 Command → Validate → Apply → Event → Render 單向資料流。

## 4. Interfaces & Data Contracts

### 4.1 模組邊界

| 模組 | 責任 | 可以依賴 | 禁止責任 |
|---|---|---|---|
| `shared-domain` | 識別碼、列舉、Command、Event、規則資料與純模擬介面 | 無 UI 或網路依賴 | 存取 DOM、Phaser 場景或 Colyseus 連線 |
| `game-client` | Phaser 場景、輸入、HUD、插值、預測與音訊 | `shared-domain`、網路傳輸介面 | 提交權威資源、傷害或勝敗結果 |
| `game-server` | Colyseus 房間、玩家驗證、指令佇列、權威模擬、同步與重連 | `shared-domain` | 信任用戶端計算結果 |
| `ai-controller` | 依可見資訊與人格產生合法 Command | `shared-domain` | 讀取隱藏敵軍狀態或直接改寫世界 |
| `content-data` | 村莊、單位、建築、地圖及平衡資料 | 版本化資料結構 | 執行任意腳本或包含未稽核素材 |

### 4.2 TypeScript 共用契約

以下契約為語意基準；實作可以拆檔，但欄位名稱與不變量不得在用戶端、伺服器間分岔。

```ts
export type MatchId = string;
export type PlayerId = string;
export type EntityId = string;
export type VillageId = "pinehold" | "riverstead" | "highcrag" | "marshwatch" | "sunfield";
export type ResourceKind = "food" | "wood" | "stone";
export type AiPersonality = "aggressor" | "guardian" | "prosperer" | "balanced" | "raider";
export type AiDifficulty = "novice" | "standard" | "veteran";
export type MatchPhase = "lobby" | "loading" | "playing" | "finished" | "disposed";

export interface GridPoint {
  readonly x: number; // 有限整數，0 <= x < map.width
  readonly y: number; // 有限整數，0 <= y < map.height
}

export interface ResourceWallet {
  readonly food: number;  // 安全整數且 >= 0
  readonly wood: number;
  readonly stone: number;
}

export interface MatchConfig {
  readonly rulesVersion: string;
  readonly mapId: string;
  readonly mapSeed: number;
  readonly villageCount: 3 | 4 | 5;
  readonly maxHumanPlayers: 2 | 3 | 4;
  readonly slots: readonly PlayerSlot[];
  readonly reconnectGraceSeconds: 60;
  readonly disconnectedPlayerPolicy: "ai-takeover" | "surrender";
}

export type PlayerSlot =
  | {
      readonly kind: "human";
      readonly playerId: PlayerId;
      readonly villageId: VillageId;
      readonly teamId: string;
    }
  | {
      readonly kind: "ai";
      readonly controllerId: string;
      readonly personality: AiPersonality;
      readonly difficulty: AiDifficulty;
      readonly villageId: VillageId;
      readonly teamId: string;
    };

export interface CommandEnvelope<T extends GameCommand = GameCommand> {
  readonly matchId: MatchId;
  readonly playerId: PlayerId;
  readonly sequence: number;   // 每名玩家嚴格遞增的安全整數
  readonly clientTick: number; // 只用於排序診斷，不作為規則真值
  readonly command: T;
}

export type GameCommand =
  | { readonly type: "move"; readonly entityIds: readonly EntityId[]; readonly target: GridPoint }
  | { readonly type: "attack"; readonly entityIds: readonly EntityId[]; readonly targetId: EntityId }
  | { readonly type: "gather"; readonly entityIds: readonly EntityId[]; readonly targetId: EntityId }
  | { readonly type: "build"; readonly builderIds: readonly EntityId[]; readonly buildingType: string; readonly origin: GridPoint }
  | { readonly type: "train"; readonly producerId: EntityId; readonly unitType: string; readonly count: number }
  | { readonly type: "patrol"; readonly entityIds: readonly EntityId[]; readonly waypoints: readonly GridPoint[] }
  | { readonly type: "stop"; readonly entityIds: readonly EntityId[] }
  | { readonly type: "surrender" };

export type CommandRejectCode =
  | "MATCH_NOT_PLAYING"
  | "NOT_ROOM_MEMBER"
  | "STALE_OR_DUPLICATE_SEQUENCE"
  | "RATE_LIMITED"
  | "INVALID_PAYLOAD"
  | "ENTITY_NOT_OWNED"
  | "INSUFFICIENT_RESOURCES"
  | "ACTION_ON_COOLDOWN"
  | "TARGET_NOT_VISIBLE"
  | "TARGET_NOT_REACHABLE";

export type DomainEvent =
  | { readonly type: "commandAccepted"; readonly sequence: number; readonly serverTick: number }
  | { readonly type: "commandRejected"; readonly sequence: number; readonly code: CommandRejectCode }
  | { readonly type: "entitySpawned"; readonly entity: PublicEntityState }
  | { readonly type: "entityUpdated"; readonly entity: PublicEntityState }
  | { readonly type: "entityRemoved"; readonly entityId: EntityId; readonly reason: "destroyed" | "completed" | "despawned" }
  | { readonly type: "matchFinished"; readonly winningTeamIds: readonly string[]; readonly reason: "conquest" | "surrender" | "disconnect" };

export interface PublicEntityState {
  readonly id: EntityId;
  readonly ownerId: PlayerId;
  readonly kind: "unit" | "building" | "resource";
  readonly typeId: string;
  readonly position: GridPoint;
  readonly hitPoints: number;
  readonly maxHitPoints: number;
  readonly stateRevision: number;
}
```

### 4.3 Colyseus 房間訊息

| 方向 | 訊息 | 有效負載 | 行為 |
|---|---|---|---|
| Client → Server | `lobby.ready` | `{ ready: boolean }` | 只在大廳階段接受。 |
| Client → Server | `match.command` | `CommandEnvelope` | 驗證後排入下一個可用 Tick。 |
| Client → Server | `match.resyncRequest` | `{ lastServerTick: number }` | 回傳差異；差異不可用時回傳完整可見 Snapshot。 |
| Server → Client | `match.event` | `DomainEvent` | 傳送已確認事件。 |
| Server → Client | `match.snapshot` | `VisibleSnapshot` | 只包含接收玩家有權看見的狀態。 |
| Server → Client | `connection.status` | `{ state, retryUntil? }` | 顯示連線、重連或永久離線狀態。 |

```ts
export interface VisibleSnapshot {
  readonly matchId: MatchId;
  readonly rulesVersion: string;
  readonly serverTick: number;
  readonly recipientPlayerId: PlayerId;
  readonly phase: MatchPhase;
  readonly wallet: ResourceWallet;
  readonly population: { readonly used: number; readonly capacity: number };
  readonly entities: readonly PublicEntityState[];
  readonly exploredTilesRle: string; // 經邊界檢查的壓縮探索格資料
  readonly visibleEntityIds: readonly EntityId[];
  readonly checksum: string; // 不含伺服器秘密與戰爭迷霧外資料
}
```

### 4.4 Phaser 呈現介面

```ts
export interface GameViewPort {
  loadMap(config: MatchConfig, snapshot: VisibleSnapshot): Promise<void>;
  applySnapshot(snapshot: VisibleSnapshot): void;
  applyEvent(event: DomainEvent): void;
  setPendingCommand(sequence: number, pending: boolean): void;
  setConnectionState(state: "connected" | "reconnecting" | "offline"): void;
  destroy(): void;
}

export interface CommandGateway {
  submit(command: GameCommand): Promise<{ sequence: number }>;
  requestResync(lastServerTick: number): Promise<void>;
}
```

`GameViewPort` 不得將 Phaser Sprite、Scene 或 Texture 物件寫入共用領域狀態。畫面插值可以落後權威 Tick，但收到較新 `stateRevision` 後不得套用舊更新。

### 4.5 AI 介面

```ts
export interface AiObservation {
  readonly serverTick: number;
  readonly selfPlayerId: PlayerId;
  readonly wallet: ResourceWallet;
  readonly ownEntities: readonly PublicEntityState[];
  readonly visibleEnemyEntities: readonly PublicEntityState[];
  readonly rememberedEnemySites: readonly {
    entityId: EntityId;
    lastKnownPosition: GridPoint;
    observedAtTick: number;
  }[];
}

export interface AiController {
  decide(observation: AiObservation, budgetMs: number): readonly GameCommand[];
}
```

AI 控制器的輸出必須經過與真人相同的 `CommandEnvelope` 包裝、速率限制和驗證器；`AiObservation` 不得包含不可見敵軍狀態。

### 4.6 內容資料契約

```ts
export interface VillageDefinition {
  readonly id: VillageId;
  readonly displayName: string;
  readonly artSetId: string;
  readonly emblemAssetId: string;
  readonly paletteId: string;
  readonly trait: {
    readonly metric: "gatherRate" | "buildTime" | "unitSpeed" | "towerArmor" | "trainingTime";
    readonly multiplier: number; // 0.95 <= multiplier <= 1.05
  };
  readonly attributionIds: readonly string[];
}
```

內容載入器必須拒絕未知欄位、重複 ID、非有限數值、越界倍率及不存在的素材引用。規則版本不相容時，多人用戶端不得加入房間。

## 5. Acceptance Criteria

- **AC-001**: Given 新戰局設定村莊數量為 3、4 或 5，When 建立地圖，Then 系統產生同數量的合法起始據點，且任兩個城鎮中心間有可通行路徑。
- **AC-002**: Given MVP 內容包，When 玩家開啟村莊選擇，Then 松林堡、河谷鎮及高地寨皆有獨立原創預覽、徽記、色盤及不超過 5% 的明示特性。
- **AC-003**: Given 玩家沒有足夠木材，When 提交建造住宅 Command，Then 權威模擬器回傳 `INSUFFICIENT_RESOURCES`，資源與世界狀態不變。
- **AC-004**: Given 玩家選取不屬於自己的單位，When 提交移動或攻擊 Command，Then 伺服器回傳 `ENTITY_NOT_OWNED` 且不洩漏目標隱藏資訊。
- **AC-005**: Given 五個 AI 使用相同地圖種子及觀察序列，When 各執行一場決策測試，Then 每種人格的預算與目標選擇符合 AI-003 至 AI-007 並可由固定種子重播。
- **AC-006**: Given AI 敵人的單位位於戰爭迷霧外，When AI 決策，Then輸入觀察不含該單位即時狀態，AI 不得對未探索座標直接下達精準攻擊。
- **AC-007**: Given 瀏覽器離線且已載入遊戲，When 開始單機玩家對四個 AI 的戰局，Then 不連線遠端伺服器即可完成採集、建造、戰鬥與勝敗流程。
- **AC-008**: Given 四名真人加入同一私人房間，When 所有人就緒且房主開始，Then 所有用戶端載入相同規則版本、地圖種子與權威初始 Snapshot。
- **AC-009**: Given 用戶端偽造生命值、資源或傷害欄位，When 傳至伺服器，Then 訊息因不符合 Command 契約被拒絕且權威狀態不變。
- **AC-010**: Given 玩家在戰局中斷線 30 秒，When 使用有效重連憑證返回，Then 恢復原席位並以 Snapshot 或差異同步至目前伺服器 Tick。
- **AC-011**: Given 玩家斷線超過 60 秒，When 房間設定為 `ai-takeover`，Then AI 透過同一 Command 介面接管；設定為 `surrender` 時則結束該玩家控制權。
- **AC-012**: Given 相同玩家序號已處理，When 重送同一 Command，Then 伺服器不得重複扣資源、生成單位或造成傷害。
- **AC-013**: Given 100 個可見單位及 60 個建築，When 執行標準鏡頭巡覽 5 分鐘，Then 基準硬體第 95 百分位 FPS 不低於 50。
- **AC-014**: Given 四名玩家及總計 300 個單位，When 進行 20 分鐘自動對戰，Then 第 95 百分位伺服器 Tick 計算時間不超過 80 毫秒且無狀態分歧。
- **AC-015**: Given 玩家摧毀最後一個敵對城鎮中心且對方 60 秒內無法復建，When 期限到達，Then 伺服器只產生一次 `matchFinished` 事件並鎖定所有後續遊戲 Command。
- **AC-016**: Given 1280×720、1920×1080 及 2560×1440 視窗，When 進入戰局，Then HUD 保持可操作、關鍵資訊無重疊且占用不超過 25% 可玩視區。
- **AC-017**: Given 任一合併候選素材，When 查驗資產清單，Then 具有來源、作者、授權、修改與署名資訊；無法證明授權者不得進入發行包。
- **AC-018**: Given 美術稽核清單，When 比對角色、建築、圖示、色盤、音訊及 UI，Then 發行包不得含從《世紀帝國 II》或其他商業遊戲擷取、重描或可合理混淆的資產。
- **AC-019**: Given 無效座標、非有限數值、過長文字、未知列舉或超大陣列，When 送入任何公開介面，Then 系統安全拒絕且房間保持可用。
- **AC-020**: Given 房間最後一名玩家離線且無人於 60 秒內重連，When 清理期限到達，Then 房間進入 `disposed`，停止 Tick 並釋放計時器、監聽器與一次性狀態。

## 6. Test Automation Strategy

### 6.1 測試層級與工具

| 層級 | 範圍 | 建議工具 | 必要門檻 |
|---|---|---|---|
| 靜態檢查 | 嚴格型別、循環依賴、格式與內容資料 Schema | TypeScript compiler、ESLint、JSON Schema validator | 零型別錯誤；零高嚴重度規則違反 |
| 單元測試 | 資源、建造、戰鬥、冷卻、視野、AI 權重及序號驗證 | Vitest 或同等 TypeScript 測試器 | `shared-domain` 行／分支覆蓋率至少 90%/85% |
| 性質測試 | 座標、資源守恆、決定性、任意 Command 序列 | fast-check 或同等 property-based 工具 | 至少 10,000 組有效／無效輸入，無負資源及 NaN |
| 整合測試 | Colyseus 房間生命週期、同步、重連、AI 接管 | Node 測試程序與實際 WebSocket | 2–4 人組合及所有斷線政策通過 |
| 端對端測試 | 大廳、開局、操作、勝敗、斷線 UI | Playwright | Chromium 必過；另外一個瀏覽器引擎做發行前檢查 |
| 視覺回歸 | 三村莊、六建築、六單位、HUD、多解析度 | Playwright 截圖與人工美術稽核 | 核准基線無非預期差異；原創性清單簽核 |
| 效能與耐久 | 300 單位、長時間房間、指令洪水 | 可重播負載驅動器 | 符合 PER-001 至 PER-003；無記憶體持續成長 |
| 安全測試 | 竄改、越權、重放、速率限制、資料洩漏 | 契約 fuzzing 與惡意 WebSocket 用戶端 | 零可利用高／嚴重問題 |

### 6.2 決定性與重播

- 測試記錄規則版本、地圖種子、AI 種子、初始狀態及按伺服器 Tick 排序的 Command。
- 相同輸入在相同規則版本下重播，關鍵 Tick 的世界 checksum 必須一致。
- 任何使用牆上時鐘、無種子亂數或非穩定容器迭代造成的分歧均視為阻擋發行。
- AI 決策測試應比較人格行為指標，例如首次出兵時間、防禦支出比例、村民成長及側翼目標比例，不以單場勝負作唯一判準。

### 6.3 測試資料與清理

- 地圖及玩家資料由固定種子工廠建立；不得依賴正式帳號或外部個人資料。
- 每個測試建立獨立房間 ID、玩家 ID 及暫存資料夾。
- 測試結束必須關閉 Colyseus 房間、WebSocket、Phaser 遊戲實例、計時器和事件監聽器。
- 一次性截圖、重播、覆蓋率與負載檔案只存於測試產物目錄；CI 工作結束後依保存政策刪除。
- 失敗重播可保留為最小化種子及 Command 序列，不得保留房間憑證或玩家秘密。

### 6.4 CI/CD 閘門

1. 每次變更執行型別、格式、單元、性質及內容 Schema 測試。
2. 變更 `shared-domain`、`game-server` 或網路契約時執行全部整合、重播及安全測試。
3. 變更 Phaser 場景、HUD 或素材時執行端對端、視覺回歸與授權清單檢查。
4. 發行候選版本執行四玩家耐久測試、五種 AI 行為測試及人工原創性稽核。
5. 任一契約不相容變更必須提高 `rulesVersion`，並驗證舊用戶端得到明確不相容錯誤。

## 7. Rationale & Context

- 選擇 2:1 等角視角是為了清楚表達村莊空間與軍隊路線；它是通用視覺技法，不授權複製特定遊戲資產。
- MVP 先完整製作三個村莊，可在控制美術與平衡成本的同時驗證 3–5 據點架構；另外兩個村莊 ID 預留於資料契約，不代表 MVP 必須完成其資產。
- 五種 AI 人格提供可預期但不同的對局節奏；公平性要求 AI 只能使用玩家可取得的資訊與規則。
- 單機與多人共用領域模擬，可以降低規則分歧並讓大部分測試不依賴瀏覽器或網路。
- 權威伺服器防止用戶端自行宣告資源與傷害，是多人公平性的最低需求；Command 單向資料流也改善重播及除錯。
- 固定 10 Hz 模擬可在瀏覽器 RTS 的反應性與伺服器負載之間取得 MVP 平衡；Phaser 插值維持畫面流暢。
- 私人房間先於公開配對，能縮小身分、內容治理及排名作弊的初期範圍。

## 8. Dependencies & External Integrations

### External Systems

- **EXT-001**: 現代桌面瀏覽器 — 必須支援 WebGL 或 Canvas、Web Audio、WebSocket 及 ES 模組。
- **EXT-002**: 原始碼代管與 CI 平台 — 必須支援開源儲存庫、合併審查、自動測試與發行產物。

### Third-Party Services

- **SVC-001**: MVP 私人房間不要求第三方登入服務；玩家使用房間碼與短期席位憑證加入。
- **SVC-002**: 公開部署時需要可終止 TLS 的託管服務；遊戲傳輸必須使用安全 WebSocket。

### Infrastructure Dependencies

- **INF-001**: Node.js 相容的權威遊戲伺服器執行環境，需支援長連線、固定 Tick 與優雅關閉。
- **INF-002**: 靜態資產發布環境，需支援內容雜湊、壓縮及不可變快取。
- **INF-003**: 伺服器日誌與指標需包含房間生命週期、Tick 時間、拒絕碼與重連結果，不得包含秘密憑證。

### Data Dependencies

- **DAT-001**: 版本化村莊、單位、建築及平衡資料，必須通過 Schema 驗證後才能打包。
- **DAT-002**: 資產授權清單，必須可追溯每個第三方檔案的來源、作者、授權及修改。

### Technology Platform Dependencies

- **PLT-001**: TypeScript 嚴格模式 — 共用領域、用戶端與伺服器的型別及資料契約基礎。
- **PLT-002**: Phaser — 2D 等角地圖、精靈、相機、輸入與音訊的用戶端平台。
- **PLT-003**: Colyseus — 私人房間、狀態同步、訊息路由與斷線重連平台。
- **PLT-004**: WebSocket 相容傳輸 — 多人模式雙向低延遲通訊需求。

### Compliance Dependencies

- **COM-001**: 專案開源授權必須與所有程式依賴及素材授權相容。
- **COM-002**: 商標與著作權稽核必須確認名稱、圖像、音訊、介面及宣傳內容不暗示獲《世紀帝國 II》權利人授權或關聯。
- **COM-003**: 若未來保存帳號或分析資料，必須先另立隱私、保存期限及刪除規格；MVP 不應預設收集個人資料。

## 9. Examples & Edge Cases

### 9.1 合法建造 Command

```ts
const command: CommandEnvelope = {
  matchId: "match_7f3a",
  playerId: "player_blue",
  sequence: 42,
  clientTick: 815,
  command: {
    type: "build",
    builderIds: ["unit_worker_3"],
    buildingType: "house",
    origin: { x: 18, y: 27 }
  }
};
```

伺服器仍須驗證建造者所有權、存活、位置、占地、視野、資源與建造冷卻；TypeScript 型別正確不等於指令合法。

### 9.2 必須處理的邊界案例

| 案例 | 預期行為 |
|---|---|
| 玩家同時快速提交兩棟會超出資源的建築 | 依伺服器序號順序接受第一個；第二個重新檢查餘額並拒絕。 |
| 目標在 Command 送出後、執行前死亡 | 攻擊指令安全取消或依規則重新尋敵；不得攻擊不存在實體。 |
| 路徑中途被新建築阻擋 | 重新尋路；無路徑時停止並產生可理解狀態。 |
| 村民在建造完成同 Tick 被擊殺 | 依固定模擬階段順序決定結果，重播 checksum 必須一致。 |
| 玩家傳入 `NaN`、`Infinity`、負座標或超大座標 | 契約層拒絕，房間不中止且不回傳內部堆疊。 |
| 玩家重送相同序號但變更有效負載 | 視為重放／竄改，拒絕並記錄安全計數。 |
| Snapshot 比已套用版本更舊 | 用戶端忽略舊實體 revision，不造成倒退或復活。 |
| 重連時規則版本已不相容 | 拒絕加入並顯示更新用戶端訊息，不嘗試部分同步。 |
| 四名玩家同 Tick 摧毀彼此最後城鎮中心 | 依固定事件順序與隊伍存活規則判定平手或唯一勝方，只發出一次結束事件。 |
| 房主在大廳斷線 | 轉移房主給最早加入的在線真人；若無人在線則依房間清理規則處理。 |
| AI 沒有可達敵人 | 改採經濟、防守或探索命令，不得持續產生無效指令洪水。 |
| AI 決策超出時間預算 | 該輪回傳空命令或最後安全計畫，伺服器 Tick 不得被阻塞。 |
| 地圖種子產生孤立據點 | 地圖驗證失敗並以另一可記錄種子重建，不得開始無法完成的戰局。 |
| 色覺辨識不足 | 同時使用徽記、輪廓、隊伍標記及色彩，不只更換紅綠色。 |
| 房間清理期間收到遲到訊息 | 回覆房間已結束或直接關閉連線，不重新建立已清理狀態。 |

## 10. Validation Criteria

符合本規格的發行候選版本必須同時滿足：

1. REQ、AI、NET、ART、UX、LIC、SEC、PER 與 CON 條目均有可追蹤的實作項目及測試或稽核證據。
2. AC-001 至 AC-020 全部通過；任何未通過項目均須阻擋 MVP 發行。
3. 共用契約只有一個版本化來源，Phaser 用戶端、Colyseus 伺服器及 AI 不存在複製後分岔的規則型別。
4. 相同規則版本、種子及 Command 重播產生相同關鍵 Tick checksum。
5. 五種 AI 在公平資訊與相同規則下展現可量測且不同的人格行為。
6. 2、3、4 名真人房間與 AI 補位組合均完成建立、開始、遊玩、重連及結束整合測試。
7. 安全測試無未處理的嚴重或高風險問題；無法證明實體所有權、視野或資源的操作必須預設拒絕。
8. 所有程式與素材都有相容授權紀錄；原創性稽核沒有擷取、重描或可混淆的商業遊戲資產。
9. 房間、測試與遊戲實例結束後，計時器、監聽器、WebSocket、暫存憑證及一次性產物均依政策清理。
10. 建置、測試及稽核報告不含 placeholder、秘密憑證、私人資料或僅適用於單一開發者環境的絕對路徑。

## 11. Related Specifications / Further Reading

- [Phaser 官方文件](https://docs.phaser.io/)
- [Colyseus 官方文件](https://docs.colyseus.io/)
- [TypeScript 官方文件](https://www.typescriptlang.org/docs/)
- [WebSocket Standard](https://websockets.spec.whatwg.org/)
- [SPDX License List](https://spdx.org/licenses/)
