// Display catalog for the Hero screen (page 5). Heroes are still classless in the
// engine; this drives the class name / tier / attribute bonuses / unique skills shown
// in the UI (mapped by roster index, like the hero chips). When the real class-evolution
// system lands, this is replaced by server-provided class data.

export type AttrKey = "force" | "dexterite" | "precision" | "agilite" | "endurance" | "athletisme";

export interface ClassSkill {
  name: string;
  scope: "Only Map" | "Only in fight";
  desc: string;
  icon: string;
}

export interface HeroClass {
  role: string;
  tier: string;
  bonuses: Partial<Record<AttrKey, number>>;
  movement: number;
  skills: ClassSkill[];
}

export const HERO_CLASSES: HeroClass[] = [
  {
    role: "Pioneer",
    tier: "Intermediate class",
    bonuses: { force: 2, endurance: 5 },
    movement: 1,
    skills: [
      { name: "Survivor's Push", scope: "Only Map", desc: "Force un passage là où les autres doivent contourner.", icon: "🏃" },
      { name: "Death Strike", scope: "Only in fight", desc: "Attaque puissante contre l'ennemi (+5 dégâts).", icon: "💥" },
    ],
  },
  {
    role: "Collector",
    tier: "Base class",
    bonuses: { athletisme: 3, agilite: 2, endurance: 1 },
    movement: 0,
    skills: [
      { name: "Portage", scope: "Only Map", desc: "Peut transporter un héros tombé jusqu'à la ville.", icon: "🧺" },
      { name: "Buff Athlétisme", scope: "Only in fight", desc: "+2 Athlétisme aux alliés proches.", icon: "💪" },
    ],
  },
  {
    role: "Scout",
    tier: "Base class",
    bonuses: { athletisme: 5, agilite: 3, endurance: 2 },
    movement: 1,
    skills: [
      { name: "Observation Large", scope: "Only Map", desc: "Vision étendue autour de lui (+1 case).", icon: "🔭" },
      { name: "Éclairer", scope: "Only in fight", desc: "Illumine 4 cases autour de lui (passif).", icon: "🔦" },
    ],
  },
];

export function classForIndex(i: number): HeroClass {
  return HERO_CLASSES[((i % HERO_CLASSES.length) + HERO_CLASSES.length) % HERO_CLASSES.length];
}

// Attribute rows in the order shown on the mockup.
export const ATTR_ROWS: { key: AttrKey; label: string }[] = [
  { key: "force", label: "Strength" },
  { key: "dexterite", label: "Dexterity" },
  { key: "precision", label: "Accuracy" },
  { key: "agilite", label: "Agility" },
  { key: "endurance", label: "Endurance" },
  { key: "athletisme", label: "Athleticism" },
];
