import { useStore } from "../store";
import { bus, EV } from "../eventBus";
import { assetUrl, type AssetKey } from "../assets";
import type { CombatUnit } from "../api/types";

// Portrait key for a hero class (same mapping as the map hero bar / TopBar).
function portraitKey(classId?: string): AssetKey {
  const map: Record<string, AssetKey> = {
    pionnier: "hero-pionnier",
    chasseur: "hero-chasseur",
    eclaireur: "hero-eclaireur",
    gardien: "hero-gardien",
    recuperateur: "hero-recuperateur",
    herboriste: "hero-herboriste",
  };
  return (classId && map[classId]) || "hero-sans-classe";
}

// Barre des héros EN COMBAT — réutilise le langage visuel de MapHeroBar (§7). Une
// pastille par unité héros de MON équipe : portrait, nom, barre de PV, et un
// badge « à toi » (▶) sur l'unité dont c'est le tour. Taper recentre la caméra de
// combat sur l'unité (bus CombatFocusUnit) — pratique dans une arène 9×9 de boss.
export function CombatHeroBar() {
  const combat = useStore((s) => s.combat);
  const current = useStore((s) => s.current);
  const playerId = useStore((s) => s.playerId);
  if (!combat) return null;

  // MES unités héros (légataire : toutes ; multi : celles que je possède).
  const mine = combat.units.filter(
    (u) => u.side === "hero" && (!u.ownerId || !playerId || u.ownerId === playerId),
  );
  if (mine.length === 0) return null;

  const focus = (u: CombatUnit) => {
    if (u.hp <= 0 || u.fled) return;
    bus.emit(EV.CombatFocusUnit, { x: u.x, y: u.y });
  };

  return (
    <div className="map-herobar combat">
      <div className="mhb-row">
        {mine.map((u) => {
          const down = u.hp <= 0 || u.fled;
          const isTurn = u.id === current?.unitId;
          const hpPct = Math.max(0, Math.min(100, Math.round((u.hp / u.maxHp) * 100)));
          const hpClass = hpPct > 60 ? "" : hpPct > 30 ? "warn" : "low";
          const portrait = assetUrl(portraitKey(u.classId));
          return (
            <button
              key={u.id}
              className={`mhb-chip ${isTurn ? "sel" : ""} ${down ? "dead" : ""}`}
              disabled={down}
              title={down ? `${u.name} est à terre` : `Centrer la caméra sur ${u.name}`}
              onClick={() => focus(u)}
            >
              <span className="mhb-pick">
                <span className="mhb-portrait">
                  {portrait ? <img src={portrait} alt="" /> : <span className="mhb-emoji">🙂</span>}
                  {u.fled ? (
                    <span className="mhb-badge warn">🏃</span>
                  ) : down ? (
                    <span className="mhb-badge dead">💀</span>
                  ) : isTurn ? (
                    // ⚠ PAS `town` : la règle globale `.town { inset: 0 }` étalait
                    // ce badge sur tout le portrait (cf. CLAUDE.md §8).
                    <span className="mhb-badge turn">▶</span>
                  ) : null}
                </span>
                <span className="mhb-info">
                  <span className="mhb-name">{u.name}</span>
                  <span className="mhb-hpbar">
                    <i className={hpClass} style={{ width: `${hpPct}%` }} />
                  </span>
                  <span className="mhb-pa">❤️ {Math.max(0, u.hp)}/{u.maxHp}</span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
