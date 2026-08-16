import { useStore } from "../store";
import { Overlay } from "../ui/Overlay";

// LE TEMPLE — la faveur des dieux, et le scrutin qui la dépense.
//
// Trois lectures, dans l'ordre où on en a besoin : ce que la ville a accumulé (le
// compteur ⚡), qui veille déjà sur elle (les bénédictions en cours), et pour qui l'on
// vote. Le reste — comment gagner de la faveur — est dit en une ligne, parce que c'est
// la question que pose un joueur qui ouvre ce panneau pour la première fois et qu'aucun
// autre écran n'y répond.
//
// ⚠ RIEN N'EST RECOPIÉ DU SERVEUR : le panthéon, le coût d'un dieu et le nombre de
// places viennent du payload (`theme.pantheon`, `town.favorGoal`, `town.blessingSlots`).
// Une copie côté client divergerait au premier dieu ajouté — même règle que ThemeInfo.
export function TemplePanel() {
  const open = useStore((s) => s.templeOpen);
  const toggle = useStore((s) => s.toggleTemple);
  const game = useStore((s) => s.game);
  const playerId = useStore((s) => s.playerId);
  const vote = useStore((s) => s.voteBlessing);
  const busy = useStore((s) => s.busy);
  if (!open || !game) return null;

  const pantheon = game.theme?.pantheon;
  const town = game.town;
  const favor = town.favor ?? 0;
  const goal = town.favorGoal ?? 20;
  const slots = town.blessingSlots ?? 0;
  const blessings = town.blessings ?? [];
  const votes = town.votes ?? {};
  const myVote = playerId ? votes[playerId] : undefined;
  const temple = game.town.buildings.find((b) => b.id === "temple");
  const standing = !!temple?.built && temple.durability > 0;
  const freeSlot = blessings.length < slots;
  const tally = (godId: string) => Object.values(votes).filter((v) => v === godId).length;
  const close = () => toggle(false);

  return (
    <Overlay onClose={close} cardClassName="temple-modal" labelledBy="temple-title">
      <>
        <div className="bm-head">
          <span className="bm-icon">{pantheon?.favor ?? "⚡"}</span>
          <div className="bm-title">
            <strong id="temple-title">{pantheon?.temple ?? "Temple"}</strong>{" "}
            {temple?.built && <span className="lvl">Lv {temple.level}</span>}
          </div>
          <button className="hero-close" onClick={close}>
            ✕
          </button>
        </div>

        {/* LE COMPTEUR. Une jauge plutôt qu'un nombre nu : « 14 » ne dit pas si c'est
            beaucoup — « 14/20 » dit qu'il reste deux totems à tailler. */}
        <div className="favor-gauge">
          <div className="fg-head">
            <span className="fg-count">
              {pantheon?.favor ?? "⚡"} {favor}
              <i>/{goal}</i>
            </span>
            <span className="fg-note">
              {favor >= goal ? "un dieu peut être appelé" : `encore ${goal - favor} de faveur`}
            </span>
          </div>
          <div className="mini-bar">
            <i style={{ width: `${Math.min(100, (favor / Math.max(1, goal)) * 100)}%`, background: "var(--gold)" }} />
          </div>
          <div className="fg-hint">
            🏺 Fabriquer des <b>offrandes</b> à l'Atelier (onglet ⚒️, catégorie Décoration) verse de la
            faveur — elles se paient en bois, en pierre et en minerais, c'est-à-dire dans la même bourse
            que les remparts.
          </div>
        </div>

        {/* CE QUI VEILLE DÉJÀ. Avec la vague de fin : une bénédiction expire, et savoir
            quand est ce qui permet de préparer la suivante. */}
        {blessings.length > 0 && (
          <div className="temple-active">
            {blessings.map((b) => (
              <div className="ta-row" key={b.godId}>
                <span className="ta-ic">{b.icon}</span>
                <span className="ta-nm">{b.name}</span>
                <span className="ta-until">
                  jusqu'à la vague {b.untilWave}
                  {game.waveNumber > 0 && ` (encore ${Math.max(0, b.untilWave - game.waveNumber + 1)})`}
                </span>
              </div>
            ))}
          </div>
        )}

        {!standing ? (
          <div className="stock-note compact">
            🏛️ Il faut d'abord bâtir le {pantheon?.temple ?? "Temple"} (onglet 🏗️ Bâtir) — la faveur
            s'accumule en attendant, elle n'est pas perdue.
          </div>
        ) : (
          <>
            <div className="cap">
              {freeSlot
                ? `Le temple peut tenir ${slots} bénédiction${slots > 1 ? "s" : ""} à la fois · ${blessings.length} en cours. ` +
                  "Le dieu qui recueille le plus de voix répond DÈS LA PROCHAINE VAGUE."
                : "Toutes les places du temple sont prises — l'améliorer en ouvre une de plus."}
            </div>
            <div className="god-list">
              {(pantheon?.gods ?? []).map((g) => {
                const held = blessings.some((b) => b.domain === g.domain);
                const n = tally(g.id);
                const mine = myVote === g.id;
                // Le bouton ne promet que ce qu'il peut tenir : on peut toujours POSER sa
                // voix (elle vaudra pour le prochain dépouillement), mais pas pour un dieu
                // qui veille déjà — le serveur le refuse, autant l'éteindre ici.
                const why = held
                  ? `${g.name} veille déjà sur la ville`
                  : !playerId
                  ? "Rejoins l'expédition pour prendre part au vote"
                  : favor < goal
                  ? `Il manque ${goal - favor} de faveur — la voix reste posée jusque-là`
                  : !freeSlot
                  ? "Aucune place libre au temple — la voix reste posée"
                  : mine
                  ? "Retirer ma voix"
                  : `Donner ma voix à ${g.name}`;
                return (
                  <button
                    key={g.id}
                    className={`god-card${mine ? " mine" : ""}${held ? " held" : ""}`}
                    disabled={busy || held || !playerId}
                    title={why}
                    onClick={() => vote(mine ? "" : g.id)}
                  >
                    <span className="gc-ic">{g.icon}</span>
                    <span className="gc-main">
                      <span className="gc-nm">
                        {g.name}
                        <i className="gc-dom">{g.domain}</i>
                        {held && <i className="gc-held">en cours</i>}
                      </span>
                      <span className="gc-boon">{g.boon}</span>
                      <span className="gc-tag">{g.tagline}</span>
                    </span>
                    <span className="gc-votes">
                      {n > 0 ? `🗳 ${n}` : ""}
                      {mine && <i>ma voix</i>}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </>
    </Overlay>
  );
}
