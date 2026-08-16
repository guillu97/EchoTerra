import { useEffect, useRef, useState } from "react";
import { ChronicleCard } from "../components/ChronicleCard";
import { useStore } from "../store";
import { api } from "../api/client";
import { loadGoogleIdentity } from "../googleAuth";
import { Logo } from "../components/Logo";
import { getLang } from "../i18n";
import { useT } from "../i18n/useT";

// Account screen: email+password login/register (free), Google Sign-In (free,
// shown only when the server has a client id configured), "my games" resume list.
// Apple Sign-In requires the paid Apple Developer Program and is intentionally
// not offered.
export function AccountScreen() {
  const user = useStore((s) => s.user);
  return (
    <div className="screen parchment lobby-screen">
      <div className="ornament">
        <i />
        <i />
        <i />
      </div>
      <Logo />
      {user ? <Profile /> : <AuthForms />}
    </div>
  );
}

function AuthForms() {
  const { loginAccount, registerAccount, busy, error, setScreen } = useStore();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const { t } = useT();
  const canSubmit = email.includes("@") && password.length >= 6;

  return (
    <div className="lobby-panel">
      <div className="lobby-card">
        <div className="lobby-card-title">
          {mode === "login" ? "👤 " + t("Connexion") : "✨ " + t("Créer un compte")}
        </div>
        <div className="lobby-hint">
          {t("Un compte permet de te reconnaître dans les parties et de les reprendre depuis n'importe quel appareil.")}
        </div>
        <label className="lobby-field">
          <span>{t("Email")}</span>
          <input
            type="email"
            value={email}
            placeholder={t("toi@exemple.fr")}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        {mode === "register" && (
          <label className="lobby-field">
            <span>{t("Pseudo")}</span>
            <input
              value={name}
              maxLength={20}
              placeholder={t("Aventurier")}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        )}
        <label className="lobby-field">
          <span>{t("Mot de passe")} {mode === "register" && <em>{t("(6 caractères min.)")}</em>}</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button
          className="pill red"
          disabled={busy || !canSubmit}
          onClick={() =>
            mode === "login" ? loginAccount(email, password) : registerAccount(email, name, password)
          }
        >
          {mode === "login" ? t("Se connecter") : t("Créer le compte")}
        </button>
        <button
          className="pill ghost"
          onClick={() => setMode(mode === "login" ? "register" : "login")}
        >
          {mode === "login" ? t("Pas de compte ? Inscris-toi") : t("Déjà un compte ? Connecte-toi")}
        </button>
      </div>

      <GoogleCard />

      {error && <div className="lobby-error">⚠️ {error}</div>}
      <button className="pill ghost" onClick={() => setScreen("title")}>
        ← {t("Retour")}
      </button>
    </div>
  );
}

// "Continuer avec Google": asks the server whether a client id is configured, and
// if so lets Google Identity Services render its official button (the credential it
// returns is verified server-side by POST /api/auth/google). Apple stays out
// (paid Apple Developer Program).
function GoogleCard() {
  const loginGoogleAccount = useStore((s) => s.loginGoogleAccount);
  const [status, setStatus] = useState<"loading" | "ready" | "off" | "error">("loading");
  const slot = useRef<HTMLDivElement>(null);
  const { t } = useT();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { googleClientId } = await api.authConfig();
        if (!googleClientId) {
          if (!cancelled) setStatus("off");
          return;
        }
        const gsi = await loadGoogleIdentity();
        if (cancelled || !slot.current) return;
        gsi.initialize({
          client_id: googleClientId,
          callback: (resp) => {
            void useStore.getState().loginGoogleAccount(resp.credential);
          },
        });
        gsi.renderButton(slot.current, {
          theme: "outline",
          size: "large",
          text: "continue_with",
          shape: "pill",
          // Le bouton officiel de Google se traduit tout seul — encore faut-il lui
          // dire dans quelle langue : « fr » en dur laissait un bouton français au
          // milieu d'une interface anglaise.
          locale: getLang(),
        });
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loginGoogleAccount]);

  return (
    <div className="lobby-card">
      <div className="lobby-card-title">{t("Autres connexions")}</div>
      <div ref={slot} style={{ display: status === "ready" ? "flex" : "none", justifyContent: "center" }} />
      {status === "loading" && <div className="lobby-hint">{t("Vérification de Google…")}</div>}
      {status === "off" && (
        <div className="lobby-hint">
          {t("Google : non configuré sur ce serveur (variable ECHOTERRA_GOOGLE_CLIENT_ID).")}
        </div>
      )}
      {status === "error" && (
        <div className="lobby-hint">⚠️ {t("Google inaccessible pour le moment — utilise l'email.")}</div>
      )}
      <div className="lobby-hint">
        {t("Apple : nécessite le programme développeur Apple (payant) — non prévu.")}
      </div>
    </div>
  );
}

function Profile() {
  const { user, logoutAccount, myGames, fetchMyGames, resumeGame, busy, error, setScreen } =
    useStore();
  const { t } = useT();

  useEffect(() => {
    fetchMyGames();
  }, [fetchMyGames]);

  if (!user) return null;
  return (
    <div className="lobby-panel">
      <div className="lobby-card">
        <div className="lobby-card-title">👤 {user.name}</div>
        <div className="lobby-hint">{user.email}</div>
        <button className="pill" disabled={busy} onClick={() => logoutAccount()}>
          {t("Se déconnecter")}
        </button>
      </div>

      <div className="lobby-card">
        <div className="lobby-card-title">🗺️ {t("Mes parties")}</div>
        {myGames.length === 0 && (
          <div className="lobby-hint">
            {t("Aucune partie liée à ce compte pour l'instant — les prochaines parties que tu crées ou rejoins apparaîtront ici.")}
          </div>
        )}
        {myGames.length > 0 && (
          <div className="lobby-list">
            {myGames.map((g) => (
              <button key={g.id} className="lobby-row" disabled={busy} onClick={() => resumeGame(g)}>
                <span className="lobby-row-name">
                  {g.status === "lobby" ? "🎪" : g.status === "gameover" ? "💀" : "▶"}{" "}
                  {g.name || t("Partie")}
                </span>
                <span className="lobby-row-count">
                  {g.status === "lobby"
                    ? t("{n}/{min} joueurs", { n: g.players.length, min: g.minPlayers })
                    : t("jour {d} · vague {w}", { d: g.day, w: g.waveNumber })}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <ChronicleCard />

      {error && <div className="lobby-error">⚠️ {error}</div>}
      <button className="pill ghost" onClick={() => setScreen("title")}>
        ← {t("Retour")}
      </button>
    </div>
  );
}
