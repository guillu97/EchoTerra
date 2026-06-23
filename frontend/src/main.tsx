import ReactDOM from "react-dom/client";
import App from "./App";
import "./app-shell.css";
import { detectAvailableAssets } from "./assets";
import { useStore } from "./store";

// Probe which generated assets exist so components can swap emoji → real images.
detectAvailableAssets();

// Dev shortcut: open the map editor directly via the #editor URL hash.
const applyHash = () => {
  if (location.hash.replace("#", "") === "editor") useStore.getState().setScreen("editor");
};
window.addEventListener("hashchange", applyHash);
// Defer one tick so the store is initialized before we flip the screen.
queueMicrotask(applyHash);

// Note: StrictMode is intentionally omitted — its dev double-invoke would mount the
// Phaser game twice. Re-enable once PhaserGame is hardened against remount churn.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
