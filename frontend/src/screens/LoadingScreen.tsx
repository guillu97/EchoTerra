import { useEffect } from "react";
import { useStore } from "../store";
import { Logo } from "../components/Logo";
import { assetUrl } from "../assets";
import { useT } from "../i18n/useT";

// « Écran de chargement » — l'oiseau se pose sur la branche, puis on passe au titre.
export function LoadingScreen() {
  const setScreen = useStore((s) => s.setScreen);
  const T = useT();

  useEffect(() => {
    const t = setTimeout(() => setScreen("title"), 2200);
    return () => clearTimeout(t);
  }, [setScreen]);

  return (
    <div className="screen parchment">
      {/* Bouton plein écran plutôt qu'un <div onClick> : focusable et
          activable au clavier comme n'importe quel bouton. */}
      <button className="screen-tap" onClick={() => setScreen("title")} aria-label={T("loading.skip")}>
        <Logo />
        <span className="loading-bar" role="progressbar" aria-label={T("app.loading")}>
          <i />
        </span>
      </button>
      <div className="branch" aria-hidden="true" />
      <div className="bird" aria-hidden="true">
        {assetUrl("bird") ? <img src={assetUrl("bird")} alt="" /> : "🐦"}
      </div>
    </div>
  );
}
