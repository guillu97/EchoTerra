// Asset manifest for EchoTerra.
//
// ── ART DIRECTION (single source of truth) ───────────────────────────────────
// `DA` is the shared art direction. EVERY asset prompt is built from it, so
// buildings, heroes, UI icons, map tiles, the island and the background all read
// as one cohesive game. Edit DA to restyle the WHOLE game at once, then re-run the
// generator. The per-role constants below (STYLE/SCENE/TILE_STYLE) only add framing
// on top of DA — they intentionally do NOT introduce a different look.
// DA is STYLE ONLY — medium, palette, lighting, linework. It must NOT contain any
// subject/theme words (e.g. "village"), or abstract assets like UI icons drift toward
// that subject. The subject lives in each asset's own `prompt`.
export const DA =
  "cohesive soft storybook fantasy game art, hand-painted illustration, warm pastel palette, " +
  "gentle soft directional lighting, clean rounded shapes, subtle dark outline, " +
  "consistent art direction, high quality, no text, no watermark";

// Per-role framing layered on the shared DA. "no frame/border" avoids the model
// drawing an app-icon tile; "plain white background" makes rembg cut-out clean.
export const STYLE = `${DA}, single centered subject, plain white background, no frame, no border`; // buildings, heroes, UI

// Each entry:
//   id             — unique key (also used to skip if already generated)
//   category       — sub-folder under frontend/public/assets/
//   filename       — output file name (.png)
//   prompt         — the prompt (STYLE is prepended automatically)
//   note           — where this asset is used in the game (for reference)
//   style?         — override the global STYLE prefix for this asset ("" = no prefix)
//   width?,height? — output px (default: square COMFY_SIZE). Use for backgrounds/tiles.
//   keepBackground?— if true, the generator's --rembg pass SKIPS this asset (keep it opaque:
//                    full-bleed backgrounds and seamless map tiles must NOT be cut out)

// Illustrative scene framing (app background + isometric town island).
export const STORYBOOK = `${DA}, illustrative scene`;

// Seamless top-down terrain framing for the orthogonal map tiles.
export const TILE_STYLE =
  `${DA}, top-down orthogonal seamless terrain tile, flat even lighting, no border, no shadow, no objects`;

// Isometric CUBE tile framing — for the iso Home grid AND the iso combat biomes
// (one shared tileset). Chunky stylized blocks with a top diamond face + two side faces.
export const ISO_TILE =
  `${DA}, a single isometric cube block tile, chunky stylized game tile with a top face and two visible side faces, centered, nothing else`;

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
    prompt: "isometric fantasy treasury building, solid stone and timber walls with a tiled roof, a sturdy closed vault, a golden coin chest visible through a small arched doorway, isometric view",
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
    prompt: "isometric small wooden notice-board kiosk, a standing structure with a slanted shingle roof over a board with pinned parchment notices, village bulletin post, isometric view",
    note: "HomeTab building icon — town notice board",
  },
  {
    id: "building-scaffold",
    category: "buildings",
    filename: "scaffold.png",
    prompt:
      "isometric wooden construction scaffolding on a stone foundation, building site under construction, wooden beams planks and ladders, no finished walls, isometric view",
    note: "Generic 'en construction' overlay shown on Home for any under-construction building",
  },
  {
    id: "bridge",
    category: "bg",
    filename: "bridge.png",
    prompt:
      "a single straight wooden rope-and-plank bridge walkway spanning a gap, horizontal left-to-right, wooden planks with rope rails, side three-quarter view, nothing else",
    width: 768,
    height: 384,
    note: "Home — bridge connecting floating islands (rotated/scaled per connection)",
  },

  // ── Baked island scenes (Z-Image — chosen style). Buildings baked into each island. ─
  {
    id: "scene-core-built",
    category: "islands",
    filename: "core-built.png",
    style: STORYBOOK,
    prompt:
      "a single isometric floating island, lush grass top with a round cobblestone plaza and a low stone perimeter wall, rocky earth underside floating in the air; on the plaza stand three small buildings: a medieval town hall with a banner, a stone-and-timber treasury house, and a wooden notice board; cozy fortified sky hamlet, centered, nothing else",
    width: 1024,
    height: 1024,
    note: "Core (civic) island, buildings baked in (built state)",
  },
  {
    id: "scene-defense-built",
    category: "islands",
    filename: "defense-built.png",
    style: STORYBOOK,
    prompt:
      "a single isometric floating island, grass top with a low stone rim, rocky earth underside floating in the air; on it stand a fortified wooden gate with a stone arch and iron studs, a round crenellated stone watchtower, and a thick stone defensive wall section; cozy fortified sky outpost, centered, nothing else",
    width: 1024,
    height: 1024,
    note: "Defense island, buildings baked in (built state)",
  },
  {
    id: "scene-production-built",
    category: "islands",
    filename: "production-built.png",
    style: STORYBOOK,
    prompt:
      "a single isometric floating island, lush grass top, rocky earth underside floating in the air; on it stand a blacksmith workshop with a smoking stone chimney and a glowing forge, a medieval stone water well with a small wooden roof and bucket, and an outdoor campfire kitchen with a cooking pot over a fire; cozy crafting sky yard, centered, nothing else",
    width: 1024,
    height: 1024,
    note: "Production island, buildings baked in (built state)",
  },
  {
    id: "scene-core-wip",
    category: "islands",
    filename: "core-wip.png",
    style: STORYBOOK,
    prompt:
      "a single isometric floating island, lush grass top with a round cobblestone plaza and a low stone perimeter wall, rocky earth underside floating in the air; on the plaza stand a finished stone-and-timber treasury house and a wooden notice board, plus one building still under construction shown as wooden scaffolding on a stone foundation; cozy fortified sky hamlet, centered, nothing else",
    width: 1024,
    height: 1024,
    note: "POC — core island, one building under construction (state variant)",
  },

  // POC — Ideogram v4 structured-JSON island (precise bbox placement). raw:true sends
  // the JSON verbatim. bbox is [y1,x1,y2,x2] in 0-1000. Generate with COMFY_BACKEND=ideogram.
  {
    id: "scene-core-ideo",
    category: "islands",
    filename: "core-ideo.png",
    raw: true,
    width: 1024,
    height: 1024,
    prompt:
      '{"aspect_ratio":"1:1","high_level_description":"An isometric floating island village with a town hall, a treasury house and a wooden notice board on a round cobblestone plaza, soft storybook fantasy game art, on a transparent background.","style_description":{"aesthetics":"cohesive soft storybook fantasy game art, hand-painted illustration, warm pastel palette, clean rounded shapes, subtle dark outline","lighting":"gentle soft directional daylight","medium":"hand-painted digital illustration","color_palette":["#9CCB6B","#C9A36A","#E8D8A0","#7FB0D8","#3B2E25"]},"compositional_deconstruction":{"background":"fully transparent background, nothing behind the island","elements":[{"type":"obj","bbox":[280,120,965,880],"desc":"a single isometric floating island, lush green grass top with a round tan cobblestone plaza and a low stone perimeter wall, rocky brown earth underside floating in the air","color_palette":["#9CCB6B","#8A6A45","#C9B98A"]},{"type":"obj","bbox":[235,400,560,650],"desc":"a small medieval town hall building with a pointed tower roof and a small banner, stone and timber walls","color_palette":["#C9A36A","#A33B3B","#E8E0C8"]},{"type":"obj","bbox":[360,175,625,420],"desc":"a small stone-and-timber treasury house with a tiled roof and an arched wooden door","color_palette":["#C9A36A","#9A7B4F"]},{"type":"obj","bbox":[385,640,600,825],"desc":"a small wooden notice board kiosk with a slanted shingle roof and pinned parchment notices","color_palette":["#9A7B4F","#EFE6C8"]}]}}',
    note: "POC — Ideogram v4 bbox-composed core island (built state)",
  },
  {
    id: "scene-defense-ideo",
    category: "islands",
    filename: "defense-ideo.png",
    raw: true,
    width: 1024,
    height: 1024,
    prompt:
      '{"aspect_ratio":"1:1","high_level_description":"An isometric floating fortified island with a fortified gate, a stone watchtower and a stone defensive wall on a grassy top, soft storybook fantasy game art, on a transparent background.","style_description":{"aesthetics":"cohesive soft storybook fantasy game art, hand-painted illustration, warm pastel palette, clean rounded shapes, subtle dark outline","lighting":"gentle soft directional daylight","medium":"hand-painted digital illustration","color_palette":["#9CCB6B","#9AA3AD","#C9A36A","#7FB0D8","#3B2E25"]},"compositional_deconstruction":{"background":"fully transparent background, nothing behind the island","elements":[{"type":"obj","bbox":[280,120,965,880],"desc":"a single isometric floating island, grassy top with patches of dirt and a low stone rim, rocky brown earth underside floating in the air","color_palette":["#9CCB6B","#8A6A45"]},{"type":"obj","bbox":[400,400,665,650],"desc":"a sturdy medieval fortified wooden gate with a stone arch and iron studs, the town entrance","color_palette":["#9A7B4F","#9AA3AD"]},{"type":"obj","bbox":[210,590,520,815],"desc":"a tall round stone watchtower with crenellations and a small conical roof","color_palette":["#9AA3AD","#7E8893"]},{"type":"obj","bbox":[330,170,600,410],"desc":"a thick crenellated stone defensive wall section","color_palette":["#9AA3AD","#B8BEC6"]}]}}',
    note: "POC — Ideogram v4 defense island (built)",
  },
  {
    id: "scene-production-ideo",
    category: "islands",
    filename: "production-ideo.png",
    raw: true,
    width: 1024,
    height: 1024,
    prompt:
      '{"aspect_ratio":"1:1","high_level_description":"An isometric floating island with a stone water well, a blacksmith workshop with a chimney and an outdoor campfire kitchen on a grassy top, soft storybook fantasy game art, on a transparent background.","style_description":{"aesthetics":"cohesive soft storybook fantasy game art, hand-painted illustration, warm pastel palette, clean rounded shapes, subtle dark outline","lighting":"gentle soft directional daylight","medium":"hand-painted digital illustration","color_palette":["#9CCB6B","#C9A36A","#9A7B4F","#7FB0D8","#3B2E25"]},"compositional_deconstruction":{"background":"fully transparent background, nothing behind the island","elements":[{"type":"obj","bbox":[280,120,965,880],"desc":"a single isometric floating island, lush green grass top with dirt paths, rocky brown earth underside floating in the air","color_palette":["#9CCB6B","#8A6A45"]},{"type":"obj","bbox":[370,420,610,640],"desc":"a medieval stone water well with a small wooden roof and a bucket on a rope","color_palette":["#9AA3AD","#9A7B4F","#7FB0D8"]},{"type":"obj","bbox":[320,170,620,420],"desc":"a blacksmith workshop, a timber shed with a stone chimney releasing smoke and a glowing forge","color_palette":["#9A7B4F","#7E8893","#E08A4A"]},{"type":"obj","bbox":[380,630,625,830],"desc":"an outdoor campfire kitchen with a cooking pot over a small fire and a wooden frame","color_palette":["#9A7B4F","#E08A4A"]}]}}',
    note: "POC — Ideogram v4 production island (built)",
  },

  // ── Isometric cube tiles (shared: iso Home grid + iso combat biomes) ─────────────
  {
    id: "iso-water", category: "isotiles", filename: "water.png", style: ISO_TILE,
    prompt: "calm blue water surface on top with gentle ripples and a couple of lily pads, darker blue rocky sides",
    width: 1024, height: 1024, note: "Iso cube — biome 0 Water",
  },
  {
    id: "iso-sand", category: "isotiles", filename: "sand.png", style: ISO_TILE,
    prompt: "beige sandy desert top with faint ripples, layered sandstone sides",
    width: 1024, height: 1024, note: "Iso cube — biome 1 Sand",
  },
  {
    id: "iso-grass", category: "isotiles", filename: "grass.png", style: ISO_TILE,
    prompt: "lush green grass top with a few tiny flowers, brown soil and rock sides",
    width: 1024, height: 1024, note: "Iso cube — biome 2 Grass (also town ground)",
  },
  {
    id: "iso-forest", category: "isotiles", filename: "forest.png", style: ISO_TILE,
    prompt: "green grass top with two small round trees, brown soil sides",
    width: 1024, height: 1024, note: "Iso cube — biome 3 Forest",
  },
  {
    id: "iso-stone", category: "isotiles", filename: "stone.png", style: ISO_TILE,
    prompt: "grey cobblestone rock top and sides with a few moss patches",
    width: 1024, height: 1024, note: "Iso cube — biome 4 Mountain/stone (also town plaza)",
  },
  {
    id: "iso-snow", category: "isotiles", filename: "snow.png", style: ISO_TILE,
    prompt: "white snow top with a small fir tree and pale ice crystals, snowy rock sides with small icicles",
    width: 1024, height: 1024, note: "Iso cube — biome 5 Snow",
  },
  {
    id: "iso-bridge", category: "isotiles", filename: "bridge.png", style: ISO_TILE,
    prompt: "a brown earth block with a small arched wooden plank bridge on its top face spanning a little channel of water",
    width: 1024, height: 1024, note: "Iso cube — wooden bridge tile (connects iso platforms)",
  },

  // ── App background ──────────────────────────────────────────────────────────────
  {
    id: "app-bg",
    category: "bg",
    filename: "app-bg.png",
    style: STORYBOOK,
    prompt:
      "dreamy pastel sky filled with soft fluffy clouds, gentle gradient from light blue at the top to soft teal, airy calm atmosphere, no characters, no text, vertical portrait composition",
    width: 832,
    height: 1216,
    keepBackground: true,
    note: "App background behind the game screen (.sky) — matches the cloud-sky mockup",
  },

  // ── Town island (isometric base; buildings are layered on top) ───────────────────
  {
    id: "town-island",
    category: "bg",
    filename: "town-island.png",
    style: STORYBOOK,
    prompt:
      "isometric floating island platform, lush green grass top with a round cobblestone plaza, low medieval stone retaining wall around the rim, rocky earth underside floating in the air, empty buildable ground in the center, no buildings, cute game art, centered",
    width: 1024,
    height: 1024,
    note: "HomeTab central isometric island base — buildings render on top by % position",
  },

  // ── Map tiles (orthogonal, one per biome 0..5) ──────────────────────────────────
  {
    id: "tile-water", category: "tiles", filename: "water.png", style: TILE_STYLE,
    prompt: "calm blue water surface with gentle ripples and subtle reflections",
    width: 512, height: 512, keepBackground: true, note: "Map tile — biome 0 Water",
  },
  {
    id: "tile-sand", category: "tiles", filename: "sand.png", style: TILE_STYLE,
    prompt: "fine beige desert sand ground with faint dunes ripples",
    width: 512, height: 512, keepBackground: true, note: "Map tile — biome 1 Sand",
  },
  {
    id: "tile-grass", category: "tiles", filename: "grass.png", style: TILE_STYLE,
    prompt: "lush green grassy plain, short grass with subtle variation",
    width: 512, height: 512, keepBackground: true, note: "Map tile — biome 2 Grass",
  },
  {
    id: "tile-forest", category: "tiles", filename: "forest.png", style: TILE_STYLE,
    prompt: "dense green forest treetop canopy seen directly from above, rounded treetops",
    width: 512, height: 512, keepBackground: true, note: "Map tile — biome 3 Forest",
  },
  {
    id: "tile-mountain", category: "tiles", filename: "mountain.png", style: TILE_STYLE,
    prompt: "rugged grey mountain rock surface, rocky stone with cracks",
    width: 512, height: 512, keepBackground: true, note: "Map tile — biome 4 Mountain",
  },
  {
    id: "tile-snow", category: "tiles", filename: "snow.png", style: TILE_STYLE,
    prompt: "smooth white snow field, soft powdery snow texture with gentle shadows",
    width: 512, height: 512, keepBackground: true, note: "Map tile — biome 5 Snow",
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
  // Subject-only prompts — the shared DA + STYLE own the look & background. (Legacy
  // "pixel art / 24x24 / transparent background" tokens were removed: they fought the DA.)
  {
    id: "nav-home", category: "ui", filename: "nav-home.png",
    prompt: "a single small cozy medieval house, simple clear silhouette",
    note: "BottomNav — Home tab icon",
  },
  {
    id: "nav-map", category: "ui", filename: "nav-map.png",
    prompt: "a single rolled-open treasure map scroll, simple clear silhouette",
    note: "BottomNav — Map tab icon",
  },
  {
    id: "nav-stock", category: "ui", filename: "nav-stock.png",
    prompt: "a single adventurer's leather backpack, simple clear silhouette",
    note: "BottomNav — Stock tab icon",
  },
  {
    id: "nav-structure", category: "ui", filename: "nav-structure.png",
    prompt: "a single wooden construction scaffolding, simple clear silhouette",
    note: "BottomNav — Structure tab icon",
  },
  {
    id: "nav-craft", category: "ui", filename: "nav-craft.png",
    prompt: "a single crossed hammer and anvil, simple clear silhouette",
    note: "BottomNav — Craft tab icon",
  },

  // ── Title screen ─────────────────────────────────────────────────────────────
  {
    id: "bird", category: "ui", filename: "bird.png",
    prompt: "a single cute fantasy bird perched on a small branch, colorful feathers, side view",
    note: "TitleScreen — animated bird (currently 🐦 emoji)",
  },
  {
    id: "shinki-npc", category: "npc", filename: "shinki.png",
    prompt: "a single cute fox spirit guide creature, friendly glowing eyes, small, full body sitting",
    note: "HomeTab — Shinki NPC (currently 🦊 emoji)",
  },

  // ── Game over ─────────────────────────────────────────────────────────────────
  {
    id: "skull", category: "ui", filename: "skull.png",
    prompt: "a single skull emblem, grim game-over symbol, faint glowing red eyes",
    note: "GameOver screen — skull (currently 💀 emoji)",
  },
];
