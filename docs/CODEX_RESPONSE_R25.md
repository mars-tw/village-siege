# R25：三位 AI 實玩後的深度優化

2026-10-01。App 1.1.0，rules village-siege/0.20.0，network 4。基準為公開 1.0.0／90e2a412；本輪完成真實遊玩、來源修正、重新遊玩與正式驗證。

## 體驗結果

| AI 身分 | 真正遊玩 | 修改後觀察 |
| --- | --- | --- |
| 桌機新玩家 | 公開版從新局玩到 581 秒實際戰敗；牆鐘 14:48。修改版再次正常玩逾八分鐘，並重驗每次訓練、建造、升階與自己的存檔。 | 娛樂主觀分數 5→7，操作因果 4→8；可分配三種採集、首波前出兵，點主城不再打斷施工。 |
| 觸控策略玩家 | 河谷鎮、標準均衡 AI、844×390 Chromium 觸控；前後均正常實玩逾八分鐘。 | 主觀娛樂 5→7；一糧一木一石成為真正可執行的策略，模式、建造、研究與續玩連成流程。 |
| 視覺玩家 | 公開版正常模擬 776.4 秒；修改版 1380.6 秒，期間真 UI 匯出自己的存檔、重載並匯入接續。 | 房屋／人物尺度改善，近主城工地可放置，城寨與基準法完成；沒有宣稱取得勝利或聽覺品質通過。 |

這是三個獨立 AI 上下文的實際瀏覽器體驗，沒有贈送資源、跳時間、停 AI 或匯入別人的成果。分數屬 AI 主觀意見，不是真人研究。完整紀錄見[桌機 before](AI_PLAYTEST_R25_DESKTOP.zh-TW.md)／[after](AI_PLAYTEST_R25_DESKTOP_AFTER.zh-TW.md)、[觸控 before](AI_PLAYTEST_R25_TOUCH.zh-TW.md)／[after](AI_PLAYTEST_R25_TOUCH_AFTER.zh-TW.md)、[視覺 before](AI_PLAYTEST_R25_VISUAL.zh-TW.md)／[after](AI_PLAYTEST_R25_VISUAL_AFTER.zh-TW.md)。

## 改動由實玩問題決定

- 工匠與步兵原本接近樹高，像巨人站在模型城旁。只縮真圖集的呈現，保留世界錨點、互動容器與真影格；騎兵、攻城物、外怪維持各自剪影。建築血條以原 PNG 的非透明屋頂定位。
- 草地重複接縫與逐格水紋明顯。改用原圖鏡像接邊、多尺度旋轉取樣，僅在水域外邊界畫柔和濕岸；渡口、可走／可蓋格與共享規則不變。
- 全選工匠容易把全部人改派同一種資源。新增原生「工匠分工」，只改派明確點選的個人，顯示活動與攜帶；矮視口一至四人分頁，控制不低於 44 CSS px。
- 綠色工地被透明的 Sprite hit area 攔住。現在按實際格位下令，預覽以唯讀共享檢查判斷材料、占位及工匠可達；完工友方建築的正常點擊改成管理，不暗中改派工匠。
- 新原生代理曾與 Phaser pointer-up 雙派送。實玩重現一 click 變兩項後修正；最終同 tick 7047 的單次訓練只扣糧 50、sequence 9→10、queue 0→1。[精確對照](evidence/r25/visual-after-single-train.json)
- 明確讀回較舊檔被晚寫護欄拒絕自動儲存。僅已驗證的匯入開啟 restore，正常寫入仍守護新檔；實測 latest 3692、previous 10078，續玩後 latest 正常前進，較新備份保留。
- 非按鈕 live region 撐到畫布下方，native focus 把 HUD 捲走；另 667×375 的 Continue 被底部資訊擋住。分別收好 live region、禁止根容器隱藏捲動與重排矮橫向選單。最終三尺寸所有 18 個可見按鈕可達、至少 44px，canvas y=0／scrollTop=0。[矩陣](evidence/r25/touch-final-menu-matrix.json)
- 發展和遇襲不易察覺。新增完工、出兵、升階、研究、卸貨及損失提示；高優先警報不被採集訊息覆蓋。原創短音效需真手勢解鎖，可關閉；沒有冒稱已完成聽覺評測。

## 玩法與視覺

新戰役可選攻城戰或領土爭奪。預設攻城戰須征服或殲滅，避免只站中域過早終局；領土保留原四途。教學仍用領土，舊存檔、重播與再戰保留已驗證的原政策。

原創 [16 格 PNG 指令圖示](../apps/client/public/assets/original/frontier/command-icons.png)以內建 image_gen 生成，原始圖、512px／128px 格 runtime 圖與 metadata 已保存在 apps/client/public/assets/original/frontier。生成器沒有回傳模型 slug，沒有假稱看見指定模型。工匠肖像來自既有六方向真圖集。[提示與處理紀錄](art/frontier/command-icons-r25-prompt.md)

[研究筆記](ART_STUDY_R25.zh-TW.md)以 AoE III 官方開發訪談及 0 A.D. 官方特色為參考。這輪改善了可讀性、操作與策略選擇；有機河岸、高低差、偵察／進攻小情境、原創補給與完整 3D 場景仍在[更新計畫](REBUILD_ROADMAP_2026-09-30.zh-TW.md)，不能把目前等角 2D 遊戲說成已達同等商業內容規模。

## 最終驗證

- npm run verify：157 client、86 server、262 shared、21 ops，共 526 項，typecheck、美術契約與正式建置通過。[紀錄](evidence/r25/verify-final.log)
- 正式 runtime 52 檔、9,934,552 bytes；87／87 素材 hash、36 檔原創 runtime 圖、授權與秘密掃描通過，production audit 零漏洞。[產包](evidence/r25/runtime-final.log)、[依賴](evidence/r25/audit-prod.log)
- 所有體驗停止且無測試並行後，桌 1280×720 及 Chromium mobile 844×390 各三跑五秒活動戰場，rAF p95 中位均 16.8ms；每跑 tick 前進 50／51。[效能](evidence/r25/final-render-performance.json)。手機是觸控模擬；這是暖機場景，不是所有實機／大型戰場保證。
- [獨立最終讀審](RELEASE_REVIEW_R25.md)無未解來源碼阻斷。私有完整存檔、重播、錄影與內部日誌留在 Git 忽略的 .audit-tmp/r25。

本輪用字已依台灣繁中 mode 2 直接校正：舊版「目前 1.0」→「最新 1.1」，避免入口過時；「全部工匠同批採集」→「逐人分工」，對應真功能；「已達 AoE III」不採用，保留實際完成範圍與後續差距。
