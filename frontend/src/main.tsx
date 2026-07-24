import ReactDOM from "react-dom/client";
import App from "./App";
import "./app-shell.css";
import { detectAvailableAssets } from "./assets";
import { useStore } from "./store";

// Probe which generated assets exist so components can swap emoji → real images.
detectAvailableAssets();

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
// Phaser game twice. Re-enable once PhaserGame is hardened against remount churn.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
