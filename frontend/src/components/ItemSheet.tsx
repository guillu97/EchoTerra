// LA FICHE D'UN OBJET — ce que c'est, et ce qu'on peut en faire.
//
// L'inventaire était une VITRINE : une icône, un nom (tronqué), une quantité. Ce
// que fait une Ration d'eau, ce que vaut une Lame de fer, à quoi sert un « Plan de
// la Recyclerie » — le jeu le savait (`GET /api/items`, `GET /api/equipment`) et ne
// le disait nulle part. Le survol ne compte pas : sur un téléphone il n'existe pas.
//
// D'où une FEUILLE, ouverte au tap sur n'importe quel objet : elle dit ce que
// l'objet fait, puis propose les deux seules actions qui existent — le consommer,
// le porter.
//
// ⚠ ELLE NE PROPOSE QUE CE QUE LE SERVEUR ACCEPTE, jamais un bouton qui échouera :
//   • **Utiliser** (`POST /heroes/{h}/use`) prend dans le sac du héros — ou, EN
//     VILLE, dans la réserve commune (la « cantine » de game/items.go). C'est ce qui
//     rend le bouton possible sur la Banque : il faut alors un héros DANS les murs.
//   • **Équiper** (`POST /heroes/{h}/equip`) exige l'objet dans le sac DE CE
//     HÉROS (game/equipment.go) — donc jamais depuis la Banque.

import type { Hero, Item, ItemEffect, EquipDef } from "../api/types";
import { itemAssetUrl } from "../assets";
import { Overlay } from "../ui/Overlay";
import { itemEmoji } from "./ItemGrid";

const TYPE_LABEL: Record<string, string> = {
  aliment: "Aliment",
  eau: "Eau",
  plante: "Plante",
  minerai: "Minerai",
  objet: "Objet",
  animal: "Animal",
  arme: "Arme",
  consommable: "Consommable",
  deco: "Décoration",
};

const SLOT_LABEL: Record<string, string> = { arme: "Arme", equipement: "Équipement" };
const STAT_LABEL: Record<string, string> = {
  force: "force",
  dexterite: "dextérité",
  agilite: "agilité",
  endurance: "endurance",
};

/** Les lignes « ce que ça fait » d'un consommable (backend game/items.go). */
function useLines(e: ItemEffect): string[] {
  const out: string[] = [];
  if (e.pa) out.push(`+${e.pa} PA`);
  if (e.hp) out.push(`+${e.hp} PV`);
  if (e.clearsAll) out.push("retire TOUS les états");
  else if (e.clears?.length) out.push(`retire ${e.clears.join(", ")}`);
  return out;
}

/** MIROIR de `GameState.itemWouldHelp` (backend game/items.go) : le serveur refuse
 *  un objet qui n'apporterait rien (héros déjà au mieux). On grise donc le bouton
 *  plutôt que de laisser le joueur récolter une erreur — et on lui DIT pourquoi.
 *  ⚠ à garder aligné sur le serveur : diverger, c'est promettre ou refuser à tort. */
export function itemWouldHelp(h: Hero, e: ItemEffect): boolean {
  if (e.pa && h.pa < h.maxPa) return true;
  if (e.hp && h.hp < h.maxHp) return true;
  const states = h.states ?? [];
  if (e.clearsAll && states.length > 0) return true;
  return (e.clears ?? []).some((st) => states.includes(st));
}

/** Les lignes « porté au combat » (backend game/equipment.go). ⚠ les bonus sont
 *  prêtés à l'unité de combat, jamais greffés sur les attributs du héros — la
 *  fiche le dit, sinon le joueur cherche le +2 sur sa page de personnage. */
function gearLines(d: EquipDef): string[] {
  const out: string[] = [];
  for (const k of ["force", "dexterite", "agilite", "endurance"] as const) {
    const v = d[k];
    if (v) out.push(`${v > 0 ? "+" : ""}${v} ${STAT_LABEL[k]}`);
  }
  if (d.armor) out.push(`armure ${d.armor} (dégâts subis en moins)`);
  if (d.reach) out.push(`portée ${d.reach} (l'attaque de base atteint plus loin)`);
  if (d.vsCursed) out.push(`+${d.vsCursed} contre les créatures maudites`);
  return out;
}

export function ItemSheet({
  item,
  effect,
  gear,
  ownerName,
  canUse,
  whyNoUse,
  canEquip,
  busy,
  onUse,
  onEquip,
  onClose,
}: {
  item: Item;
  effect?: ItemEffect;
  gear?: EquipDef;
  /** à qui appartient le sac (ou la Banque) — le joueur doit savoir qui agit */
  ownerName: string;
  canUse: boolean;
  /** pourquoi « Utiliser » est éteint (vide = il ne l'est pas) */
  whyNoUse?: string;
  canEquip: boolean;
  busy: boolean;
  onUse: () => void;
  onEquip: () => void;
  onClose: () => void;
}) {
  const url = itemAssetUrl(item);
  const effects = effect ? useLines(effect) : [];
  const worn = gear ? gearLines(gear) : [];
  const isPlan = item.name.startsWith("Plan ");
  return (
    <Overlay variant="sheet" onClose={onClose} labelledBy="item-sheet-title">
      <div className="item-sheet">
        <div className="isheet-head">
          <div className="isheet-ic">
            {url ? <img src={url} alt="" /> : <span>{itemEmoji(item)}</span>}
          </div>
          <div className="isheet-id">
            <b id="item-sheet-title">{item.name}</b>
            <span className="muted">
              {TYPE_LABEL[item.type] ?? item.type} · ×{item.qty} · {ownerName}
            </span>
          </div>
          <button className="hero-close" onClick={onClose} aria-label="Fermer">✕</button>
        </div>

        {effect && (
          <div className="isheet-block">
            <h5>🍽️ En le consommant</h5>
            {effects.length > 0 && <div className="isheet-tags">{effects.map((t) => <span key={t}>{t}</span>)}</div>}
            {effect.desc && <p>{effect.desc}</p>}
          </div>
        )}

        {gear && (
          <div className="isheet-block">
            <h5>{gear.slot === "arme" ? "🗡️" : "🧥"} Porté — {SLOT_LABEL[gear.slot] ?? gear.slot}</h5>
            {worn.length > 0 && <div className="isheet-tags">{worn.map((t) => <span key={t}>{t}</span>)}</div>}
            {gear.desc && <p>{gear.desc}</p>}
            <p className="muted small">Ces bonus ne jouent qu'au combat.</p>
          </div>
        )}

        {!effect && !gear && (
          <div className="isheet-block">
            <p className="muted">
              {isPlan
                ? "Plan de construction : dépose-le à la Banque, il sera consommé quand la ville posera ce chantier."
                : "Ni consommable ni portable : c'est une ressource — elle sert aux recettes de l'Atelier et aux chantiers, une fois déposée à la Banque."}
            </p>
          </div>
        )}

        <div className="isheet-actions">
          {effect && (
            <button className="isheet-use" disabled={busy || !canUse} onClick={onUse}>
              🍽️ Utiliser
            </button>
          )}
          {gear && (
            <button className="isheet-equip" disabled={busy || !canEquip} onClick={onEquip}>
              {gear.slot === "arme" ? "🗡️" : "🧥"} Équiper
            </button>
          )}
          <button onClick={onClose}>Fermer</button>
        </div>
        {/* Pourquoi un bouton est éteint — sans ça le joueur croit à une panne. */}
        {effect && !canUse && whyNoUse && <p className="isheet-why muted small">{whyNoUse}</p>}
        {gear && !canEquip && (
          <p className="isheet-why muted small">On ne s'équipe que depuis le sac d'un héros, pas depuis la Banque.</p>
        )}
      </div>
    </Overlay>
  );
}
