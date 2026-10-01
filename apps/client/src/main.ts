import "./style.css";
import { createGame } from "./game/createGame";
import { installDeviceViewportFit } from "./game/deviceViewport";
import { installPwa } from "./game/installPwa";

const host = document.getElementById("game-root");
if (!host) throw new Error("Missing #game-root host");

const game = createGame(host);
const uninstallViewportFit = installDeviceViewportFit(game, host);
const uninstallPwa = installPwa(() => game.scene.isActive("VillageSelectScene"));
const devAuditGameKey = "__VILLAGE_SIEGE_DEV_GAME__";

if (import.meta.env.DEV) {
  Object.defineProperty(globalThis, devAuditGameKey, {
    value: game,
    configurable: true,
    enumerable: false,
    writable: false,
  });
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    Reflect.deleteProperty(globalThis, devAuditGameKey);
    uninstallViewportFit();
    uninstallPwa();
    game.destroy(true);
  });
}
