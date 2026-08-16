import { useStore } from "../store";
import { useT } from "../i18n/useT";

// « Cinématique » — Il y a bien longtemps… Taper n'importe où, ou Passer.
//
// L'écran entier était un <div onClick> : non focusable, invisible au clavier et
// muet pour un lecteur d'écran. C'est maintenant un vrai bouton plein écran, et
// « Passer » se place au-dessus.
export function CinematicScreen() {
  const enterGame = useStore((s) => s.enterGame);
  const { t } = useT();

  return (
    <div className="screen cinematic">
      <button className="screen-tap" onClick={() => enterGame()} aria-label={t("Commencer la partie")}>
        <span className="art" aria-hidden="true">
          🐈
        </span>
        <span className="caption">{t("Il y a bien longtemps…")}</span>
      </button>
      <button className="skip" onClick={() => enterGame()}>
        ▶▶ {t("Passer")}
      </button>
    </div>
  );
}
