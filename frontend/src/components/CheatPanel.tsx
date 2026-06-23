import { useStore } from "../store";

export function CheatPanel() {
  const cheatOpen = useStore((s) => s.cheatOpen);
  const toggleCheat = useStore((s) => s.toggleCheat);
  const advance = useStore((s) => s.advance);
  const skipDay = useStore((s) => s.skipDay);
  const newGame = useStore((s) => s.newGame);
  const toggleFog = useStore((s) => s.toggleFog);
  const debugNoFog = useStore((s) => s.debugNoFog);
  const busy = useStore((s) => s.busy);
  const game = useStore((s) => s.game);

  if (!cheatOpen) return null;

  return (
    <div className="cheat-panel">
      <div className="cheat-head">
        <span>🔧 Triche</span>
        <button className="cheat-close" onClick={toggleCheat}>✕</button>
      </div>
      {game && (
        <div className="cheat-info">
          Jour {game.day} · Vague {game.waveNumber}
        </div>
      )}
      <div className="cheat-rows">
        <button className="pill" disabled={busy || !game} onClick={() => advance()}>
          🌊 Avancer la vague
        </button>
        <button className="pill" disabled={busy || !game} onClick={() => skipDay()}>
          ⏩ +1 Jour (×2 vagues)
        </button>
        <button className="pill" onClick={() => toggleFog()}>
          {debugNoFog ? "🌫️ Réactiver le brouillard" : "👁️ Révéler la carte (fog off)"}
        </button>
        <button className="pill red" disabled={busy} onClick={() => { toggleCheat(); newGame(); }}>
          🔄 Nouvelle partie
        </button>
      </div>
    </div>
  );
}
