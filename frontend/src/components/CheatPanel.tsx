import { useStore } from "../store";
import { useT } from "../i18n/useT";

export function CheatPanel() {
  const cheatOpen = useStore((s) => s.cheatOpen);
  const toggleCheat = useStore((s) => s.toggleCheat);
  const advance = useStore((s) => s.advance);
  const skipDay = useStore((s) => s.skipDay);
  const revealFog = useStore((s) => s.revealFog);
  const newGame = useStore((s) => s.newGame);
  const busy = useStore((s) => s.busy);
  const game = useStore((s) => s.game);
  const { t } = useT();

  if (!cheatOpen) return null;

  return (
    <div className="cheat-panel">
      <div className="cheat-head">
        <span>🔧 {t("Triche")}</span>
        <button className="cheat-close" onClick={toggleCheat}>✕</button>
      </div>
      {game && (
        <div className="cheat-info">
          {t("Jour {d} · Vague {w}", { d: game.day, w: game.waveNumber })}
        </div>
      )}
      <div className="cheat-rows">
        <button className="pill" disabled={busy || !game} onClick={() => advance()}>
          🌊 {t("Avancer la vague")}
        </button>
        <button className="pill" disabled={busy || !game} onClick={() => advance(true)}>
          🛡️ {t("Passer la vague (sans dégâts ville)")}
        </button>
        <button className="pill" disabled={busy || !game} onClick={() => skipDay()}>
          ⏩ {t("+1 Jour (×2 vagues)")}
        </button>
        <button className="pill" disabled={busy || !game} onClick={() => revealFog(true)}>
          👁️ {t("Lever le brouillard")}
        </button>
        <button className="pill" disabled={busy || !game} onClick={() => revealFog(false)}>
          🌫️ {t("Remettre le brouillard")}
        </button>
        {/* Le cheat "Révéler la carte" a disparu : le serveur n'envoie plus les tuiles
            non découvertes, le client n'a donc rien à révéler (anti-triche). */}
        <button className="pill red" disabled={busy} onClick={() => { toggleCheat(); newGame(); }}>
          🔄 {t("Nouvelle partie")}
        </button>
      </div>
    </div>
  );
}
