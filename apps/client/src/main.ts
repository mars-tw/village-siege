import { createGame } from "./game/createGame";

const game = createGame("game-root");

if (import.meta.hot) {
  import.meta.hot.dispose(() => game.destroy(true));
}
