import { assetUrl, type AssetKey } from "../assets";
import type { Hero } from "../api/types";
import { useT } from "../i18n/useT";

// LA pastille de héros, partagée par toutes les listes de personnages : la barre
// de la Carte, la liste de l'écran Ville, le dropdown de la TopBar (et, de fait,
// la barre de combat, qui recopie déjà les mêmes classes `.mhb-*`).
//
// Elle a été extraite de `MapHeroBar` : c'était la seule des trois listes à
// montrer ce qu'on a besoin de savoir d'un héros (portrait de classe, PV, PA, où
// il est). Les deux autres affichaient soit rien (le dropdown : un nom et deux
// chiffres sur du verre bleu nuit), soit pire — l'écran Ville montrait la CLASSE
// du héros et, tant qu'il n'en avait pas, un libellé de secours en dur
// (« Pionnier », « Récupérateur »…) qui n'était le nom de personne.

// Portrait key for a hero class (same mapping as TopBar / HeroOverlay).
export function portraitKey(classId?: string): AssetKey {
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

export function HeroChip({
  hero,
  inTown,
  selected,
  onSelect,
  onOpenSheet,
  layout = "row",
  note,
}: {
  hero: Hero;
  inTown: boolean;
  selected: boolean;
  onSelect: () => void;
  /** Bouton ⓘ « fiche de personnage ». Omis = pas de bouton (le parent ouvre la fiche autrement). */
  onOpenSheet?: () => void;
  /** "row" = pastilles côte à côte (Carte) ; "column" = pleine largeur, empilées (Ville, dropdown). */
  layout?: "row" | "column";
  /** Ligne d'info supplémentaire sous les PA (ex. « paie les PA »). */
  note?: React.ReactNode;
}) {
  const T = useT();
  const dead = hero.hp <= 0;
  const stuck = hero.states.includes("Tétanisé");
  const hpPct = Math.max(0, Math.min(100, Math.round((hero.hp / hero.maxHp) * 100)));
  const hpClass = hpPct > 60 ? "" : hpPct > 30 ? "warn" : "low";
  const portrait = assetUrl(portraitKey(hero.classId));

  return (
    <div className={`mhb-chip ${layout === "column" ? "col" : ""} ${selected ? "sel" : ""} ${dead ? "dead" : ""}`}>
      <button
        className="mhb-pick"
        disabled={dead}
        title={T(dead ? "hero.chip.down" : "hero.chip.select", { name: hero.name })}
        onClick={onSelect}
      >
        <span className="mhb-portrait">
          {portrait ? <img src={portrait} alt="" /> : <span className="mhb-emoji">🙂</span>}
          {dead ? (
            <span className="mhb-badge dead">💀</span>
          ) : inTown ? (
            // ⚠ PAS `town` : `.town { position:absolute; inset:0 }` (le conteneur
            // de l'écran Ville) est une règle GLOBALE — le badge héritait de son
            // `inset` et s'étalait sur tout le portrait, qu'il recouvrait. C'est
            // le piège documenté dans CLAUDE.md §8, qui avait déjà attrapé
            // l'onglet Ville (renommé `ttown`) et le nom de ville de la TopBar.
            <span className="mhb-badge intown">🏰</span>
          ) : stuck ? (
            <span className="mhb-badge warn">🔒</span>
          ) : null}
        </span>
        <span className="mhb-info">
          <span className="mhb-name">{hero.name}</span>
          <span className="mhb-hpbar">
            <i className={hpClass} style={{ width: `${hpPct}%` }} />
          </span>
          <span className="mhb-pa">⚡ {hero.pa}/{hero.maxPa}</span>
          {note && <span className="mhb-note">{note}</span>}
        </span>
      </button>
      {onOpenSheet && (
        <button className="mhb-sheet" title={T("hero.chip.sheet")} onClick={onOpenSheet}>
          ⓘ
        </button>
      )}
    </div>
  );
}
