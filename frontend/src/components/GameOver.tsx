import { useStore } from "../store";

// Shown when the town's HP reaches 0. Offers a fresh run or back to the title.
export function GameOver() {
  const game = useStore((s) => s.game);
  const newGame = useStore((s) => s.newGame);
  const setScreen = useStore((s) => s.setScreen);
  const setTab = useStore((s) => s.setTab);
  if (!game || game.status !== "gameover") return null;

  return (
    <div className="gameover">
      <div className="go-card">
        <div className="go-emoji">💀</div>
        <h2>La ville est tombée</h2>
        <p>
          La horde a submergé la ville à la <strong>vague {game.waveNumber}</strong> (jour {game.day}).
        </p>
        <button
          className="pill red"
          onClick={async () => {
            await newGame();
            setTab("home");
          }}
        >
          Nouvelle partie
        </button>
        <button className="pill" onClick={() => setScreen("title")}>
          Menu principal
        </button>
      </div>
    </div>
  );
}
