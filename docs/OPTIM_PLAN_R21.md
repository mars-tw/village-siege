---
goal: Village Siege R21 原創半手繪視覺與跨裝置可玩切片
version: 1.0
date_created: 2026-09-30
last_updated: 2026-09-30
status: Executed slice; full release gates remain tracked
---

# Village Siege R21 八面向優化計畫

R21 範圍是原創半手繪入口、建築與場景素材、按鈕／選單密度、PWA 基礎及可驗證的玩法改善。現成角色真影格先保留，完整人物動畫、戰役、公開多人與 Android／iOS 商店交付由[完整更新路線](REBUILD_ROADMAP_2026-09-30.zh-TW.md)安排。

清單依本機 `game-optimization-round/SKILL.md` 的八項命名。基準套件 `0.20.0`，commit `f4489e310c783731508d6b98cbedb8c3a41b8e3e`。實作與檢查結果由 docs/CODEX_RESPONSE_R21.md 及 evidence 記錄；後續完整遊戲閘門維持獨立追蹤。不可把 `Planned`、已生成候選或檔案存在改成 `VERIFIED`。

## 八面向施工與驗收

| ID／面向 | 本輪施工 | 可驗收證據 | 保留差距 |
|---|---|---|---|
| R21-01 美術 | 主選單換原創點陣村落；暖白／陶紅／松綠／河藍／銅色統一；建築主視覺走正式 PNG／WebP | 主選單、近景、遠景 before／after；來源與 sha256 登記；runtime 無 SVG／候選大圖 | 完整七兵種與三外怪的新畫風及長動畫屬後續素材輪 |
| R21-02 按鈕 | 主行動、取消、返回常駐；窄高度與 safe area 重新排版；命中區 ≥44 CSS px | `1366×600`、`1280×640`、`844×390`、`390×844` 控制矩形及操作；無重疊、遮擋、需捲動才開始 | 真機地址列／瀏海／125% 縮放須另外實測 |
| R21-03 選單 | 村莊、AI 與玩法選擇分區，操作／PWA 提示短而清楚；系統頁可關閉及返回 | 主選單→教學／單機→系統→戰場→結果→回選單；鍵盤焦點與觸控全程可達 | 尚未做完的戰役、排行及多人不放假入口 |
| R21-04 人物 | 保留戰士、弓箭手、持盾槍衛六向真影格；新地形上調可讀性、選取與隊伍辨識 | 64px 裁圖、近／中／遠距和黑霧邊緣截圖；眼／眉／臉與武器剪影可辨 | 工匠仍共用戰士；4 兵種與3外怪缺完整獨立六方向 |
| R21-05 地圖模型 | 新建築依 shared footprint 對齊；地形、資源及裝飾有真實材料與層次；不得換色占位 | 14 類 building registry／atlas 對照；兩軸城門、開關、施工、受損、殘骸；合法通路與格位截圖 | 若本輪只完成部分素材，逐個列已接入與缺件，不能稱全地圖重建 |
| R21-06 技能 | 7 兵種技能可看懂、冷卻與瞄準狀態清楚；觸控取消不消耗；效果依權威事件 | 每種技能的準備／確認／取消／命中／冷卻截圖與 test；阻擋或死亡時無錯扣 | 正式點陣技能圖示、音效若未產出即明列；不靠文字冒稱美術完成 |
| R21-07 角色樣子 | 檢查現有角色與新環境亮度／飽和／輪廓；保留三主色＋亮點色 | 固定可見像素測量：亮度0.30～0.75、近黑<35%、飽和≥0.32、低飽和<20%；正／側／背與64px檢視 | 本輪未重新產角色；缺方向的背面／三視圖不得以鏡射補驗，標缺件 |
| R21-08 動作流暢度 | 保留真影格；走路交替、攻擊蓄力／命中／收勢；呈現與權威 impact tick 對齊 | 走／攻／施法／受擊／死亡錄影與圖集 validator；揮空零傷、死亡播完回收、低畫質仍真影格 | 目前4格動作仍可能急促；升至較長影格與全部獨立方向排後續，不以位移縮放冒充 |

角色色彩數值取 alpha ≥128 的像素，RGB 正規化到0～1；亮度 `L=0.2126R+0.7152G+0.0722B`，近黑 `L<0.10`；HSV 飽和 `S=(max-min)/max`（max=0 時 S=0），低飽和 `S<0.20`。若本輪未跑測量，狀態寫待驗證。多人與單機傷害都由 shared simulation 決定，客戶端動畫只匹配命中 tick；八面向中的「命中幀」不得解釋為瀏覽器自行提交傷害。

## 執行順序

| 任務 | 指定檔案／成果 | 依賴 | 狀態 |
|---|---|---|---|
| TASK-001 | 讀 baseline、`docs/evidence/frontier/` 保存主選單與戰場 before；記錄裝置與版本 | 無 | EXECUTED，入口before；戰場舊圖另有歷史證據 |
| TASK-002 | 產生點陣入口／建築／地形候選，寫 provenance 與素材契約 | TASK-001 | VERIFIED，本輪範圍 |
| TASK-003 | `VillageSelectScene.ts`、`style.css` 入口與 RWD 改造 | TASK-002 的入口圖 | VERIFIED，本輪範圍 |
| TASK-004 | `villageAssaultArt.ts`、asset manifest、Phaser preload 接入核准建築 | TASK-002 的 atlas | VERIFIED，本輪範圍 |
| TASK-005 | `VillageAssaultScene.ts` 操作／玩法改善；shared 更動保持 rules／replay | TASK-001 | VERIFIED，本輪範圍 |
| TASK-006 | Manifest、PNG icons、Service Worker、PWA 安裝／離線與更新流程 | TASK-003、TASK-004 | VERIFIED，本輪範圍 |
| TASK-007 | 既有 CI、素材、RWD、觸控完整局、PWA、效能與秘密掃描 | TASK-003～TASK-006 | 部分VERIFIED；真機與完整觸控局待驗 |
| TASK-008 | `docs/CODEX_RESPONSE_R21.md` 寫實測、對照圖、缺件、支援範圍；版本一致與本機交付 | TASK-007 | 本機交付，見最終報告 |

上表只更新實際完成的本輪項目；完整出貨閘門與缺件仍照下表追蹤。沒有 `docs/AUDIT_full.md` 或專案 `AGENTS.md` 可讀，故本輪以用戶指令、共用核心規則、實際程式與既有 audit 為準。

## 固定工程閘門

| 閘門 | 執行與證據 | 判定方式 |
|---|---|---|
| GATE-01 回歸 | `npm run verify`，另依 CI 跑 `validate:compliance`、`prune:runtime-art`、`validate:runtime-assets`、`audit:prod` | 每項 exit code 0；保留失敗片段與修正結果；缺 runner 不能稱 E2E 已過 |
| GATE-02 控制可達性 | 9 視口：1920×1080、1366×600、1280×640、1024×768、1366×1024、568×320、667×375、844×390、390×844 | 開始／返回／取消／主要指令在畫面內，≥44px，不重疊、不被遮擋；至少桌機／手機／平板三張截圖 |
| GATE-03 無 SVG | 搜尋 runtime 檔案、副檔名、`<svg`、`data:image/svg` 與載入引用，排除套件文件後檢視 | 遊戲素材／UI 零 SVG；Canvas／CSS 控制裝飾允許，人物與建築不能用程序素體代替 |
| GATE-04 完整局 | 電腦鍵鼠與觸控各啟動、採集、施工、產兵、技能、合法勝利、結果與重開 | 記 seed／村莊／AI／時長與錄影；只載入主選單不算可玩验證 |
| GATE-05 動畫 | `npm run validate:directional-art`＋遊戲內6動作與6方向檢查 | 已有3個六向角色不能退化；其餘缺件保留實情；掉幀與生命同步另查 |
| GATE-06 效能 | 乾淨機況、前景60Hz、固定負載、每裝置3跑；p95取三跑中位 | 桌機／真手機p95≤18ms；記裝置、entity count、取樣期。未有真手機即待驗證，不能用模擬視口代替 |
| GATE-07 版本與秘密 | 根／workspaces／lock／release對應同步；掃描未追蹤與tracked文字的key形態，排除.git／node_modules／build輸出 | runtime版本一致；歷史CHANGELOG／audit保留舊版記錄；秘密零命中，不回顯疑似秘密 |
| GATE-08 PWA | 子路徑、PNG192／512、install、offline、cached assets、更新後一局、舊存檔拒載 | 真HTTPS或localhost測；首載斷網、重新開啟和完整局成功，不能只驗證SWregistered |
| GATE-09 多人 | 只有本輪涉及shared／network時補local／recovery／adverse；公開WSS另列live gate | 單機改版不能宣稱多人公開上線；visible snapshot不得洩漏canonical state |
| GATE-10 交付 | before／after、量測JSON、console與命令輸出入`docs/evidence/frontier/`；本機commit、繁中訊息 | local-only；公開推送／部署另記真實授權、操作與URL，未做保持未發布 |

`game-optimization-round` 的歷史總稽核／Grok 路線與「舊版號歸零」不應覆蓋目前核心規則或刪除真實歷史紀錄。本輪依核心規則保留本機交付；實際版本引用需一致，歷史audit／CHANGELOG照留。獨立覆核只記真正執行的context／工具結果，不把同一人自審寫成第三方通過。

## 素材與外部條件缺件表

| 項目 | R21 處理 | 完整遊戲的下一步 |
|---|---|---|
| 工匠專屬動作 | 保留共用動畫，明確標示 | 6方向採集／搬運／施工／修理／受擊／死亡 |
| 法師／火槍／野豬騎士／重弩 | 保留現有真影格母版 | 各6獨立方向，增加蓄力與收勢姿勢 |
| 3外怪 | 保留既有規則與母版 | 六向動作、不同剪影及行為特效 |
| 新建築／地形 | 首輪產生並接入實際完成素材 | 14類、多狀態、3地圖環境過渡，完整registry核對 |
| 三視圖與色彩量測 | 本輪若無原始圖與runner則待驗證 | 固定腳本與正／側／背畫廊，不用runtime鏡射補造型 |
| 手機p95、真機Safari／iPad | 先做視口與輸入驗證 | 乾淨真機3跑、背景恢復與地址列／safe area |
| PWA可靠續玩 | R21加入基礎後實測 | 原子存檔、cache版本、失敗下載與舊版相容政策 |
| 公開多人 | 不假設主機已開通 | 長期WSS、兩真裝置完整局、監控／還原live gate |
| Android／iOS App | 只規劃原生路線，未產binary不得稱App | Capacitor、Android工具鏈、Mac／Xcode、真機、簽署與商店beta |

R21 最終報告必須逐項指出：本輪已改善、沿用、待驗證或缺件。八面向都被檢查，與八面向全部達到完整遊戲品質，是兩個不同交付狀態。
