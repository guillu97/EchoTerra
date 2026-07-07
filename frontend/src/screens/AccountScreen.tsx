import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { api } from "../api/client";
import { loadGoogleIdentity } from "../googleAuth";
import { Logo } from "../components/Logo";

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
  const canSubmit = email.includes("@") && password.length >= 6;

  return (
    <div className="lobby-panel">
      <div className="lobby-card">
        <div className="lobby-card-title">
          {mode === "login" ? "👤 Connexion" : "✨ Créer un compte"}
        </div>
        <div className="lobby-hint">
          Un compte permet de te reconnaître dans les parties et de les reprendre depuis
          n'importe quel appareil.
        </div>
        <label className="lobby-field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            placeholder="toi@exemple.fr"
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        {mode === "register" && (
          <label className="lobby-field">
            <span>Pseudo</span>
            <input
              value={name}
              maxLength={20}
              placeholder="Aventurier"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        )}
        <label className="lobby-field">
          <span>Mot de passe {mode === "register" && <em>(6 caractères min.)</em>}</span>
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
          {mode === "login" ? "Se connecter" : "Créer le compte"}
        </button>
        <button
          className="pill ghost"
          onClick={() => setMode(mode === "login" ? "register" : "login")}
        >
          {mode === "login" ? "Pas de compte ? Inscris-toi" : "Déjà un compte ? Connecte-toi"}
        </button>
      </div>

      <GoogleCard />

      {error && <div className="lobby-error">⚠️ {error}</div>}
      <button className="pill ghost" onClick={() => setScreen("title")}>
        ← Retour
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
          locale: "fr",
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
      <div className="lobby-card-title">Autres connexions</div>
      <div ref={slot} style={{ display: status === "ready" ? "flex" : "none", justifyContent: "center" }} />
      {status === "loading" && <div className="lobby-hint">Vérification de Google…</div>}
      {status === "off" && (
        <div className="lobby-hint">
          Google : non configuré sur ce serveur (variable <code>ECHOTERRA_GOOGLE_CLIENT_ID</code>).
        </div>
      )}
      {status === "error" && (
        <div className="lobby-hint">⚠️ Google inaccessible pour le moment — utilise l'email.</div>
      )}
      <div className="lobby-hint">
        Apple : nécessite le programme développeur Apple (payant) — non prévu.
      </div>
    </div>
  );
}

function Profile() {
  const { user, logoutAccount, myGames, fetchMyGames, resumeGame, busy, error, setScreen } =
    useStore();

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
          Se déconnecter
        </button>
      </div>

      <div className="lobby-card">
        <div className="lobby-card-title">🗺️ Mes parties</div>
        {myGames.length === 0 && (
          <div className="lobby-hint">
            Aucune partie liée à ce compte pour l'instant — les prochaines parties que tu crées ou
            rejoins apparaîtront ici.
          </div>
        )}
        {myGames.length > 0 && (
          <div className="lobby-list">
            {myGames.map((g) => (
              <button key={g.id} className="lobby-row" disabled={busy} onClick={() => resumeGame(g)}>
                <span className="lobby-row-name">
                  {g.status === "lobby" ? "🎪" : g.status === "gameover" ? "💀" : "▶"}{" "}
                  {g.name || "Partie"}
                </span>
                <span className="lobby-row-count">
                  {g.status === "lobby"
                    ? `${g.players.length}/${g.minPlayers} joueurs`
                    : `jour ${g.day} · vague ${g.waveNumber}`}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <div className="lobby-error">⚠️ {error}</div>}
      <button className="pill ghost" onClick={() => setScreen("title")}>
        ← Retour
      </button>
    </div>
  );
}
