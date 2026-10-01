# R21 圖像製作與來源紀錄

2026-09-30 使用內建 image_gen 工具產出本專案原創圖像。工具只回傳圖像和儲存路徑，未提供模型 slug，不能宣稱已驗證 gpt-image-2。未使用外部付費 API、第三方遊戲圖包或 SVG。

## 建築圖集

生成規格：4欄×3列等角中世紀邊境建築，原創半手繪材質；上左光源；暖石灰牆、陶紅瓦、橡木、松綠陰影與青藍旗布。依序為 townCenter、house、barracks、defenseTower、lumberCamp、farmstead、archeryRange、mageSanctum、gunWorkshop、beastStable、siegeWorkshop、copperLandmark。不要格線、文字、商標或地面底板，使用真正 alpha。

第二次使用 image_gen 編輯，保持建築身份、次序、材質與透視，修正邊緣色鍵污染和鄰格碎片。最後以 `scripts/prepare-frontier-atlas.mjs --grid` 做可重現的裁格、透明邊緣色鍵清理、連通元件清理、384px格正規化及腳底對齊。

原始來源：`apps/client/public/assets/original/frontier/buildings-source.png`。正式素材：`apps/client/public/assets/original/frontier/buildings.png`。施工鷹架、敵我旗標、受損效果與迷霧記憶由程式疊加。固定旗布不代表所有陣營相同；辨識用獨立旗標與血條。

## 首頁插畫

生成規格：鳥瞰原創河谷村落與山城，右側為豐富城寨、橋、水車、麥田，左側松林留出介面空間；溫暖晨光、松綠深陰影、青藍水面，半手繪策略遊戲插畫。無文字、介面、商標或第三方原作。

正式素材：`apps/client/public/assets/original/frontier/cover.webp`，使用 sharp 壓縮為WebP。這張是入口插畫，沒有冒充實際遊戲戰場。

## 安裝圖示

三張 PNG 由正式圖集的守望塔格裁出，配深松綠背景：192×192、512×512與512×512 maskable。安全區內放完整塔樓。圖示沒有 SVG。

所有正式圖與來源母版的雜湊、大小和 runtime 狀態以 `assets/release-asset-manifest.json` 為準；授權與來源以 `assets/ATTRIBUTION.md` 為準。
