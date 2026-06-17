import { useEffect } from "react";
import { useStore } from "../store";
import { Logo } from "../components/Logo";
import { assetUrl } from "../assets";

// "Ecran de chargement" — the bird settles on the branch, then we move to the title.
export function LoadingScreen() {
  const setScreen = useStore((s) => s.setScreen);

  useEffect(() => {
    const t = setTimeout(() => setScreen("title"), 2200);
    return () => clearTimeout(t);
  }, [setScreen]);

  return (
    <div className="screen parchment" onClick={() => setScreen("title")}>
      <Logo />
      <div className="loading-bar">
        <i />
      </div>
      <div className="branch" />
      <div className="bird" aria-label="oiseau">
        {assetUrl("bird") ? <img src={assetUrl("bird")} alt="🐦" /> : "🐦"}
      </div>
    </div>
  );
}
