import { useStore } from "../store";
import { Overlay } from "../ui/Overlay";
import { useWaveRemaining, formatHMS } from "../useWave";
import { buildingIcon, buildingName } from "../data/buildings";
import { damageRange, damageSentence, precisionSentence, besiegingSentence } from "../forecast";
import { durColor } from "../tabs/HomeTab";
import { buildingKnown } from "../townUtils";

const DEFENSIVE = ["wall", "gate", "tower"];

// Overlay showing the town's defensive state: HP, the defense breakdown (which buildings
// protect the town and by how much), every building's durability, and the last wave.
export function TownStatus() {
  const open = useStore((s) => s.townStatusOpen);
  const game = useStore((s) => s.game);
  const close = useStore((s) => s.toggleTownStatus);
  const remaining = useWaveRemaining(game);
  if (!open || !game) return null;

  const t = game.town;
  const lw = game.lastWave;
  const fc = t.forecast;
  // Un bâtiment dont le plan n'a pas encore été trouvé n'existe pas pour le joueur
  // (townUtils.buildingKnown) : il n'a pas plus sa place dans l'état de la ville que
  // dans la liste des chantiers — même règle partout, sinon la Tour disparaît d'un
  // écran et reste nommée dans l'autre.
  const known = t.buildings.filter((b) => buildingKnown(game, b));
  const defensive = known.filter((b) => DEFENSIVE.includes(b.id));

  return (
    <Overlay variant="sheet" onClose={() => close(false)} title="🏰 État de la ville">
      <>

        {/* LA NATURE DE L'EXPÉDITION (backend theme.go). Un thème n'est pas qu'une
            couleur : il porte une contrainte (la soif en désert), et une contrainte
            doit être ANNONCÉE, sinon c'est une punition. C'est ici qu'un joueur vient
            comprendre la situation de sa ville. */}
        {game.theme && game.theme.id !== "tempere" && (
          <div className="ts-theme">
            <b>
              {game.theme.emoji} {game.theme.name}
            </b>
            <span>{game.theme.tagline}</span>
          </div>
        )}

        <div className="ts-hp">
          <span>🏰 PV ville {t.hp}/{t.maxHp}</span>
          <div className="mini-bar" style={{ marginTop: 4 }}>
            <i style={{ width: `${(t.hp / t.maxHp) * 100}%`, background: durColor(t.hp / t.maxHp) }} />
          </div>
        </div>

        <div className="ts-grid">
          <div>🛡️ Défense <b>{t.defense}</b></div>
          <div>⏳ Prochaine vague <b>{formatHMS(remaining)}</b></div>
          <div>🌊 Vagues subies <b>{game.waveNumber}</b></div>
          <div>📅 Jour <b>{game.day}</b></div>
        </div>

        {/* LA PRÉVISION DE VAGUE — ce que dit la pastille rouge de la TopBar, en
            toutes lettres. C'est ELLE qu'on ouvre en tapant la pastille, or elle ne
            portait pas un mot de la prévision : le chiffre « −0…16 » n'était
            explicité que par un `title=`, qu'un doigt ne peut pas révéler. Tout est
            dérivé du serveur (game/orders.go) et mis en mots par forecast.ts, donc
            la version courte et la longue ne peuvent pas diverger. */}
        {game.status === "active" && fc && (
          <>
            <h4>🌊 Prochaine vague — dans {formatHMS(remaining)}</h4>
            <div className={"ts-fc" + (fc.fatal ? " fatal" : fc.atRisk ? " risk" : "")}>
              <div className="ts-fc-head">
                <b className="ts-fc-dmg">{damageRange(fc)} PV</b>
                <span>{damageSentence(fc)}</span>
              </div>
              <div className="ts-fc-line">🔭 {precisionSentence(fc)}</div>
              <div className="ts-fc-line">☠️ {besiegingSentence(fc)}</div>
              {fc.fatal ? (
                <div className="ts-fc-warn">⚠️ Même au mieux, la ville n'y survit pas.</div>
              ) : (
                fc.atRisk && <div className="ts-fc-warn">⚠️ Au pire, la ville n'y survit pas.</div>
              )}
            </div>
          </>
        )}

        <h4>Défense — total 🛡 {t.defense}</h4>
        <div className="ts-def">
          {defensive.map((b) => {
            const ratio = b.maxDurability > 0 ? b.durability / b.maxDurability : 0;
            const val = !b.built
              ? "non construit"
              : b.id === "gate" && b.open
              ? "0 (ouverte)"
              : `+${b.defense}`;
            return (
              <div className="ts-defrow" key={b.id}>
                <span className="ts-dn">{buildingIcon(b.id)} {buildingName(b.id, b.name)}</span>
                <span className={`ts-dval ${b.built && val.startsWith("+") ? "" : "muted"}`}>{val}</span>
                <span className="ts-dur" style={{ color: durColor(ratio) }}>
                  {b.built ? `🛡 ${Math.round(ratio * 100)}%` : "—"}
                </span>
              </div>
            );
          })}
          {/* LA GARNISON — le seul terme de la défense qu'on change en marchant. */}
          <div className="ts-defrow">
            <span className="ts-dn">🧍 Garnison ({t.garrison ?? 0} aux remparts)</span>
            <span className={`ts-dval ${(t.garrisonValue ?? 0) > 0 ? "" : "muted"}`}>
              {(t.garrisonValue ?? 0) > 0 ? `+${t.garrisonValue}` : "personne"}
            </span>
            <span className="ts-dur muted">—</span>
          </div>
          <div className="ts-defnote">
            La défense absorbe la horde ; une durabilité basse ou une porte ouverte la réduit.
            Un héros présent dans les murs à l'heure de la vague DÉFEND — sans pouvoir récolter
            ce tour-là. La garnison ne dépasse jamais ce que les bâtiments tiennent : on ne
            défend que le rempart qu'on a bâti.
          </div>
        </div>

        <h4>Tous les bâtiments</h4>
        <div className="ts-buildings">
          {known.map((b) => (
            <div className="ts-b" key={b.id}>
              <span className="ts-name">
                {b.built ? buildingIcon(b.id) : "🏗️"} {buildingName(b.id, b.name)}{" "}
                {b.built ? <span className="lvl">Lv {b.level}</span> : <span className="muted">chantier</span>}
                {b.defense > 0 && <span className="ts-defbadge">🛡+{b.defense}</span>}
              </span>
              <div className="mini-bar">
                <i style={{ width: `${b.built ? (b.durability / b.maxDurability) * 100 : 0}%`, background: durColor(b.maxDurability ? b.durability / b.maxDurability : 0) }} />
              </div>
              <span className="ts-d">{b.built ? `${b.durability}/${b.maxDurability}` : "—"}</span>
            </div>
          ))}
        </div>

        {lw && (
          <>
            <h4>Dernière vague (#{lw.wave})</h4>
            <div className="ts-report">
              <div>Horde <b>{lw.hordePower}</b> · Défense <b>{lw.defense}</b> · Dégâts ville <b className="lost">−{lw.townDamage}</b></div>
              {(lw.buildingsHit ?? []).length > 0 && (
                <div>Bâtiments : {(lw.buildingsHit ?? []).map((h) => `${buildingName(h.id, h.name)} ${h.delta}`).join(", ")}</div>
              )}
              {(lw.heroesHit ?? []).length > 0 && (
                <div>Héros hors ville : {(lw.heroesHit ?? []).map((h) => `${h.name} ${h.delta}`).join(", ")}</div>
              )}
              <div>Monstres apparus : {lw.monstersSpawned}</div>
            </div>
          </>
        )}

        <button className="pill green ov-close" onClick={() => close(false)}>
          Fermer
        </button>
      </>
    </Overlay>
  );
}
