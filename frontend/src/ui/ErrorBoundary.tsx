import { Component, type ErrorInfo, type ReactNode } from "react";
import { t } from "../i18n";

// Filet de sécurité : sans lui, une exception de rendu vidait le <div id="root">
// et laissait un écran BLANC, sans le moindre indice de ce qui s'est passé.
export class ErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Laisse la trace complète dans la console pour le débogage.
    console.error("[EchoTerra] erreur de rendu :", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="screen parchment">
        <div className="crash-card" role="alert">
          <div className="crash-ic" aria-hidden="true">
            🪵
          </div>
          <h1 className="crash-title">{t("Quelque chose a cassé")}</h1>
          <p className="crash-text">
            {t(
              "L'affichage a rencontré une erreur inattendue. Ta partie est enregistrée côté serveur — recharger devrait suffire à reprendre où tu en étais.",
            )}
          </p>
          <pre className="crash-detail">{this.state.error.message}</pre>
          <button className="pill red ov-close" onClick={() => location.reload()}>
            {t("Recharger le jeu")}
          </button>
        </div>
      </div>
    );
  }
}
