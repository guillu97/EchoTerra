// Asset manifest for EchoTerra.
// Style prefix applied to all prompts — edit this to change the overall art style.
export const STYLE =
  "2D game icon, pixel art, fantasy RPG survival game, dark medieval atmosphere, transparent background, clean linework, flat shading, 64x64";

// Each entry:
//   id       — unique key (also used to skip if already generated)
//   category — sub-folder under frontend/public/assets/
//   filename — output file name (.png)
//   prompt   — the prompt sent to Perchance (STYLE is prepended automatically)
//   note     — where this asset is used in the game (for reference)
export const ASSETS = [
  // ── Buildings ────────────────────────────────────────────────────────────────
  {
    id: "building-gate",
    category: "buildings",
    filename: "gate.png",
    prompt: "medieval wooden fortified gate entrance, village wall opening, isometric view",
    note: "HomeTab building icon — gate",
  },
  {
    id: "building-wall",
    category: "buildings",
    filename: "wall.png",
    prompt: "stone defensive wall section, medieval fortification, isometric view, thick stone bricks",
    note: "HomeTab building icon — wall",
  },
  {
    id: "building-bank",
    category: "buildings",
    filename: "bank.png",
    prompt: "fantasy merchant treasury building, wooden chest inside a fortified room, isometric view",
    note: "HomeTab building icon — bank / storage",
  },
  {
    id: "building-well",
    category: "buildings",
    filename: "well.png",
    prompt: "medieval stone water well with wooden bucket and rope, village well, isometric view",
    note: "HomeTab building icon — well",
  },
  {
    id: "building-workshop",
    category: "buildings",
    filename: "workshop.png",
    prompt: "blacksmith workshop, anvil and forge, wooden shed, isometric view, smoke from chimney",
    note: "HomeTab building icon — workshop",
  },
  {
    id: "building-tower",
    category: "buildings",
    filename: "tower.png",
    prompt: "medieval stone watch tower, arrow slits, crenellations, isometric view, dark stone",
    note: "HomeTab building icon — tower",
  },
  {
    id: "building-townhall",
    category: "buildings",
    filename: "townhall.png",
    prompt: "fantasy stone town hall building, banner on roof, medieval architecture, isometric view",
    note: "HomeTab building icon — townhall (revive heroes)",
  },
  {
    id: "building-kitchen",
    category: "buildings",
    filename: "kitchen.png",
    prompt: "medieval outdoor kitchen, campfire with cooking pot, wooden structure, isometric view",
    note: "HomeTab building icon — kitchen (crafting)",
  },
  {
    id: "building-panel",
    category: "buildings",
    filename: "panel.png",
    prompt: "wooden notice board with parchment papers pinned, medieval village bulletin board, isometric view",
    note: "HomeTab building icon — town notice board",
  },

  // ── Town island ───────────────────────────────────────────────────────────────
  {
    id: "town-island",
    category: "bg",
    filename: "town-island.png",
    prompt:
      "small fantasy medieval village on a round island, top-down isometric view, stone walls, buildings inside fortification, 128x128 game icon, dark sky background",
    note: "HomeTab central island illustration (currently 🏰 emoji)",
  },

  // ── Heroes ────────────────────────────────────────────────────────────────────
  {
    id: "hero-sans-classe",
    category: "heroes",
    filename: "hero-0.png",
    prompt:
      "fantasy RPG adventurer portrait, young traveler with simple cloth clothes, determined face, bust portrait, painterly style",
    note: "HeroOverlay portrait — hero without class (tier 0)",
  },
  {
    id: "hero-pionnier",
    category: "heroes",
    filename: "hero-pionnier.png",
    prompt:
      "fantasy RPG pioneer adventurer portrait, rugged survivor with leather armor and axe, determined expression, bust portrait, painterly style",
    note: "HeroOverlay portrait — Pionnier class",
  },
  {
    id: "hero-chasseur",
    category: "heroes",
    filename: "hero-chasseur.png",
    prompt:
      "fantasy RPG hunter archer portrait, precise hunter with bow and quiver, hood, focused eyes, bust portrait, painterly style",
    note: "HeroOverlay portrait — Chasseur class",
  },
  {
    id: "hero-eclaireur",
    category: "heroes",
    filename: "hero-eclaireur.png",
    prompt:
      "fantasy RPG scout portrait, agile scout with short sword and light armor, quick confident expression, bust portrait, painterly style",
    note: "HeroOverlay portrait — Éclaireur class",
  },
  {
    id: "hero-gardien",
    category: "heroes",
    filename: "hero-gardien.png",
    prompt:
      "fantasy RPG guardian tank portrait, heavily armored paladin with large shield, protective stern face, bust portrait, painterly style",
    note: "HeroOverlay portrait — Gardien class",
  },
  {
    id: "hero-recuperateur",
    category: "heroes",
    filename: "hero-recuperateur.png",
    prompt:
      "fantasy RPG scavenger portrait, resourceful scavenger with large backpack and rope, clever smiling face, bust portrait, painterly style",
    note: "HeroOverlay portrait — Récupérateur class",
  },
  {
    id: "hero-herboriste",
    category: "heroes",
    filename: "hero-herboriste.png",
    prompt:
      "fantasy RPG herbalist portrait, wise healer with herb pouch and staff, calm knowing expression, bust portrait, painterly style",
    note: "HeroOverlay portrait — Herboriste class",
  },

  // ── UI ────────────────────────────────────────────────────────────────────────
  {
    id: "nav-home",
    category: "ui",
    filename: "nav-home.png",
    prompt: "small medieval house icon, pixel art, fantasy RPG UI, 24x24, transparent background",
    note: "BottomNav — Home tab icon",
  },
  {
    id: "nav-map",
    category: "ui",
    filename: "nav-map.png",
    prompt: "fantasy treasure map scroll icon, pixel art, RPG UI, 24x24, transparent background",
    note: "BottomNav — Map tab icon",
  },
  {
    id: "nav-stock",
    category: "ui",
    filename: "nav-stock.png",
    prompt: "adventurer backpack icon, pixel art, fantasy RPG UI, 24x24, transparent background",
    note: "BottomNav — Stock tab icon",
  },
  {
    id: "nav-structure",
    category: "ui",
    filename: "nav-structure.png",
    prompt: "medieval construction scaffolding icon, pixel art, fantasy RPG UI, 24x24, transparent background",
    note: "BottomNav — Structure tab icon",
  },
  {
    id: "nav-craft",
    category: "ui",
    filename: "nav-craft.png",
    prompt: "hammer and anvil crafting icon, pixel art, fantasy RPG UI, 24x24, transparent background",
    note: "BottomNav — Craft tab icon",
  },

  // ── Title screen ─────────────────────────────────────────────────────────────
  {
    id: "bird",
    category: "ui",
    filename: "bird.png",
    prompt:
      "cute fantasy bird perched on branch, colorful feathers, storybook illustration style, side view, transparent background, 128x128",
    note: "TitleScreen — animated bird (currently 🐦 emoji)",
  },
  {
    id: "shinki-npc",
    category: "npc",
    filename: "shinki.png",
    prompt:
      "cute fox spirit NPC guide character portrait, friendly glowing eyes, mystical, small, bust portrait, fantasy game style, transparent background, 64x64",
    note: "HomeTab — Shinki NPC (currently 🦊 emoji)",
  },

  // ── Game over ─────────────────────────────────────────────────────────────────
  {
    id: "skull",
    category: "ui",
    filename: "skull.png",
    prompt:
      "dark fantasy skull icon, grim game over symbol, medieval style, slightly glowing red eyes, transparent background, 96x96, pixel art",
    note: "GameOver screen — skull (currently 💀 emoji)",
  },
];
