import ReactDOM from "react-dom/client";
import App from "./App";
import "./app-shell.css";
import { detectAvailableAssets } from "./assets";

// Probe which generated assets exist so components can swap emoji → real images.
detectAvailableAssets();

// Note: StrictMode is intentionally omitted — its dev double-invoke would mount the
// Phaser game twice. Re-enable once PhaserGame is hardened against remount churn.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
