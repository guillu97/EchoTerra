import { useStore } from "../store";

// "Cinématique" — Long time ago... Tap or Skip to enter the game.
export function CinematicScreen() {
  const enterGame = useStore((s) => s.enterGame);

  return (
    <div className="screen cinematic" onClick={() => enterGame()}>
      <button className="skip" onClick={(e) => { e.stopPropagation(); enterGame(); }}>
        ▶▶ Skip
      </button>
      <div className="art">🐈</div>
      <div className="caption">Long time ago…</div>
    </div>
  );
}
