# 1.0 公開單機版驗收

2026-10-01。App 1.0.0、rules village-siege/0.20.0、network village-siege-network/4。

本次交付電腦、手機和平板瀏覽器單機與離線 PWA。Android／iOS 簽署 App、公開多人服務及劇情戰役依[完整更新計畫](REBUILD_ROADMAP_2026-09-30.zh-TW.md)推進。

## 發展與勝負

| 項目 | 實際結果與驗證方式 | 證據 |
| --- | --- | --- |
| 完整經濟與科技 | 標準均衡 AI、正常資源、四條預設勝利規則全開；合法玩家命令完成兩次升階、七科技、七兵種。沒有加錢、停 AI、改戰局或強制勝利。tick 8356，存檔及重播 hash 1da82903。這是模擬驗收。 | [完整發展](evidence/r24/full-progression-playthrough.json) |
| 四條勝利 | 從合法完整發展戰局，分別以中域控制、拓界標、征服、殲滅勝利；各分支重播 hash 一致。 | [四勝途](evidence/r24/full-progression-victories.json) |
| AI 發展 | 五種性格乘三種難度共十五組有界發展回歸。十四組完成升階與偏好軍隊；老練進攻型在升階前合法擊敗玩家。不是所有配對的長期平衡驗證。 | [AI 矩陣](evidence/r24/ai-progression-matrix.json) |
| 施工接續 | 保留已發布 0.22.1 操作；新規則回歸驗證多工地接續、進度、已付材料、完工及 AI 接續。 | constructionResume.test.ts、ai.test.ts |

## 玩家操作

| 項目 | 實際操作結果 | 證據 |
| --- | --- | --- |
| 科技入口與條件 | 常駐「科技與時代」。兩次升階與七科技均顯示成本、建築、前置、研究及完成狀態。四尺寸控制可達且至少 44 CSS px；開啟與關閉恢復原暫停狀態。 | [最終版面](evidence/r24/final-panel-layout.json)，[1280×720](evidence/r24/final-panel-1280x720.png)、[844×390](evidence/r24/final-panel-844x390.png)、[568×320](evidence/r24/final-panel-568x320.png)、[667×375](evidence/r24/final-panel-667x375.png) |
| 升階與七科技 | 桌機與觸控經生產建築按鈕完成兩次升階、七項付費研究；另以最終 1.0 科技面板實點升階、研究及完成。經濟準備使用合法付費命令與正常模擬更新。 | [桌機完整研究](evidence/r24/desktop-complete-ui.json)、[觸控完整研究](evidence/r24/phone-complete-ui.json)、[最終面板研究](evidence/r24/final-native-research-autosave.json) |
| 七兵種與七技能 | 各建築實點付費訓練七兵種；最終 1.0 桌機滑鼠及 844×390 Chromium 觸控各實點七技能，回執 accepted，沒有頁面錯誤。指定單位的技能先用正常移動疏散擋路友軍。 | [訓練](evidence/r24/train-seven-desktop.json)、[最終技能](evidence/r24/final-player-abilities.json) |
| 外怪攻擊 | 選軍隊直接點中立外怪，實際產生 accepted 的 attack。 | [桌機與觸控外怪操作](evidence/r24/final-player-abilities.json) |
| 框選 | 最終版按 Shift 拖曳實際選中三名工匠；前後鏡頭位置一致，普通拖曳平移仍保留。 | [框選操作](evidence/r24/final-shift-box.json)、[畫面](evidence/r24/final-desktop-shift-box.png) |
| 自動存檔與繼續 | 研究中退出，再點「繼續戰役」。退出、IndexedDB、恢復戰局同為 tick 2714，snapshot hash 0cc153b9、continuation hash 3088eb26；研究剩餘 269 ticks 與錢包一致，續玩後研究完成。 | [最終研究與續玩](evidence/r24/final-native-research-autosave.json) |
| 勝利與再戰 | 桌機與觸控正常匯入已驗證的中域勝利重播，兩端 tick 8941、hash 535da733，顯示正確勝利與原因；實點下載重播、返回及再戰。再戰 tick 0、playing，保留均衡／標準設定。 | [終局操作](evidence/r24/final-result-ui.json)、[桌機](evidence/r24/final-desktop-result.png)、[觸控](evidence/r24/final-phone-result.png) |
| 存檔錯誤恢復 | 無效新檔不覆蓋原戰局；儲存被拒不打斷遊戲；損壞 slot 可恢復有效備份並再次儲存，舊快照不能覆寫較新戰局。 | autoSave.test.ts、villageAssaultRuntime.test.ts、persistence.test.ts |
| 舊版相容 | 真實 0.22.0／0.22.1 檔先依原規則驗證，再轉為 0.20；保留採集量、錢包與施工，補足新增可採量。損壞 hash 仍拒絕，原始檔不改寫。 | persistenceCompatibility.test.ts 與舊版 fixtures |
| 教學 | 七段目標與玩家命令證據有回歸。公開 0.22.1 已實點教學入口、採集卸貨、匯入匯出及離線；1.0 升階、研究、兵種、技能另經上述 UI 驗證。本輪未宣稱從頭至尾只用滑鼠跑完七段教學。 | tutorialProgress.test.ts、[公開教學基準](evidence/r24/public-tutorial-baseline.png) |
| 離線 | 公開 0.22.1 下載完成後，斷網重載並進入戰場成功；最終 1.0 經相同 PWA 產包與完整性驗證。 | [公開離線基準](evidence/r24/public-offline-baseline.png)、[正式包驗證](evidence/r24/runtime-final.log) |

手機操作證據來自 Chromium 觸控模擬；實機 Safari、Android 各廠裝置與商店簽署驗證屬 App 發布階段。

## 工程閘門

npm run verify 通過：client 143、server 86、shared 262、ops 21，共 512 項；typecheck、美術契約及三個 workspace 正式建置完成。[執行紀錄](evidence/r24/verify-final.log)

依 Pages 工作流剔除 build-only 原圖後，正式包 50 檔、9,708,422 bytes；原創 runtime PNG 35 檔、7,321,143 bytes。85／85 素材 hash、授權與秘密掃描通過，正式依賴漏洞為零。[包驗證](evidence/r24/runtime-final.log)、[依賴稽核](evidence/r24/audit-prod.log)

獨立上下文讀審發現的自動存檔損壞恢復問題已修正並補回歸；沒有未解來源碼阻斷。[獨立覆核](RELEASE_REVIEW_R24.md)

同一 Windows 主機上，桌機 1280×720 及 Chromium 手機觸控模擬 844×390，各測三次五秒的活動戰場，28–29 個可見實體；rAF 間隔 p95 三跑中位均為 16.8 ms。這是該暖機場景的瀏覽器影格間隔，不能推定所有實機或大型戰場效能。[量測](evidence/r24/final-render-performance.json)

個人存檔、完整重播、內部日誌保留在 Git 忽略的 .audit-tmp/r24；連結的是可公開結果與玩家可見資料。
