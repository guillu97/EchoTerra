import { useStore } from "../store";
import { Overlay } from "../ui/Overlay";
import type { Contribution, GameState } from "../api/types";
import { t } from "../i18n";
import { useT } from "../i18n/useT";

// LE REGISTRE DE CONTRIBUTION — « ce que la ville te doit ».
//
// Le serveur le tenait déjà (game/contribution.go : credit() sur six actions), le
// sérialisait (`contributions`) et le typait ici… et AUCUN composant ne le lisait :
// la moitié qui produit l'effet manquait (RETENTION-PLAN.md, R1). Le voici, en ville
// (bouton du Panneau) et surtout dans le récit de fin de partie — c'est là qu'il compte,
// puisque c'est le seul moment où l'on regarde en arrière.
//
// ⚠ CADRAGE REPRIS DU SERVEUR, à ne pas défaire : les lignes sortent dans l'ORDRE
// D'ARRIVÉE des joueurs, jamais triées par mérite, et il n'y a aucun total ni aucun
// « meilleur joueur ». Trier installerait une compétition entre coéquipiers dans un jeu
// qui se vend sur la survie de groupe.

// Les six colonnes du registre, dans l'ordre du serveur.
// ⚠ libellés gardés EN FRANÇAIS ici et traduits AU RENDU : une constante de module
// n'est évaluée qu'une fois, donc un `t()` posé là figerait ces six mots dans la langue
// du démarrage.
const COLS: { key: keyof Contribution; icon: string; label: string }[] = [
  { key: "buildPa", icon: "🏗", label: "PA de chantier" },
  { key: "deposited", icon: "📦", label: "objets rapportés" },
  { key: "slain", icon: "⚔️", label: "créatures abattues" },
  { key: "repaired", icon: "🧱", label: "PV rendus aux remparts" },
  { key: "crafted", icon: "⚒", label: "objets fabriqués" },
  { key: "filled", icon: "🤝", label: "requêtes honorées" },
];

const isEmpty = (c: Contribution) => COLS.every((col) => !(c[col.key] as number));

const blank = (playerId: string, name: string): Contribution => ({
  playerId,
  name,
  buildPa: 0,
  deposited: 0,
  slain: 0,
  repaired: 0,
  crafted: 0,
  filled: 0,
});

// buildLedger est le MIROIR de GameState.Ledger() (contribution.go) : les joueurs dans
// leur ordre d'arrivée — y compris ceux qui n'ont encore rien fait, dont la ligne à zéro
// dit « il vient d'arriver » quand son absence dirait « il n'existe pas » — puis les
// joueurs PARTIS qui ont laissé une trace, triés par id comme côté serveur.
export function buildLedger(game: GameState): Contribution[] {
  const contrib = game.contributions ?? {};
  const players = game.players ?? [];
  const rows = players.map((p) => {
    const c = contrib[p.id];
    return c ? { ...c, name: p.name } : blank(p.id, p.name);
  });
  const known = new Set(players.map((p) => p.id));
  const orphans = Object.entries(contrib)
    .filter(([id, c]) => !known.has(id) && !isEmpty(c))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, c]) => c);
  return [...rows, ...orphans];
}

// Ma ligne du registre (undefined en partie héritée sans joueurs).
export function myContribution(game: GameState, playerId?: string): Contribution | undefined {
  if (!playerId) return undefined;
  return game.contributions?.[playerId] ?? blank(playerId, "");
}

// Une ligne : le nom, puis une pastille par colonne non nulle. Les zéros sont tus —
// une ligne pleine de « 0 » se lit comme un reproche, ce que ce registre n'est pas.
export function LedgerRow({
  c,
  mine,
  bot,
}: {
  c: Contribution;
  mine?: boolean;
  bot?: boolean;
}) {
  const filled = COLS.filter((col) => (c[col.key] as number) > 0);
  return (
    <div className={`lg-row${mine ? " mine" : ""}`}>
      <span className="lg-name">
        {bot ? "🤖 " : ""}
        {c.name || t("Aventurier")}
        {mine && <span className="lg-you">{t("toi")}</span>}
      </span>
      {filled.length === 0 ? (
        <span className="lg-none">{t("rien encore")}</span>
      ) : (
        <span className="lg-stats">
          {filled.map((col) => (
            <span className="lg-stat" key={col.key} title={t(col.label)}>
              {col.icon} {c[col.key] as number}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

// Le registre complet. `game` explicite (et pas le store) : le récit de fin de partie
// l'affiche pour une ville qui n'existe plus.
export function LedgerTable({ game, playerId }: { game: GameState; playerId?: string }) {
  const rows = buildLedger(game);
  if (rows.length === 0) return null;
  const bots = new Set((game.players ?? []).filter((p) => p.bot).map((p) => p.id));
  return (
    <div className="lg-list">
      {rows.map((c) => (
        <LedgerRow key={c.playerId} c={c} mine={c.playerId === playerId} bot={bots.has(c.playerId)} />
      ))}
    </div>
  );
}

// La légende des six colonnes — sans elle les pastilles sont des rébus sur un écran
// où le survol n'existe pas.
export function LedgerLegend() {
  const { t } = useT();
  return (
    <div className="lg-legend">
      {COLS.map((c) => (
        <span key={c.key}>
          {c.icon} {t(c.label)}
        </span>
      ))}
    </div>
  );
}

// L'overlay ouvert depuis le Panneau, en ville.
export function TownLedger() {
  const open = useStore((s) => s.townLedgerOpen);
  const game = useStore((s) => s.game);
  const playerId = useStore((s) => s.playerId);
  const close = useStore((s) => s.toggleTownLedger);
  const { t } = useT();
  if (!open || !game) return null;

  const rows = buildLedger(game);

  return (
    <Overlay variant="sheet" onClose={() => close(false)} title={"🤝 " + t("Ce que la ville te doit")}>
      <>
        {rows.length === 0 ? (
          <div className="tj-empty">
            {t("Cette expédition n'a pas de joueurs enregistrés — le registre reste vide.")}
          </div>
        ) : (
          <>
            <div className="lg-intro">
              {t("Ce que chacun a apporté à {town}, dans l'ordre où vous êtes arrivés. Ce n'est pas un classement.", {
                town: game.town.name || t("la ville"),
              })}
            </div>
            <LedgerTable game={game} playerId={playerId} />
            <LedgerLegend />
          </>
        )}
        <button className="pill red ov-close" onClick={() => close(false)}>
          {t("Fermer")}
        </button>
      </>
    </Overlay>
  );
}
