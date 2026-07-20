import type { MapSkillDef } from "./api/types";

// Compétences de carte disponibles pour un héros — miroir client de
// MapSkillsForClass (serveur) : les compétences de SA classe, ou la compétence
// de base (classId "") si sa classe n'en a aucune (héros sans classe).
export function mapSkillsForHero(catalog: MapSkillDef[], classId?: string): MapSkillDef[] {
  const own = catalog.filter((s) => s.classId === (classId ?? ""));
  if (own.length > 0) return own;
  return catalog.filter((s) => s.classId === "");
}
