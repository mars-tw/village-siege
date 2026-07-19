# 全方位優化與 Grok CLI 稽核｜2026-07-19

## 放行結論

**PASS**。完成版針對手機固定畫面、觸控操作、戰鬥規則、效能、載入、村莊／AI 差異與清理路徑進行整合；Grok CLI 複稽確認指定範圍沒有剩餘 P0／P1。

多人功能仍只放行為房間、準備、開始、重連與權威 tick 原型，不宣稱已完成同步戰場。

## 獨立稽核

- 稽核器：`grok 0.2.101 (5bc4b5dfad) [stable]`
- 基線稽核 session：`019f789d-c20c-7e01-b94b-ee7810678257`
- 完成版複稽 session：`019f78d4-bade-7740-b055-c9511d137473`
- 權限：只開放 `Read,Glob,Grep`，停用 Web、subagents 與 memory。
- 完整性：兩次稽核的前後 `HEAD_UNCHANGED=True`、`STATUS_UNCHANGED=True`。
- 重現完成版報告：

```powershell
grok export 019f78d4-bade-7740-b055-c9511d137473
```

## 稽核後關閉的 P1

1. 重開戰役會保留 `villageId`、`aiPersonality` 與返回場景；568×320 實測重開前後均為「高地寨 vs 侵略者」。
2. 無 Fullscreen API 時，後備滿版改為可逆 toggle；按鈕依序顯示「滿版」與「縮小」，退出後 `game-expanded=false`。
3. 外怪的 food／wood／stone 會累積進雙方戰利帳本、每場歸零並呈現在戰況列，不再只有浮動文字。
4. Canvas 無障礙代理改用面板限定鍵，避免兩個「主命令」；全螢幕只保留右上獨立軍令牌。

## 驗證結果

- `npm run verify`：型別、29 項共享規則測試、前後端正式建置通過。
- `npm run smoke:multiplayer:local`：2 人房、房主權限、ready 驗證、斷線重連與權威 tick 通過。
- Playwright：568×320 橫向選村與三個 Canvas 面板、390×844 直向選村、1366×1024 觸控平板通過；頁面無水平溢位、按鈕不重疊、戰鬥主控台 0 error。
- Fullscreen fallback：以瀏覽器初始化腳本移除所有標準／前綴 API，驗證進入與退出皆通過。
- 戰鬥回歸：修正 `armorIgnore` 只能是 0..1 比例的錯誤，加入 35% 與 60% 穿甲測試。

## 非阻斷限制

- 可玩主路徑仍是烽火台 skirmish，不是含採集、建造、生產、科技與可破壞村莊的完整 RTS。
- 三村／五 AI 是戰鬥數值與決策差異，還不是三套獨立文明、地圖與經濟。
- 多人尚未把共享戰場模擬接上伺服器狀態。
- Phaser 仍集中於大型前端 chunk；戰鬥美術已改為進場懶載，但程式碼分包仍是後續項目。
- 盾牆尚未細分正面 120 度；目前只限制為非奧術遠程傷害減免。
