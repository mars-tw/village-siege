# Village Siege 美術製作聖經（重製草案）

狀態：`DRAFT FOR SUPERVISOR REVIEW`
適用里程碑：角色美術重製、戰鬥可讀性、六方向動畫、投射物與外怪
基準場景：Phaser、2:1 等角地圖、`TILE_WIDTH = 96`、`TILE_HEIGHT = 48`
語言：所有玩家可見名稱使用繁體中文；資產 ID、檔名與動畫 key 使用小寫英文。

## 1. 不可變更的原創原則

本案要表現的是「邊境村落以手工裝備、地方材料與不穩定祕術抵抗荒野怪物」；不是重製或換皮任何既有商業 RTS。可借用中世紀、火器、弓弩、騎乘與等角視角這些通用題材，但不得複製《世紀帝國 II》或其他遊戲的具體角色比例、姿勢、UI、盾徽、配色、圖示、建築輪廓、動畫節奏、音效或素材。

原創視覺語彙鎖定如下：

- 人體比例為 4.5 頭身，手腳略大，以小尺寸戰場辨識為優先；不用寫實八頭身，也不用大頭 Q 版。
- 輪廓由「職業主形狀 + 一件偏心裝備」構成：法師是高帽與環杖、弓箭手是反曲弓、火槍兵是斜向長槍、戰士是短披肩與寬刃、盾牌手是梯形籐木盾、野豬騎士是低矮前傾獸背、重弩手是橫向弩臂。
- 材料只用毛呢、舊皮革、亞麻、鍛鐵、黑化鋼、銅鉚釘、柳木、灰木、籐片、骨粉與釉陶；避免高亮黃金鎧甲、寶石堆疊與大型哥德式飾紋。
- 明暗採 3 個主色階加 1 個輪廓色；金屬最多加 1 個高光色。角色在 100% 原生尺寸與灰階下都必須可辨認。
- 敵我識別不能只靠色相。隊伍換色區必須同時位於上半身和武器附近，並配合旗結、肩帶或盾角等不同形狀。
- 所有角色、怪物與特效必須由本專案新製。任何外部參考只可用來研究真實材質、動物結構或武器機械，不可直接放進儲存庫。

## 2. 像素、比例與共同技術基準

### 2.1 原生尺寸

| 類別 | 未裁切 frame canvas | 角色可見高度 | 建議畫面占地 | 基準點（未裁切座標） | 地面陰影 |
|---|---:|---:|---:|---:|---:|
| 一般人形 | 96×112 px | 52–64 px | 0.55×0.55 tile | `(48, 88)` | 30×12 px |
| 重裝／重弩 | 112×112 px | 58–68 px | 0.65×0.58 tile | `(56, 88)` | 36×13 px |
| 野豬騎士 | 144×128 px | 66–82 px | 0.90×0.68 tile | `(72, 101)` | 58×20 px |
| 小／中型外怪 | 128×128 px | 54–82 px | 0.75×0.70 tile | `(64, 101)` | 48×18 px |
| 大型外怪 | 160×144 px | 82–112 px | 1.15×0.95 tile | `(80, 116)` | 76×26 px |

- 上表是 native pixel 尺寸。遊戲內以整數倍率顯示；禁止對角色做非整數縮放。
- 所有動作的腳底／接地基準點必須固定；idle 漂移不超過 1 px，hurt 不超過 2 px，死亡可離開基準點但碰撞關閉事件必須一致。
- 陰影是獨立 sprite，不畫死在角色 frame 內。陰影使用 `#10241E`、35% alpha、硬邊橢圓；飛行單位依高度縮小並降低 alpha。
- 世界排序使用腳底基準點的 world Y，而不是 texture 底部。
- 線稿以 1–2 px 深炭色 `#1C211F` 為主，內部材質邊界不應全部描黑。

### 2.2 隊伍換色

每個角色的換色區占可見像素 8–14%，固定使用四階索引色，匯出前保留 palette mask：

| 索引 | 中性預覽色 | 用途 |
|---|---:|---|
| `TC0` | `#253844` | 最深折線／內陰影 |
| `TC1` | `#41657A` | 主布料 |
| `TC2` | `#6E94A8` | 亮面 |
| `TC3` | `#A9C5CF` | 小面積邊光／結繩 |

換色區不得包含膚色、金屬刃、火焰、法術或地面陰影。各職業位置：法師腰帶與帽尾、弓箭手肩巾與箭羽、火槍兵火藥帶與帽帶、戰士披肩與護腕、盾牌手盾角布與背帶、野豬騎士鞍毯與槍穗、重弩手胸帶與弩臂結繩。

## 3. 六方向 facing 規格

使用者所說的「6 維度視角」在本專案正式定義為 **六方向 facing**，不是六個空間維度。所有角色、外怪與方向敏感的投射物都必須有 `E, NE, NW, W, SW, SE` 六套原創影格；不得只畫三向再鏡射，因為武器、手勢與裝備具有左右不對稱。

2:1 等角投影採：

```text
screenX = (gridX - gridY) * 48
screenY = (gridX + gridY) * 24
```

| Facing | suffix | 代表 grid delta | 投影後 screen delta | 畫面讀法 |
|---|---|---:|---:|---|
| 東 | `e` | `(+1, -1)` | `(+96, 0)` | 完整右側面 |
| 東北 | `ne` | `(0, -1)` | `(+48, -24)` | 右後 3/4，臉只露 1/3 |
| 西北 | `nw` | `(-1, 0)` | `(-48, -24)` | 左後 3/4，背部裝備清楚 |
| 西 | `w` | `(-1, +1)` | `(-96, 0)` | 完整左側面 |
| 西南 | `sw` | `(0, +1)` | `(-48, +24)` | 左前 3/4，胸口裝備清楚 |
| 東南 | `se` | `(+1, 0)` | `(+48, +24)` | 右前 3/4，臉部最清楚 |

運行時先把世界移動向量投影到 screen vector，再和上表六個 guide vector 做 normalized dot product，選最大者。方向切換要有 8° hysteresis，避免小幅路徑修正造成抖動。若向量恰好是畫面正北或正南，沿用前一個方向的左右側；沒有歷史方向時，北預設 `ne`、南預設 `se`。停止時保留最後 facing。攻擊方向以目標投影向量計算，不以移動方向代替。

## 4. 戰鬥辨識與克制語言

數值由玩法設計文件決定；以下只鎖定玩家必須從美術看懂的意圖。

| 職業 | 戰場功能 | 優勢目標 | 明顯弱點 | 技能與必須看見的 cue |
|---|---|---|---|---|
| 法師 | 慢速範圍／破防 | 密集盾牌、群怪 | 弓箭手、野豬騎士近身 | `灰燼環`：杖環亮三段、地面出現斷裂六角符，不用圓形魔法陣 |
| 弓箭手 | 長射程點殺 | 法師、火槍兵、無甲怪 | 盾牌手、騎士衝鋒 | `縫影箭`：箭尾雙結、命中出現短暫地釘影 |
| 火槍兵 | 高穿甲／長裝填 | 戰士、盾牌手 | 弓箭手、貼身戰士 | `貫煙線`：槍口銅叉張開、白灰煙沿直線分三團 |
| 戰士 | 機動近戰／切後排 | 重弩手、火槍兵 | 盾牌牽制、野豬撞擊 | `折步斬`：披肩先反向甩動，再出短弧刃光 |
| 盾牌手 | 阻擋投射／保護隊形 | 弓箭、普通弩箭 | 法術、火槍穿甲 | `楔盾陣`：盾底插地、兩側出木楔，不用發光護盾泡泡 |
| 野豬騎士 | 衝鋒／追擊脆皮 | 法師、弓箭手、火槍兵 | 盾牌架槍、重弩定身 | `裂土衝`：野豬低頭刨地兩次，衝鋒留下兩列泥塊 |
| 重弩手 | 慢速重擊／反大型 | 騎乘、重甲、巨怪 | 戰士繞側、弓手先射 | `樁釘弩`：雙腳架張開、弩臂後彎、粗弩箭帶方形尾羽 |

所有施放前搖都要讓對手至少看見一個「輪廓改變」而非只靠顏色。一般攻擊命中與技能命中必須使用不同效果形狀。

## 5. 七個核心職業造型

| ID／名稱 | silhouette | 裝備與材質 | 職業識別色 | frame／基準 | 隊伍換色位置 |
|---|---|---|---|---|---|
| `mage` 法師 | 向後彎的分叉布帽、空心環杖、窄肩寬袖；整體是上窄下三角 | 羊毛袍、骨粉符片、釉陶瓶、焦木環杖；法術為灰白火星與青綠內焰 | 灰紫 `#6E627D` + 灰燼青 `#6D9A91` | 96×112；腳底 `(48,88)`；影 28×11 | 帽尾、雙層腰帶、杖環下結繩 |
| `archer` 弓箭手 | 反曲弓形成高 C 形、短斗篷切成斜角、背箭袋偏右 | 柳木弓、麻弦、樺皮護臂、油布短斗篷；箭羽非對稱雙羽 | 苔黃 `#A59A58` + 樹皮褐 `#66503B` | 96×112；`(48,88)`；影 29×11 | 肩巾、箭羽、右膝綁帶 |
| `musketeer` 火槍兵 | 斜穿全身的長槍、前寬後窄的軟帽、腰間六個火藥筒 | 黑化鋼槍管、胡桃木槍托、銅叉架、皮革藥帶；不用歐洲軍服 | 煙藍 `#596E72` + 火藥赭 `#A06842` | 112×112；`(56,88)`；影 34×12 | 帽帶、斜胸帶、三個藥筒套 |
| `warrior` 戰士 | 斷面寬刃、單側短披肩、前傾菱形姿態 | 黑化鐵寬刃、皮札甲、麻繩護腕、銅鉚釘；沒有大型角盔 | 鐵紅 `#8B4E43` + 暗皮褐 `#4C3B32` | 96×112；`(48,88)`；影 31×12 | 單側披肩、護腕、刀柄纏布 |
| `shieldbearer` 盾牌手 | 身體被上窄下寬的梯形盾切掉一半，短矛水平伸出 | 柳木條、籐片、鐵包邊、粗亞麻背帶；盾面是三條錯位木片，不畫紋章 | 松脂綠 `#536D55` + 舊木 `#826D4E` | 112×112；`(56,88)`；影 38×14 | 盾上兩個角布、背帶、矛穗 |
| `boar_rider` 野豬騎士 | 低長野豬、前傾騎手、短鉤槍形成向前尖角；不得像馬騎士 | 粗黑鬃、泥灰皮、骨鼻護、木鞍、短鉤槍；野豬有一長一短的斷牙 | 泥橙 `#A3643F` + 鬃黑 `#302C29` | 144×128；`(72,101)`；影 58×20 | 鞍毯、槍穗、騎手肩帶；野豬本體不換色 |
| `heavy_crossbow` 重弩手 | 橫向寬弩臂、背部絞盤、蹲姿雙腳架；是最寬的人形 | 灰木弩臂、骨滑輪、黑鋼扳機、皮胸墊、可折木腳架 | 骨白 `#B8AE8E` + 冷鐵 `#586064` | 112×112；`(56,88)`；影 39×14 | 胸帶、弩臂結繩、腰間上弦布 |

### 5.1 `mage` 動畫

| state | 每 facing frames | FPS | loop | event frame（從 0 起算） |
|---|---:|---:|---|---|
| `idle` | 8 | 6 | 是 | `emberPulse@2,6` |
| `walk` | 8 | 10 | 是 | `footL@1, footR@5` |
| `attack` | 10 | 12 | 否 | `telegraph@2, projectile@6, recover@8` |
| `hurt` | 4 | 12 | 否 | `flinch@0` |
| `death` | 12 | 10 | 否 | `dropStaff@4, collisionOff@8` |
| `cast` | 12 | 12 | 否 | `telegraph@2, aoeCommit@7, recover@10` |

`cast` 的杖環須在 frame 2、4、6 依序點亮三段；死亡時法術先熄滅，身體才倒下。

### 5.2 `archer` 動畫

| state | frames | FPS | loop | event frame |
|---|---:|---:|---|---|
| `idle` | 8 | 6 | 是 | `scan@5` |
| `walk` | 8 | 11 | 是 | `footL@1, footR@5` |
| `attack` | 10 | 14 | 否 | `nock@2, projectile@6, recover@9` |
| `hurt` | 4 | 13 | 否 | `flinch@0` |
| `death` | 12 | 10 | 否 | `dropBow@5, collisionOff@8` |
| `cast` | 10 | 12 | 否 | `skillNock@2, projectile@6, recover@9` |

弦在 release 前必須形成 2 px 以上的清楚位移；箭只在 `projectile@6` 後離開手上 frame。

### 5.3 `musketeer` 動畫

| state | frames | FPS | loop | event frame |
|---|---:|---:|---|---|
| `idle` | 8 | 6 | 是 | `checkMatch@5` |
| `walk` | 8 | 9 | 是 | `footL@1, footR@5` |
| `attack` | 14 | 12 | 否 | `brace@3, muzzle@6, projectile@6, reloadOpen@9, reloadClose@12` |
| `hurt` | 4 | 12 | 否 | `flinch@0` |
| `death` | 12 | 9 | 否 | `dropMusket@4, collisionOff@8` |
| `cast` | 12 | 11 | 否 | `forkOpen@2, muzzle@6, pierceLine@6, recover@11` |

槍口閃光只存在 2 frames；裝填姿勢要保持槍口離開敵方，避免看似二次射擊。

### 5.4 `warrior` 動畫

| state | frames | FPS | loop | event frame |
|---|---:|---:|---|---|
| `idle` | 8 | 7 | 是 | `weightShift@4` |
| `walk` | 8 | 12 | 是 | `footL@1, footR@5` |
| `attack` | 9 | 15 | 否 | `windup@2, meleeHit@5, recover@8` |
| `hurt` | 4 | 14 | 否 | `flinch@0` |
| `death` | 12 | 11 | 否 | `dropBlade@6, collisionOff@8` |
| `cast` | 10 | 14 | 否 | `backStep@2, cleaveHit@6, recover@9` |

寬刃的動態弧線不得畫成半透明長光帶，只使用 2–3 塊斷裂灰白刃風。

### 5.5 `shieldbearer` 動畫

| state | frames | FPS | loop | event frame |
|---|---:|---:|---|---|
| `idle` | 8 | 6 | 是 | `shieldSettle@4` |
| `walk` | 8 | 9 | 是 | `footL@1, footR@5` |
| `attack` | 10 | 12 | 否 | `jabWindup@2, meleeHit@6, recover@9` |
| `hurt` | 4 | 11 | 否 | `shieldImpact@0` |
| `death` | 12 | 9 | 否 | `shieldFall@5, collisionOff@9` |
| `cast` | 10 | 10 | 否 | `braceStart@2, guardActive@6, wedgeSet@7` |

盾牌被擊中時應露出 1 frame 的反向傾斜，不使用全身白閃；`cast` 結束姿勢可銜接 brace idle overlay。

### 5.6 `boar_rider` 動畫

| state | frames | FPS | loop | event frame |
|---|---:|---:|---|---|
| `idle` | 8 | 6 | 是 | `snort@3, hoofScrape@6` |
| `walk` | 10 | 12 | 是 | `frontHoof@1, rearHoof@6` |
| `attack` | 12 | 14 | 否 | `lowerTusk@2, meleeHit@7, recover@11` |
| `hurt` | 4 | 12 | 否 | `rear@0` |
| `death` | 14 | 9 | 否 | `riderSeparate@5, collisionOff@10` |
| `cast` | 12 | 13 | 否 | `scrape1@1, scrape2@4, chargeActive@7, dustBurst@7` |

騎手軀幹與野豬肩胛需有不同節拍，避免像單一硬塊平移。衝鋒時可加 1 px 上下震幅，不可移動基準點。

### 5.7 `heavy_crossbow` 動畫

| state | frames | FPS | loop | event frame |
|---|---:|---:|---|---|
| `idle` | 8 | 6 | 是 | `winchCheck@5` |
| `walk` | 8 | 8 | 是 | `footL@1, footR@5` |
| `attack` | 14 | 11 | 否 | `standOpen@2, draw@5, projectile@8, recoil@9, standClose@13` |
| `hurt` | 4 | 11 | 否 | `flinch@0` |
| `death` | 12 | 9 | 否 | `crossbowDrop@4, collisionOff@8` |
| `cast` | 12 | 10 | 否 | `stakeLoad@3, projectile@7, pinCue@8, recover@11` |

重弩箭離膛前弩臂要有至少 3 frames 的彎曲累積，不能只靠命中特效表現威力。

七職業合計：2,310 個角色 frames（未含投射物、陰影、UI portrait）。這是完整製作量，不得以同一張姿勢換武器假裝不同職業。

## 6. 外怪設計（首批三種）

| ID／名稱 | 輪廓與材料 | 戰場行為／美術 cue | frame／基準 | 色彩 |
|---|---|---|---|---|
| `miremaw` 沼牙獸 | 六足低身、鏟形下顎、背部三個蘆葦囊；皮膚像濕陶，不做一般巨狼 | 潛伏前蘆葦囊依序縮下；撲咬時鏟顎張成扁菱形；怕遠距穿刺 | 128×128；`(64,101)`；影 50×18 | 泥綠 `#586B4E`、陶灰 `#777062`、囊黃 `#A79855` |
| `ashwing` 燼翼獵獸 | 四足獸體加兩片破扇形皮翼、鳥喙與蜥蜴尾；不是龍或獅鷲 | 會越過前排撲後排；起飛前雙翼像風箱壓縮；落地有三角灰塵 | 144×144；地面 anchor `(72,116)`；影依高度 30–56×12–20 | 炭黑 `#302F2C`、燼紅 `#8C4A3D`、膜灰 `#81766D` |
| `rootback` 根背巨像 | 身體是被根系拉住的三塊頁岩，左右臂不等長，頭部是懸掛陶鈴；不是樹人或石巨人 | 破壞建築；重擊前短臂固定地面、長臂舉岩；受法術時陶鈴發青白裂光 | 160×144；`(80,116)`；影 78×27 | 頁岩藍灰 `#4E5A5B`、根褐 `#5F4935`、苔青 `#70816C` |

### 6.1 外怪動作表

| monster | state | frames／facing | FPS | loop | event frame |
|---|---|---:|---:|---|---|
| 沼牙獸 | `idle/walk/attack/hurt/death/cast` | `8/10/10/4/12/12` | `6/12/14/12/9/10` | 前二者是 | `attack hit@6; cast submerge@4, emergeHit@8; collisionOff@9` |
| 燼翼獵獸 | `idle/walk/attack/hurt/death/cast` | `8/8/10/4/10/10` | `7/13/15/13/10/12` | 前二者是 | `attack hit@6; cast takeoff@3, diveHit@7; collisionOff@7` |
| 根背巨像 | `idle/walk/attack/hurt/death/cast` | `8/10/12/4/14/14` | `5/8/11/10/8/9` | 前二者是 | `attack hit@8; cast telegraph@4, slamHit@10; collisionOff@11` |

三種外怪都要完整六方向，共 1,008 frames。`ashwing.walk` 代表地面跳步；飛行循環另由 `cast` 起飛後切到 8-frame `fly` overlay，首批可作為額外 48 frames，不得拿地面 walk 直接上移代替。

## 7. 投射物與命中特效

投射物的視覺位置由伺服器／模擬命中事件驅動，畫面補間不改變傷害結果。所有 `spawn` 時機都對應角色 animation event。

| asset ID | canvas | 方向／frames | FPS／loop | 要求 |
|---|---:|---|---|---|
| `proj_arrow` 普通箭 | 32×16 | 六方向 × 4 flight | 18／是 | 柳木桿、雙羽；4 frames 只做 1 px 振動，不讓箭頭轉圈 |
| `proj_shadow_arrow` 縫影箭 | 40×24 | 六方向 × 6 flight | 18／是 | 雙結箭尾，後方拖兩段不連續墨影；不可做雷射線 |
| `fx_arrow_hit` 箭命中 | 32×32 | 6 | 20／否 | 木屑 3 塊 + 1 根折羽；命中盾牌改用 `fx_shield_chip` |
| `proj_musket_trace` 火槍彈道 | 32×16 | 六方向 × 3 | 24／否 | 彈丸本體只占 2 px；短赭線 2 frames，不能跨越整個畫面 |
| `fx_muzzle_smoke` 槍口煙 | 64×64 | 六方向 × 8 | 20／否 | 先白灰小叉，再分成三個方圓煙團；alpha 由 80% 降到 0 |
| `fx_musket_hit` 火槍命中 | 48×48 | 8 | 22／否 | 銅白火星 4 枚 + 灰塵；盔甲命中另帶 2 px 黑凹痕 |
| `proj_arcane_cinder` 法術彈 | 48×48 | 六方向 × 8 | 16／是 | 外層灰燼逆時針、內焰順時針；中心不可純白大光球 |
| `fx_arcane_hit` 法術命中 | 80×64 | 10 | 18／否 | 斷裂六角線從內向外錯位展開，最後留下 2 frames 灰燼 |
| `proj_heavy_bolt` 重弩箭 | 48×24 | 六方向 × 4 | 16／是 | 粗方桿、方尾羽；飛行振幅小於普通箭，命中前不旋轉 |
| `fx_bolt_hit` 重弩命中 | 64×48 | 8 | 18／否 | 先 1 frame 方形震圈，再出木／甲碎片；大型目標保留插入箭 20 ticks |
| `fx_melee_slash` 近戰命中 | 48×48 | 六方向 × 5 | 22／否 | 2–3 塊斷裂刃風，顏色依武器不依隊伍 |
| `fx_boar_dust` 野豬衝鋒 | 64×48 | 六方向 × 8 | 16／否 | 左右兩列泥塊，中心保持乾淨以看清騎士基準點 |

所有方向性投射物都要以相同基準中心製作。禁止用 Canvas 任意旋轉一張像素箭，因為 2:1 像素會糊；只有連續軌跡粒子可由程式旋轉。

## 8. Sprite atlas 與 Phaser 契約

### 8.1 來源與輸出

```text
assets/source/concepts/{unitId}/...
assets/source/sprites/{unitId}/{facing}/{state}/frame_00.png
assets/source/effects/{effectId}/{facing?}/frame_00.png
apps/client/public/assets/atlas/units/{unitId}/{unitId}.json
apps/client/public/assets/atlas/units/{unitId}/{unitId}_0.png
apps/client/public/assets/atlas/effects/combat_fx.json
apps/client/public/assets/atlas/effects/combat_fx_0.png
```

概念圖、生成候選與最後手修 sprite 必須分開。遊戲 runtime 只載入最後核准的 atlas；不得把生成用大圖或參考圖打包進 production。

### 8.2 Frame 命名

```text
unit_{unitId}_{skinId}_{facing}_{state}_{frame:02}
monster_{monsterId}_{facing}_{state}_{frame:02}
proj_{projectileId}_{facing}_{state}_{frame:02}
fx_{effectId}_{facingOrOmni}_{state}_{frame:02}
```

範例：

```text
unit_mage_base_ne_attack_06
unit_boar_rider_base_sw_cast_07
monster_rootback_w_death_11
proj_heavy_bolt_se_flight_02
fx_muzzle_smoke_nw_burst_04
```

Phaser animation key：

```text
unit.{unitId}.{state}.{facing}
monster.{monsterId}.{state}.{facing}
proj.{projectileId}.flight.{facing}
fx.{effectId}.{state}.{facingOrOmni}
```

例如 `unit.mage.attack.ne`、`monster.miremaw.walk.sw`。動畫建立時必須從本文件讀取 FPS、repeat 與 event frame；`loop = 是` 對應 `repeat: -1`，其他為 `repeat: 0`。

### 8.3 Packing 規則

- 格式：Phaser multiatlas JSON Hash + RGBA8888 PNG，sRGB，straight alpha。
- 一般人形每職業以 1 張 2048×2048 為目標；如超出則依 `move`（idle/walk）和 `combat`（其餘）拆頁。野豬騎士與大型怪固定使用 2 頁，不准把 frame 縮小硬塞。
- `trim: true`，但 JSON 必須保留 `sourceSize`、`spriteSourceSize` 與自訂 `pivot`。pivot 由第 2.1 節未裁切基準點計算，所有 frame 相同。
- 相鄰 frame padding 4 px、texture edge border 4 px、color extrude 2 px。透明區 RGB 清為 `0,0,0`，避免彩色 alpha fringe。
- 禁用 atlas mipmap；Phaser texture filter 使用 `NEAREST`。禁止 JPEG、WebP lossy 與自動色彩平滑。
- 單張 atlas 不超過 2048×2048，以相容中階行動 GPU；啟動畫面只載入選定村莊的共用核心單位，外怪依波次 lazy-load。
- 每頁另輸出 `*.manifest.json`，記錄 source commit、生成／手修工具、作者、日期、frame count、授權 `project-original` 與 SHA-256。
- Team-color mask 優先放獨立同尺寸 atlas；若採 palette swap shader，mask index 必須由測試驗證，不可用近似 RGB 搜尋。

### 8.4 動畫事件契約

Phaser 不可用「動畫播放完畢後猜命中」。animation event 僅負責視覺，權威模擬事件決定實際命中；兩者用以下標籤對齊：

```text
projectile, meleeHit, aoeCommit, muzzle, guardActive,
chargeActive, collisionOff, footL, footR, recover
```

當網路快照比動畫快時，可縮短 recover frames，不可提前 `projectile` 或 `meleeHit`；當快照較慢時停在 telegraph hold frame，避免先播命中。

## 9. Imagegen 專案提示詞組

以下提示詞只用於產生本專案的原創候選。順序固定為「概念總表 → 單角色六方向 → 動作 key pose → 像素 atlas → 特效」。**概念未經美術主管核准，不得直接生成 atlas。** 生成結果不是可直接發布資產；仍須逐幀手修、對齊與技術 QA。

### P0 — 七職業概念總表（第一張必做）

```text
Create an original production concept lineup for the game project “Village Siege”, a frontier medieval-fantasy isometric RTS. Show exactly seven distinct full-body classes standing on one neutral lime-plaster studio ground, evenly spaced, no text and no logos: ash-ring mage, willow-bow archer, black-powder musketeer, broad-blade warrior, wicker shieldbearer, low boar rider, winch heavy-crossbow operator. Use 4.5-head human proportions, enlarged hands and feet for RTS readability, practical wool, linen, worn leather, willow wood, blackened iron and sparse copper rivets. Every silhouette must be recognizable at thumbnail size. Give each class one asymmetric signature item exactly as specified in the Village Siege art bible. Palette: charcoal outlines, aged lime neutrals, restrained profession accent colors; leave clearly placed neutral-blue team-color cloth zones. Original design only. Do not imitate or reference Age of Empires II or any existing commercial game, character, faction, UI, shield emblem, color arrangement or asset. No gothic title art, no heraldic crest, no ornate gold armor, no photorealism, no chibi proportions. Clean concept-art finish, orthographic readability, consistent scale, soft neutral lighting, generous empty margin around every figure.
```

驗收後把核准圖鎖為 `concept-lineup-v01`，後續提示詞都以它作為 referenced image；不得讓模型重新發明服裝。

### P1 — 三外怪概念總表

```text
Create an original creature lineup for “Village Siege”, on a neutral lime-plaster studio ground, no text, no logos. Show exactly three frontier monsters at comparative scale: Miremaw, a low six-legged wet-clay beast with a shovel jaw and three reed sacs; Ashwing Hunter, a four-legged charcoal predator with two broken fan-shaped skin wings, a birdlike beak and a lizard tail, explicitly not a dragon or griffin; Rootback Colossus, three offset slabs of blue-gray shale bound by roots, unequal arms and a small hanging ceramic bell instead of a conventional face, explicitly not a tree person or standard stone golem. Strong distinct silhouettes, practical natural materials, 4-value pixel-art-ready color groups, readable in an isometric RTS. Original project design only; do not imitate any existing game monster or franchise. No text, no UI, no scenery, no dramatic perspective, no hidden limbs.
```

### P2 — 單一角色六方向 turntable（每職業與外怪各跑一次）

```text
Using the approved Village Siege concept as the exact design reference, create a strict six-view production turnaround of [SUBJECT_ID]: E right profile, NE rear-right three-quarter, NW rear-left three-quarter, W left profile, SW front-left three-quarter, SE front-right three-quarter. Keep identical body proportions, costume, weapon length, material placement and team-color zones in every view. The camera is fixed for a 2:1 isometric RTS, with no foreshortened dramatic lens. Feet touch the same baseline; include all limbs and equipment; preserve asymmetry instead of mirroring. Neutral transparent-looking checker-free light background, no cast shadow, no text, no labels, no UI. Original Village Siege design only. Output is a turnaround reference, not a sprite sheet.
```

`[SUBJECT_ID]` 依序替換為：`mage`, `archer`, `musketeer`, `warrior`, `shieldbearer`, `boar_rider`, `heavy_crossbow`, `miremaw`, `ashwing`, `rootback`。每次只處理一個 subject。

### P3 — 動作 key pose 表（atlas 前置）

```text
Using the approved Village Siege [SUBJECT_ID] turnaround as an exact reference, create clean animation key poses for one facing only: [FACING]. Show six separated pose groups with generous margins: idle extreme, walk contact and passing, basic-attack anticipation and release/contact, hurt recoil, death key stages, special-skill cast anticipation and commit. Preserve the exact costume, handedness, weapon mechanics, proportions and ground anchor. Make action arcs and weight transfer physically understandable at small RTS scale. No text, no labels, no effects that hide the body, no extra weapons, no background scene. This is an original production pose sheet, not final sprites and not an existing game style.
```

每個 subject 必須先完成 `se` 和 `nw` 兩個 key pose 表以驗證前／後結構；主管通過後才補另外四向。

### P4 — 像素動畫 atlas 候選（概念與 key pose 核准後）

```text
Edit the approved Village Siege [SUBJECT_ID] reference into a native-resolution pixel-art animation candidate for facing [FACING] only. Exact frame canvas: [CANVAS_PX]. Fixed 2:1 isometric camera and fixed foot anchor [ANCHOR_PX]. Arrange clearly separated frames on a transparent background in this exact action order: idle [N] frames, walk [N] frames, attack [N] frames, hurt [N] frames, death [N] frames, cast [N] frames. Use hard pixel edges, no antialiasing, no blur, no gradients, 1–2 px charcoal outer contour, three main value bands plus one metal highlight. Preserve all asymmetric equipment and the exact four-index team-color regions. Keep every body part inside its cell and keep the anchor stable. Do not add text, grid numbers, scenery, shadows, UI, logos or borrowed motifs. This is a draft for manual frame cleanup; visual continuity and readable motion matter more than illustration detail.
```

注意：圖像模型通常不能保證精確 frame count。輸出只作 interpolation 候選，實際 atlas 必須由像素美術工作員依第 5、6 節逐格切分、補幀和校正；不得未檢查直接匯入遊戲。

### P5 — 投射物與命中特效表

```text
Create an original pixel-art VFX production sheet for Village Siege on transparent background, fixed 2:1 isometric view, hard pixels, no antialiasing. Include separated sequences with no text: willow arrow flight and splinter hit, short black-powder tracer, fork-shaped muzzle flash followed by three blocky gray smoke puffs, gray-ash arcane cinder with broken hexagonal impact, square-shaft heavy bolt and square shock impact, broken-piece melee blade wind, and two-row boar charge dirt. Use the exact canvas sizes, six facing variants and frame counts from the Village Siege art bible. Restrained charcoal, ash white, copper spark, mud brown and desaturated arcane teal; no neon beam, no circular magic sigil, no lens flare, no photoreal smoke, no UI.
```

## 10. 製作關卡與 QA checklist

### Gate A — 概念主管審核

- [ ] 七職業放在純黑剪影與 64×64 thumbnail 時可不靠顏色辨認。
- [ ] 三外怪的身體結構、移動方式與攻擊前搖彼此不同。
- [ ] 每個角色的武器、材質與偏心裝備符合第 5 節，沒有臨時添加的皇冠、徽章或金甲。
- [ ] 六方向結構一致，左右不對稱裝備沒有因鏡射換手。
- [ ] 完成 originality review：沒有可辨識的商業遊戲角色、UI、盾徽、色組或動畫姿勢。

### Gate B — 動畫主管審核

- [ ] 每個 state、每個 facing 的 frame 數、FPS、loop 與 event frame 和本文一致。
- [ ] 100% 尺寸播放時，idle、walk、attack、cast 能在 1 秒內辨識。
- [ ] 腳底 anchor 漂移符合第 2.1 節；walk contact 沒有溜冰，boar 四足節奏正確。
- [ ] 攻擊前搖會改變輪廓；projectile／meleeHit frame 前不出現命中特效。
- [ ] hurt 不以整張白閃代替動作；death 最後姿勢不遮住相鄰一整格。
- [ ] 六向 attack 的武器尖端世界位置誤差不超過 3 px，投射物 spawn 不跳動。

### Gate C — 技術稽核

- [ ] 每個 frame 名稱、Phaser key、方向 suffix 與 manifest 可由腳本驗證，無重名或缺號。
- [ ] PNG 是 RGBA8888、straight alpha、透明 RGB 清零；沒有白邊、黑邊或半透明髒點。
- [ ] padding 4 px、border 4 px、extrude 2 px；NEAREST 顯示時無相鄰 frame bleed。
- [ ] trim 後 `sourceSize`、`spriteSourceSize`、pivot 正確；六向切換不跳腳。
- [ ] Team-color mask 只覆蓋指定區域；至少以兩個極端隊色測試可讀性與色盲模式。
- [ ] atlas 每頁不超過 2048×2048；manifest 包含 SHA-256、作者、日期、來源與 `project-original`。
- [ ] 100 個同屏單位含陰影與投射物，在目標瀏覽器維持規格要求，沒有每幀新建 texture。

### Gate D — 遊戲內稽核

- [ ] 1280×720、1600×900、1920×1080 三尺寸實機截圖均能辨別七職業。
- [ ] 灰階、紅綠色弱模擬與戰爭迷霧下，敵我和職業仍可由形狀判斷。
- [ ] 盾陣、火槍、法術、衝鋒、重弩的 telegraph 不被 HUD、樹冠、建築或其他特效遮掉。
- [ ] 投射物方向和目標一致；移動 facing 量化不在路徑小修正時頻繁抖動。
- [ ] 特效消失後不殘留 emitter、timer、atlas reference 或不可回收的暫存 texture。
- [ ] 主管核准截圖、稽核紀錄與壓縮交接寫入 audit；一次性生成候選、切圖暫存與未採用 atlas 經精確路徑確認後清除。

## 11. 完工定義

本美術線只有在以下條件全部成立時才算完工：七職業與三外怪完整六方向、所有指定 state 與 event frame 齊備；五類主要投射物及命中特效可在 Phaser 中按權威事件播放；隊伍換色、方向映射、pivot、alpha bleed、效能與原創性 QA 全數通過；主管批准後由獨立稽核重跑清單並輸出壓縮交接。只有概念圖、單張立繪、程序幾何占位或缺少方向／動作的 sprite，都只能標記為 `prototype placeholder`，不能宣稱角色美術完成。
