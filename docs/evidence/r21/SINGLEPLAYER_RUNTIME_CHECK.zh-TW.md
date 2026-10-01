# R21 單機規則驗證紀錄

2026-09-30 執行。主線效能量測期間停止模擬；收到主線通知效能已完成後，補一個正常移動指令的診斷續跑。最後一個 Node 驗證程序於台北時間 **18:28:39** 結束，耗時 17.569 秒；之後沒有再跑策略。

結果為 **部分規則 VERIFIED，完整勝利流程尚未驗證**。原始事件、指令、資源扣款、checkpoint 與兩條策略的失敗條件保存於 [singleplayer-runtime-check.json](singleplayer-runtime-check.json)。最初兩次設定／路徑失敗另存 `singleplayer-runtime-check-attempt1.json`、`singleplayer-runtime-check-attempt2.json`。

使用公開 `createVillageAssaultRuntime`、`issuePlayerCommand`、`step`；seed `2121`，松林堡玩家對河谷鎮、守備性格、新手 AI。沿用預設四種勝利規則，沒有覆寫控制時間、贈送資源、改動 canonical state、替 AI 投降或偽造終局。資料來自模擬與可見事件，**沒有以此宣稱 UI／手機完整局實玩**。

| 驗證 | 實際證據 | 判定 |
|---|---|---|
| 經濟循環 | tick 0 三條採集命令接受；tick 22 三種資源均有真卸貨；最後累積糧食1080、木材1000、石礦700 | VERIFIED |
| 家屋施工 | tick 22 在 `(3,10)` 接受 build，扣80木材；tick 212 完工 | VERIFIED |
| 真實產兵 | tick 22 兵營接受盾牌手1名、戰士4名；生成 `unit-80`、`unit-82`、`unit-86`、`unit-110`、`unit-125` | VERIFIED |
| 玩家技能 | tick 242 `unit-80` 的 `shieldWall` 命令接受；tick 245 出現己方盾牆 `statusApplied` | VERIFIED |
| 集結路徑 | 初始中域 rally 被拒；採完出口木材後，tick 981 相同目標變成合法，已訓練單位收到 move | VERIFIED；路徑限制有紀錄 |
| 真交戰 | 己方新兵有47個真實受擊事件；tick 1052 `unit-82` 對敵方 `building-53` 造成19傷害，未由畫面代扣 | VERIFIED |
| 聚落升階 | tick 2512 糧517／木1175／石456，命令扣糧500／木300／石100；tick 2962 stronghold 完成 | VERIFIED |
| 銅標建造 | tick 2962 在 `(0,7)` 接受 `copperLandmark` build，扣木210／石260 | EXECUTED；未完工 |
| 正常移動解除堵塞 | tick 3862 接受 unit-35→`(5,8)` 與 unit-80→`(3,9)`；前者確實到達，施工者能繼續移動 | VERIFIED 前者；盾兵仍被靜態占地包圍 |
| 合法勝利、結果、重開 | tick 5062 仍 `playing`、`victory.outcome=null`，沒有達成勝途 | 未驗證 |

全程16條指令接受、2條正常拒絕。拒絕為 tick 22 的初始中域集結，及 tick 212 工匠從施工區改採木材，兩者均是 `TARGET_NOT_REACHABLE`。

第一條策略把新兵逐批送至中域，戰士在攻擊敵城防後於 tick 1120、1141、1250、1410 陣亡，未達到腳本要求「同時有5個存活軍人」。這是該腳本的策略條件失敗；5個新兵確實已生成，不能誤寫成訓練系統沒有產兵。該輪在 tick 1981 保存失敗條件，沒有改規則讓它通過。

唯一的替代勝途繼續同一局，正常採集、完成 stronghold，支付並建立銅標施工實體。tick 3000～3800 每100 ticks的樣本一致：builder unit-34在`(4,6)`，order為construct building-140，銅標remainingTicks始終520；unit-35在`(5,6)`採食。靜態合法施工perimeter只有`(0,6)`與`(0,9)`；BFS選`(0,9)`，距離25，firstStep=`(5,6)`，正好被unit-35占住。這輪沒有選到被牆占住的目標格，而是友軍占住施工者唯一出口。

正常move命令移走unit-35後，builder能出城；tick 3947在`(9,9)`出現unit-34的destroyed事件，生命為0。銅標一直沒有開始扣施工ticks，tick 5062仍未完工。因此後段限制是單一施工者通過敵方有效火力區時陣亡；不能把這段描述成「施工時間不足」或「只要繼續等待即可勝利」。預設90秒控制時間全程沒有改動。

另有可重現的出生格問題：盾兵unit-80停在`(3,5)`，四鄰為`(2,5)`圍牆、`(3,4)`塔、`(4,5)`兵營與`(3,6)`可再生食物節點。`doesEntityBlockMovement`把resource一律視為阻擋，包括等待復育的節點；所以該盾兵收到合法move後仍沒有靜態出口。這應優先修正出生格的可達性選擇，或調整初始建築／資源配置。

後續驗證應先固定安全集結地點，確認部隊整隊後再進攻；地圖需有可施工的安全空間，兵營出生格要能走到有效出口，採集者占住單格通道時須提供手動提示或可驗證的自動讓路。完成一條真正勝途後，再驗證結果presenter與UI的再戰／返回操作。本輪不能用已有勝利單元測試或任何直接改狀態的測試補稱完整局通過。

最後的owner-private存檔在`.audit-tmp/r21-gameplay-final-owner-private-save.json`，可依版本化importSaveJson接續診斷，不必重跑開局。該檔含迷霧與AI權威資料，只留本機，不作公開玩家snapshot。此次臨時runner為`.audit-tmp/r21-gameplay-check.mts`；本輪沒有修改runtime或加入遊戲功能。
