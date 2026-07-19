import "./style.css";
import { createGame } from "./game/createGame";
import { installDeviceViewportFit } from "./game/deviceViewport";

const host = document.getElementById("game-root");
if (!host) throw new Error("Missing #game-root host");

const game = createGame(host);
const uninstallViewportFit = installDeviceViewportFit(game, host);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    uninstallViewportFit();
    game.destroy(true);
  });
}
