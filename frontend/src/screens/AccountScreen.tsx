import { useEffect, useState } from "react";
import { useStore } from "../store";
import { Logo } from "../components/Logo";

// Account screen: email+password login/register (free), "my games" resume list.
// Google OAuth is a future provider (free, needs a GCP client id); Apple Sign-In
// requires the paid Apple Developer Program and is intentionally not offered.
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
  const { loginAccount, registerAccount, busy, error, setScreen, pushLog } = useStore();
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

      <div className="lobby-card">
        <div className="lobby-card-title">Autres connexions</div>
        <button className="pill" disabled onClick={() => pushLog("Google — bientôt")}>
          🔵 Continuer avec Google <small>(bientôt)</small>
        </button>
        <div className="lobby-hint">
          Google : gratuit, sera branché quand un client OAuth sera configuré. Apple : nécessite le
          programme développeur Apple (payant) — non prévu.
        </div>
      </div>

      {error && <div className="lobby-error">⚠️ {error}</div>}
      <button className="pill ghost" onClick={() => setScreen("title")}>
        ← Retour
      </button>
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
