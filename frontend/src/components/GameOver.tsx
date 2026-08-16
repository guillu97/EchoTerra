import { useStore } from "../store";
import { LedgerTable, LedgerLegend, LedgerRow, myContribution } from "./TownLedger";
import { useT } from "../i18n/useT";

// LE RÉCIT DE FIN DE PARTIE — ce qu'on emporte d'une ville tombée.
//
// Cet écran était un cul-de-sac (RETENTION-PLAN.md, R1+R2) : un emoji, une phrase, deux
// boutons. Après sept à neuf jours réels de survie collective, il ne disait NI ce que le
// joueur avait fait (le registre existait pourtant, calculé et servi — mais affiché nulle
// part), NI que sa ville allait hanter les cartes suivantes (c'est vrai depuis les
// mémoriaux), et son bouton « Nouvelle partie » relançait la partie SOLO LEGACY 22×22 :
// au seul instant où l'on sait avec certitude que le joueur est là, le jeu l'éjectait de
// sa propre boucle multijoueur.
export function GameOver() {
  const game = useStore((s) => s.game);
  const playerId = useStore((s) => s.playerId);
  const user = useStore((s) => s.user);
  const busy = useStore((s) => s.busy);
  const setScreen = useStore((s) => s.setScreen);
  const openLobby = useStore((s) => s.openLobby);
  const openAccount = useStore((s) => s.openAccount);
  const startSoloBots = useStore((s) => s.startSoloBots);
  const pushLog = useStore((s) => s.pushLog);
  const { t } = useT();
  if (!game || game.status !== "gameover") return null;

  const townName = game.town.name || t("La ville");
  const mine = myContribution(game, playerId);
  const humans = (game.players ?? []).filter((p) => !p.bot);
  // La relance doit ramener le joueur là d'où il vient — pas dans la partie legacy.
  const wasSolo = game.solo || (game.visibility !== "public" && humans.length <= 1);
  const defenders = humans.map((p) => p.name);
  // Mon nom, pas « Toi » : la pastille du registre dit déjà que c'est moi, et deux fois
  // le même mot sur la même ligne se lit comme un bug.
  const myName = mine?.name || humans.find((p) => p.id === playerId)?.name || t("Toi");

  return (
    <div className="gameover">
      <div className="go-card">
        <div className="go-emoji">💀</div>
        <h2>{t("{town} est tombée", { town: townName })}</h2>
        <p>{t("La horde a submergé la ville à la vague {w} (jour {d}).", { w: game.waveNumber, d: game.day })}</p>

        <div className="go-stats">
          <span>
            🌊 <b>{game.waveNumber}</b> {t("vagues tenues")}
          </span>
          <span>
            📅 <b>{game.day}</b> {t("jours")}
          </span>
          <span>
            ⚔️ <b>{game.monstersKilled}</b> {t("créatures abattues")}
          </span>
        </div>

        {mine && (
          <div className="go-block">
            <h3>{t("Ce que tu as apporté")}</h3>
            <LedgerRow c={{ ...mine, name: myName }} mine />
          </div>
        )}

        {(game.players?.length ?? 0) > 0 && (
          <div className="go-block">
            <h3>{t("Ce que la ville vous doit")}</h3>
            <LedgerTable game={game} playerId={playerId} />
            <LedgerLegend />
          </div>
        )}

        {/* La promesse des mémoriaux (ruins.go SeedMemorialRuins) : elle est TENUE par le
            serveur depuis P5, et personne ne la disait au joueur. */}
        <div className="go-memorial">
          🏚{" "}
          {defenders.length > 0
            ? t(
                "{town} se dressera en ruines sur les cartes des prochaines expéditions — avec la vague où elle est tombée et le nom de ceux qui l'ont défendue. Ceux qui la trouveront y récupéreront ce qu'elle n'a pas eu le temps de dépenser.",
                { town: townName },
              )
            : t(
                "{town} se dressera en ruines sur les cartes des prochaines expéditions — avec la vague où elle est tombée. Ceux qui la trouveront y récupéreront ce qu'elle n'a pas eu le temps de dépenser.",
                { town: townName },
              )}
        </div>

        {wasSolo ? (
          <button className="pill red" disabled={busy} onClick={() => startSoloBots()}>
            ⚔️ {t("Repartir en solo")} <small>{t("(avec 4 bots)")}</small>
          </button>
        ) : (
          <button
            className="pill red"
            disabled={busy}
            onClick={() => {
              if (user) {
                openLobby("public");
              } else {
                pushLog("🔒 " + t("Connecte-toi pour rejoindre une expédition publique."));
                openAccount();
              }
            }}
          >
            🌍 {t("Rejoindre une expédition")}
          </button>
        )}
        {user && (
          <button className="pill cream" onClick={() => openAccount()}>
            📜 {t("Ma chronique")}
          </button>
        )}
        <button className="pill cream" onClick={() => setScreen("leaderboard")}>
          🏆 {t("Classement")}
        </button>
        <button className="pill" onClick={() => setScreen("title")}>
          🏰 {t("Menu principal")}
        </button>
      </div>
    </div>
  );
}
