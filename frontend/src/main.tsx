import ReactDOM from "react-dom/client";
import App from "./App";
import "./app-shell.css";

// Note: StrictMode is intentionally omitted — its dev double-invoke would mount the
// Phaser game twice. Re-enable once PhaserGame is hardened against remount churn.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
