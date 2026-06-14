import { useStore } from "../store";
import { useWaveRemaining, formatHMS } from "../useWave";
import { buildingIcon } from "../data/buildings";
import { durColor } from "../tabs/HomeTab";

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
  const defensive = t.buildings.filter((b) => DEFENSIVE.includes(b.id));

  return (
    <div className="settings" onClick={() => close(false)}>
      <div className="panel-card" onClick={(e) => e.stopPropagation()}>
        <div className="banner">État de la ville</div>

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
                <span className="ts-dn">{buildingIcon(b.id)} {b.name}</span>
                <span className={`ts-dval ${b.built && val.startsWith("+") ? "" : "muted"}`}>{val}</span>
                <span className="ts-dur" style={{ color: durColor(ratio) }}>
                  {b.built ? `🛡 ${Math.round(ratio * 100)}%` : "—"}
                </span>
              </div>
            );
          })}
          <div className="ts-defnote">La défense absorbe la horde ; une durabilité basse ou une porte ouverte la réduit.</div>
        </div>

        <h4>Tous les bâtiments</h4>
        <div className="ts-buildings">
          {t.buildings.map((b) => (
            <div className="ts-b" key={b.id}>
              <span className="ts-name">
                {b.built ? buildingIcon(b.id) : "🏗️"} {b.name}{" "}
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
              {lw.buildingsHit.length > 0 && (
                <div>Bâtiments : {lw.buildingsHit.map((h) => `${h.name} ${h.delta}`).join(", ")}</div>
              )}
              {lw.heroesHit.length > 0 && (
                <div>Héros hors ville : {lw.heroesHit.map((h) => `${h.name} ${h.delta}`).join(", ")}</div>
              )}
              <div>Monstres apparus : {lw.monstersSpawned}</div>
            </div>
          </>
        )}

        <button className="pill green" style={{ width: "100%", marginTop: 12 }} onClick={() => close(false)}>
          Fermer
        </button>
      </div>
    </div>
  );
}
