import ReactDOM from "react-dom/client";
import App from "./App";
import "./app-shell.css";
import { detectAvailableAssets } from "./assets";
import { useStore, resolveLocale } from "./store";
import { setLocale } from "./i18n";

// Probe which generated assets exist so components can swap emoji → real images.
detectAvailableAssets();

// LA LANGUE, avant le premier rendu. Les fichiers de langue arrivent par
// `import()` : `t()` sert donc le français le temps d'un aller-retour, et les
// composants se rafraîchissent tout seuls à l'arrivée (voir i18n/useT.ts). On
// n'attend PAS ici — bloquer le premier rendu sur un morceau de JS ferait payer
// un écran blanc à tout le monde pour un texte qui va s'afficher de toute façon.
void setLocale(resolveLocale(useStore.getState().settings.language));

// Dev shortcuts: open the map editor / data studio directly via the URL hash.
const applyHash = () => {
  const h = location.hash.replace("#", "");
  if (h === "editor") useStore.getState().setScreen("editor");
  if (h === "designer") useStore.getState().setScreen("designer");
  if (h === "voxel-bench") useStore.getState().setScreen("voxelbench");
  if (h === "voxeledit") useStore.getState().setScreen("voxeledit");
  if (h === "charstudio") useStore.getState().setScreen("charstudio");
};
window.addEventListener("hashchange", applyHash);
// Defer one tick so the store is initialized before we flip the screen.
queueMicrotask(applyHash);

// Note: StrictMode is intentionally omitted — its dev double-invoke would mount the
// le moteur voxel game twice. Re-enable once le moteur voxelGame is hardened against remount churn.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
