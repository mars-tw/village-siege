# 開源遊戲美術技法研究與R21套用

來源只用於理解技術，不匯入或描摹其素材。

## 0 A.D.：素材密度必須配合實際顯示尺寸

[Wildfire Games Technical Art Requirements](https://wildfiregames.com/forum/applications/core/interface/file/attachment.php?id=70048&key=5eb97d05f5e43fdde4a75b17c42880a0) 說明素材會影響效能與儲存，紋理尺寸需配合物件在螢幕上占的比例，並避免無效噪點。這不是本專案引擎規格；不直接套用其尺寸限制。

本案套用：建築集中於單張圖集，384px来源格對應約80～150px遊戲建築；每格有統一腳底與透明邊界。保留不同建築的用途剪影，不把單個屋瓦噪點當作遊戲可讀性。入口壓縮為WebP；來源母版從正式包移除，正式美術控制於16MiB預算。

## Wesnoth：地形不能只是一格一張圖

[CastleTutorial](https://wiki.wesnoth.org/CastleTutorial) 討論地形渲染規則可以超出「一種地形對應一張圖」的作法。[Turning Square Tiles into Hex](https://wiki.wesnoth.org/Turning_Square_Tiles_into_Hex) 說明地形圖的視角與無縫相接。這些是其引擎技法，不代表本遊戲改用六角格。

本案套用：保留18×16模擬格，視覺改畫連續道路、水道、石路細節與草地；外緣不規則且有地面厚度。修正紋理被權威色塊覆蓋及道路伸出地圖的問題。地形通行、採集、迷霧及占地仍由shared規則控制。

## 檢查結果與下輪方向

十二款建築與細節地形已接入，Canvas採樣改為平滑，中文HUD與點陣建築不再被整幅像素化。角色、工匠、牆與城門尚未全部統一，下一輪應以共用相機、光源、材質與64px剪影重做；不能只換色或加入背景圖後宣稱所有素材都完成。
