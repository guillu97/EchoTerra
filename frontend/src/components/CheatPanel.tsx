import { useStore } from "../store";

export function CheatPanel() {
  const cheatOpen = useStore((s) => s.cheatOpen);
  const toggleCheat = useStore((s) => s.toggleCheat);
  const advance = useStore((s) => s.advance);
  const skipDay = useStore((s) => s.skipDay);
  const revealFog = useStore((s) => s.revealFog);
  const newGame = useStore((s) => s.newGame);
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
        <button className="pill" disabled={busy || !game} onClick={() => advance(true)}>
          🛡️ Passer la vague (sans dégâts ville)
        </button>
        <button className="pill" disabled={busy || !game} onClick={() => skipDay()}>
          ⏩ +1 Jour (×2 vagues)
        </button>
        <button className="pill" disabled={busy || !game} onClick={() => revealFog(true)}>
          👁️ Lever le brouillard
        </button>
        <button className="pill" disabled={busy || !game} onClick={() => revealFog(false)}>
          🌫️ Remettre le brouillard
        </button>
        {/* Le cheat "Révéler la carte" a disparu : le serveur n'envoie plus les tuiles
            non découvertes, le client n'a donc rien à révéler (anti-triche). */}
        <button className="pill red" disabled={busy} onClick={() => { toggleCheat(); newGame(); }}>
          🔄 Nouvelle partie
        </button>
      </div>
    </div>
  );
}
