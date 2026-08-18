import { useStore } from "../store";
import { useT } from "../i18n/useT";

// « Cinématique » — Il y a bien longtemps… Taper n'importe où, ou Passer.
//
// L'écran entier était un <div onClick> : non focusable, invisible au clavier et
// muet pour un lecteur d'écran. C'est maintenant un vrai bouton plein écran, et
// « Passer » se place au-dessus.
export function CinematicScreen() {
  const enterGame = useStore((s) => s.enterGame);
  const T = useT();

  return (
    <div className="screen cinematic">
      <button className="screen-tap" onClick={() => enterGame()} aria-label={T("cinematic.start")}>
        <span className="art" aria-hidden="true">
          🐈
        </span>
        <span className="caption">{T("cinematic.caption")}</span>
      </button>
      <button className="skip" onClick={() => enterGame()}>
        ▶▶ {T("cinematic.skip")}
      </button>
    </div>
  );
}
