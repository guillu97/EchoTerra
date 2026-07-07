// Google Identity Services (GIS) loader — "Continuer avec Google".
// The script is injected on demand (only when the server's /api/auth/config says a
// client id is configured), GIS renders its own button, and the callback hands us
// an ID token (credential) that POST /api/auth/google verifies server-side.

export interface GoogleCredentialResponse {
  credential: string;
}

interface GoogleId {
  initialize(cfg: {
    client_id: string;
    callback: (resp: GoogleCredentialResponse) => void;
  }): void;
  renderButton(
    parent: HTMLElement,
    options: {
      theme?: "outline" | "filled_blue" | "filled_black";
      size?: "large" | "medium" | "small";
      text?: "signin_with" | "continue_with";
      shape?: "rectangular" | "pill";
      width?: number;
      locale?: string;
    },
  ): void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

const GSI_SRC = "https://accounts.google.com/gsi/client";
let gsiPromise: Promise<GoogleId> | null = null;

/** Injects the GIS script once and resolves with the google.accounts.id API. */
export function loadGoogleIdentity(): Promise<GoogleId> {
  if (!gsiPromise) {
    gsiPromise = new Promise<GoogleId>((resolve, reject) => {
      if (window.google?.accounts?.id) {
        resolve(window.google.accounts.id);
        return;
      }
      const script = document.createElement("script");
      script.src = GSI_SRC;
      script.async = true;
      script.onload = () => {
        const id = window.google?.accounts?.id;
        if (id) resolve(id);
        else reject(new Error("GIS chargé mais API absente"));
      };
      script.onerror = () => {
        gsiPromise = null; // allow a retry on the next mount
        reject(new Error("script Google Identity inaccessible"));
      };
      document.head.appendChild(script);
    });
  }
  return gsiPromise;
}
