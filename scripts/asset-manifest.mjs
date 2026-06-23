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
  `${DA}, a single 2D isometric cube block tile at a fixed 2:1 isometric angle, the cube centred and filling the same proportion of the frame at a consistent scale, a square top face plus exactly two visible side faces, chunky stylized game tile, plain background, nothing else`;

// Painted iso GAME ITEM/OBJECT framing (medical kits, weapons, tools, materials, food).
// Single object, slight 3/4 isometric tilt, consistent scale, matches the building DA.
export const ITEM_STYLE =
  `${DA}, a single game item icon at a slight 3/4 isometric angle, glossy painted finish, soft drop shadow, centred, consistent scale, plain background, nothing else`;

// Chibi adventurer CHARACTER framing (cute stylised RPG heroes, like the references).
export const CHAR_STYLE =
  `${DA}, a single cute stylised RPG hero character, full body, slightly chibi proportions, an expressive detailed face with clear eyes and a confident friendly expression, painterly shading, standing facing the viewer, centred, plain background, nothing else`;

// Isometric PROP framing (trees, rocks, fences…) — same 2:1 angle as the iso tiles so
// props sit naturally on the iso grid, on a small ground base, consistent scale.
export const PROP_STYLE =
  `${DA}, a single isometric game prop at a 2:1 isometric angle, sitting on a small round ground base, consistent scale, plain background, nothing else`;

// Stylised CREATURE/MONSTER framing (cute but menacing RPG enemies).
export const MONSTER_STYLE =
  `${DA}, a single stylised RPG monster creature, full body, expressive face, slightly menacing but cute, painterly shading, facing the viewer, centred, plain background, nothing else`;

// Building tail for the iso-town layer system: the building must NOT carry its own
// grass/dirt/terrain base, so it sits cleanly on the tile layer. Append to a building prompt.
export const NB =
  "isometric view, the building is cleanly cut out and FLOATS on a blank empty white sheet with only " +
  "white space directly below and all around it, the very bottom of the building is a flat bare " +
  "stone-and-wood foundation edge, absolutely no grass, no lawn, no green grass patch, no garden, " +
  "no ground, no ground plane, no terrain tile, no dirt, no soil, no green base, no plants, no foliage, " +
  "no cast shadow on the floor, a single isolated building object, studio packshot, nothing else";

// ── LOD style anchors (A+B style-cohesion experiment) ────────────────────────────
// Two building looks, both deriving from DA (shared palette/medium) but pinning the
// invariant ANCHORS that cause perceived inconsistency: a fixed light direction, a
// fixed iso angle, and a fixed finish. Pair with a FIXED seed (`--seed N`).
//   NEAR = foreground / interactive: bold clean outline, crisp cel shading, readable.
//   FAR  = background / distant: no outline, soft edges, low contrast so it recedes.
export const STYLE_NEAR =
  "cohesive storybook fantasy game art, hand-painted, warm pastel palette, " +
  "single centered building, plain white background, no frame, no border, " +
  "bold clean dark outline, smooth cel shading, soft ambient occlusion, crisp readable details, " +
  "consistent 2:1 isometric three-quarter view, lighting from the upper-left, matte finish, no text, no watermark";
export const STYLE_FAR =
  "cohesive storybook fantasy game art, soft hand-painted, warm pastel palette, " +
  "single centered building, plain white background, no frame, no border, " +
  "no harsh outline, soft rounded edges, gentle soft shadows, soft medium contrast, " +
  "simplified but readable forms, consistent 2:1 isometric three-quarter view, " +
  "lighting from the upper-left, matte finish, no text, no watermark";

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

  // ── Asset library: extra iso cube tiles (batch 1) ────────────────────────────────
  { id: "iso-dirt", category: "isotiles", filename: "dirt.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "bare brown soil top with small pebbles, layered dirt sides", note: "Iso cube — dirt" },
  { id: "iso-darkgrass", category: "isotiles", filename: "darkgrass.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "deep dark green grass top, brown soil sides", note: "Iso cube — dark grass" },
  { id: "iso-fallgrass", category: "isotiles", filename: "fallgrass.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "autumn yellow-orange grass top with fallen leaves, brown soil sides", note: "Iso cube — fall grass" },
  { id: "iso-farmland", category: "isotiles", filename: "farmland.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "ploughed farmland top with neat soil furrows, brown earth sides", note: "Iso cube — farmland" },
  { id: "iso-flowers", category: "isotiles", filename: "flowers.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "green grass top dotted with small colourful flowers, brown soil sides", note: "Iso cube — flower meadow" },
  { id: "iso-mud", category: "isotiles", filename: "mud.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "wet brown mud top with small puddles, muddy sides", note: "Iso cube — mud" },
  { id: "iso-mossstone", category: "isotiles", filename: "mossstone.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "grey rock top and sides heavily covered in green moss patches", note: "Iso cube — mossy stone" },
  { id: "iso-dungeon", category: "isotiles", filename: "dungeon.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "dark grey dungeon brick top and sides, cracked ancient stone with faint cracks", note: "Iso cube — dungeon stone" },
  { id: "iso-lava", category: "isotiles", filename: "lava.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "black volcanic rock top with glowing orange lava cracks, dark basalt sides", note: "Iso cube — lava rock" },
  { id: "iso-ice", category: "isotiles", filename: "ice.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "pale blue translucent ice top with frosty cracks, icy blue sides", note: "Iso cube — ice" },
  { id: "iso-crystal", category: "isotiles", filename: "crystal.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "grey rock top with glowing purple crystal veins flush with the flat surface, stone block sides, nothing protruding above the top face", note: "Iso cube — crystal (flat)" },
  { id: "iso-mushroom", category: "isotiles", filename: "mushroom.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "dark mossy ground top with small red and brown mushrooms, earthy sides", note: "Iso cube — mushroom ground" },

  // ── Asset library: materials & objects (batch 2) ─────────────────────────────────
  { id: "mat-wood", category: "objects", filename: "mat-wood.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a neat stack of cut brown wooden logs", note: "Material — wood logs" },
  { id: "mat-plank", category: "objects", filename: "mat-plank.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a small stack of sawn wooden planks", note: "Material — planks" },
  { id: "mat-stone", category: "objects", filename: "mat-stone.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a pile of rough grey stone rocks", note: "Material — stone" },
  { id: "mat-ironore", category: "objects", filename: "mat-ironore.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "chunks of grey iron ore with shiny metallic silver flecks", note: "Material — iron ore" },
  { id: "mat-goldore", category: "objects", filename: "mat-goldore.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "shiny golden nuggets of gold ore", note: "Material — gold ore" },
  { id: "mat-coal", category: "objects", filename: "mat-coal.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a small pile of black coal lumps", note: "Material — coal" },
  { id: "obj-coins", category: "objects", filename: "obj-coins.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a small pile of shiny gold coins", note: "Object — coins" },
  { id: "obj-barrel", category: "objects", filename: "obj-barrel.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a wooden barrel with dark metal bands", note: "Object — barrel" },
  { id: "obj-crate", category: "objects", filename: "obj-crate.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a sturdy wooden crate box", note: "Object — crate" },
  { id: "obj-chest", category: "objects", filename: "obj-chest.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a closed wooden treasure chest with a golden lock and iron bands", note: "Object — chest" },
  { id: "obj-sack", category: "objects", filename: "obj-sack.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a full beige cloth sack tied at the neck with rope", note: "Object — sack" },
  { id: "obj-rope", category: "objects", filename: "obj-rope.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a neatly coiled length of brown rope", note: "Object — rope" },
  { id: "obj-lantern", category: "objects", filename: "obj-lantern.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a metal lantern with a warm glowing flame inside", note: "Object — lantern" },
  { id: "obj-torch", category: "objects", filename: "obj-torch.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a wooden torch with a bright orange flame", note: "Object — torch" },

  // ── Asset library: food & consumables (batch 3) ──────────────────────────────────
  { id: "food-apple", category: "objects", filename: "food-apple.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a shiny red apple with a green leaf", note: "Food — apple" },
  { id: "food-bread", category: "objects", filename: "food-bread.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a golden loaf of crusty bread", note: "Food — bread" },
  { id: "food-carrot", category: "objects", filename: "food-carrot.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a bunch of orange carrots with green tops", note: "Food — carrot" },
  { id: "food-potato", category: "objects", filename: "food-potato.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a couple of brown potatoes", note: "Food — potato" },
  { id: "food-wheat", category: "objects", filename: "food-wheat.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a golden bundle of harvested wheat", note: "Food — wheat" },
  { id: "food-mushroom", category: "objects", filename: "food-mushroom.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a red-capped mushroom with white spots", note: "Food — mushroom" },
  { id: "food-berries", category: "objects", filename: "food-berries.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a small cluster of blue and red berries", note: "Food — berries" },
  { id: "food-fish", category: "objects", filename: "food-fish.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a fresh silver fish", note: "Food — fish" },
  { id: "food-meat", category: "objects", filename: "food-meat.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a raw meat drumstick with a bone", note: "Food — meat" },
  { id: "food-pumpkin", category: "objects", filename: "food-pumpkin.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a round orange pumpkin with a green stem", note: "Food — pumpkin" },
  { id: "food-egg", category: "objects", filename: "food-egg.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a couple of white chicken eggs", note: "Food — eggs" },
  { id: "food-waterflask", category: "objects", filename: "food-waterflask.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a leather water flask canteen with a cork", note: "Consumable — water flask" },

  // ── Asset library: tools & weapons (batch 4) ─────────────────────────────────────
  { id: "weapon-sword", category: "objects", filename: "weapon-sword.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a steel short sword with a leather-wrapped handle and round pommel", note: "Weapon — sword" },
  { id: "weapon-dagger", category: "objects", filename: "weapon-dagger.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a small steel dagger with a wooden handle", note: "Weapon — dagger" },
  { id: "weapon-axe", category: "objects", filename: "weapon-axe.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a battle axe with a steel head and wooden handle", note: "Weapon — axe" },
  { id: "weapon-mace", category: "objects", filename: "weapon-mace.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a wooden mace club with iron bands and moss, a sturdy bludgeon", note: "Weapon — mace" },
  { id: "weapon-bow", category: "objects", filename: "weapon-bow.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a wooden hunting bow with a taut string and a single arrow", note: "Weapon — bow" },
  { id: "weapon-spear", category: "objects", filename: "weapon-spear.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a long wooden spear with a steel tip", note: "Weapon — spear" },
  { id: "weapon-shield", category: "objects", filename: "weapon-shield.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a round wooden shield with iron rim and a central boss", note: "Weapon — shield" },
  { id: "tool-pickaxe", category: "objects", filename: "tool-pickaxe.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a mining pickaxe with a steel head and wooden handle", note: "Tool — pickaxe" },
  { id: "tool-hammer", category: "objects", filename: "tool-hammer.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a blacksmith hammer with a steel head and wooden handle", note: "Tool — hammer" },
  { id: "tool-wrenchset", category: "objects", filename: "tool-wrenchset.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a bundle of metal wrenches and screwdrivers tied with a leather strap", note: "Tool — wrench set" },
  { id: "tool-telescope", category: "objects", filename: "tool-telescope.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a brass spyglass telescope wrapped with brown leather", note: "Tool — telescope" },
  { id: "tool-fishingrod", category: "objects", filename: "tool-fishingrod.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a wooden fishing rod with a line and hook", note: "Tool — fishing rod" },
  { id: "tool-scythe", category: "objects", filename: "tool-scythe.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a farming scythe with a curved steel blade and wooden handle", note: "Tool — scythe" },
  { id: "tool-shovel", category: "objects", filename: "tool-shovel.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a digging shovel with a steel blade and wooden handle", note: "Tool — shovel" },

  // ── Asset library: medical, potions & misc (batch 5) ─────────────────────────────
  { id: "med-firstaid", category: "objects", filename: "med-firstaid.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a single white first-aid kit case with a red cross and a brown leather strap", note: "Medical — first aid kit" },
  { id: "med-bandage", category: "objects", filename: "med-bandage.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a single rolled beige cloth bandage partly unrolled", note: "Medical — bandage" },
  { id: "med-pills", category: "objects", filename: "med-pills.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a single glass jar of white pills tipped over with a few pills spilling out", note: "Medical — pills" },
  { id: "med-syringe", category: "objects", filename: "med-syringe.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a single medical syringe filled with amber liquid", note: "Medical — syringe" },
  { id: "med-herbs", category: "objects", filename: "med-herbs.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a small bundle of green medicinal herbs tied with string", note: "Medical — herbs" },
  { id: "potion-red", category: "objects", filename: "potion-red.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a single round glass potion bottle filled with glowing red liquid and a cork", note: "Potion — health red" },
  { id: "potion-green", category: "objects", filename: "potion-green.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a single round glass potion bottle filled with glowing green liquid and a cork", note: "Potion — green" },
  { id: "potion-blue", category: "objects", filename: "potion-blue.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a single round glass potion bottle filled with glowing blue liquid and a cork", note: "Potion — mana blue" },
  { id: "misc-map", category: "objects", filename: "misc-map.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a single unrolled old treasure map parchment with a dotted path, mountains and a compass rose", note: "Misc — treasure map" },
  { id: "misc-bookstack", category: "objects", filename: "misc-bookstack.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a small stack of two old leather spellbooks tied with rope and a green bookmark", note: "Misc — book stack" },
  { id: "misc-scroll", category: "objects", filename: "misc-scroll.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a single rolled parchment scroll tied with a red ribbon", note: "Misc — scroll" },
  { id: "misc-key", category: "objects", filename: "misc-key.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a single ornate golden key", note: "Misc — key" },
  { id: "misc-gem", category: "objects", filename: "misc-gem.png", style: ITEM_STYLE, width: 1024, height: 1024, prompt: "a single cut glowing blue gemstone", note: "Misc — gem" },

  // ── Asset library: isometric buildings (batch 6) ─────────────────────────────────
  { id: "bld-house", category: "buildings", filename: "bld-house.png", width: 1024, height: 1024, prompt: "a single small medieval timber-framed house with a red tiled roof and a stone base, on a small grass patch, isometric view", note: "Building — house" },
  { id: "bld-cottage", category: "buildings", filename: "bld-cottage.png", width: 1024, height: 1024, prompt: "a single cosy thatched-roof cottage with a stone chimney and log walls, on a small grass patch, isometric view", note: "Building — cottage" },
  { id: "bld-logcabin", category: "buildings", filename: "bld-logcabin.png", width: 1024, height: 1024, prompt: "a single rustic wooden log cabin with a thatched roof and a stone chimney, on a small grass patch, isometric view", note: "Building — log cabin" },
  { id: "bld-tower", category: "buildings", filename: "bld-tower.png", width: 1024, height: 1024, prompt: "a single round stone wizard tower with a green conical shingled roof and a wooden door, on a small grass patch, isometric view", note: "Building — tower" },
  { id: "bld-blacksmith", category: "buildings", filename: "bld-blacksmith.png", width: 1024, height: 1024, prompt: "a single blacksmith forge workshop with a stone chimney releasing smoke and a glowing forge, timber and stone walls, on a small grass patch, isometric view", note: "Building — blacksmith" },
  { id: "bld-market", category: "buildings", filename: "bld-market.png", width: 1024, height: 1024, prompt: "a single market stall with a striped awning and crates of goods, wooden counter, on a small grass patch, isometric view", note: "Building — market stall" },
  { id: "bld-windmill", category: "buildings", filename: "bld-windmill.png", width: 1024, height: 1024, prompt: "a single stone windmill with wooden sail blades and a thatched cap, on a small grass patch, isometric view", note: "Building — windmill" },
  { id: "bld-barn", category: "buildings", filename: "bld-barn.png", width: 1024, height: 1024, prompt: "a single red wooden barn with a hayloft and large doors, on a small grass patch, isometric view", note: "Building — barn" },
  { id: "bld-tavern", category: "buildings", filename: "bld-tavern.png", width: 1024, height: 1024, prompt: "a single two-storey timber-framed tavern with a hanging sign and warm windows, on a small grass patch, isometric view", note: "Building — tavern" },
  { id: "bld-church", category: "buildings", filename: "bld-church.png", width: 1024, height: 1024, prompt: "a single small stone chapel church with a bell tower and arched windows, on a small grass patch, isometric view", note: "Building — church" },
  { id: "bld-well", category: "buildings", filename: "bld-well.png", width: 1024, height: 1024, prompt: "a single stone water well with a small wooden roof, bucket and rope, on a small grass patch, isometric view", note: "Building — well" },
  { id: "bld-watchtower", category: "buildings", filename: "bld-watchtower.png", width: 1024, height: 1024, prompt: "a single wooden watchtower on stilts with a ladder and a small roofed platform, on a small grass patch, isometric view", note: "Building — watchtower" },

  // ── Asset library: more isometric buildings (batch 16) ───────────────────────────
  { id: "bld-manor", category: "buildings", filename: "bld-manor.png", width: 1024, height: 1024, prompt: "a single grand two-storey stone manor house with a steep blue tiled roof, multiple chimneys and tall windows, on a small grass patch, isometric view", note: "Building — manor" },
  { id: "bld-inn", category: "buildings", filename: "bld-inn.png", width: 1024, height: 1024, prompt: "a single cozy timber-framed inn with a thatched roof, a hanging wooden sign and warm glowing windows, on a small grass patch, isometric view", note: "Building — inn" },
  { id: "bld-bakery", category: "buildings", filename: "bld-bakery.png", width: 1024, height: 1024, prompt: "a single charming bakery with a brick oven chimney, a striped awning and bread on a window display, on a small grass patch, isometric view", note: "Building — bakery" },
  { id: "bld-library", category: "buildings", filename: "bld-library.png", width: 1024, height: 1024, prompt: "a single stone library hall with arched windows, a domed roof and a small entrance staircase, on a small grass patch, isometric view", note: "Building — library" },
  { id: "bld-temple", category: "buildings", filename: "bld-temple.png", width: 1024, height: 1024, prompt: "a single white marble temple with columns, a triangular pediment and stone steps, on a small grass patch, isometric view", note: "Building — temple" },
  { id: "bld-stable", category: "buildings", filename: "bld-stable.png", width: 1024, height: 1024, prompt: "a single wooden horse stable with split stall doors, a hayloft and a thatched roof, on a small grass patch, isometric view", note: "Building — stable" },
  { id: "bld-watermill", category: "buildings", filename: "bld-watermill.png", width: 1024, height: 1024, prompt: "a single stone watermill with a wooden water wheel beside a small stream, a thatched roof, on a small grass patch, isometric view", note: "Building — watermill" },
  { id: "bld-warehouse", category: "buildings", filename: "bld-warehouse.png", width: 1024, height: 1024, prompt: "a single large timber storehouse warehouse with big double doors and a flat shingle roof, stacked crates outside, on a small grass patch, isometric view", note: "Building — warehouse" },
  { id: "bld-apothecary", category: "buildings", filename: "bld-apothecary.png", width: 1024, height: 1024, prompt: "a single quaint apothecary shop with a green awning, hanging herb bundles and bottle-filled windows, on a small grass patch, isometric view", note: "Building — apothecary" },
  { id: "bld-lumbermill", category: "buildings", filename: "bld-lumbermill.png", width: 1024, height: 1024, prompt: "a single wooden lumber mill with stacked logs, a saw frame and a plank roof, on a small grass patch, isometric view", note: "Building — lumber mill" },
  { id: "bld-farmhouse", category: "buildings", filename: "bld-farmhouse.png", width: 1024, height: 1024, prompt: "a single rustic farmhouse with whitewashed walls, a red roof and a small attached vegetable garden, on a small grass patch, isometric view", note: "Building — farmhouse" },
  { id: "bld-guildhall", category: "buildings", filename: "bld-guildhall.png", width: 1024, height: 1024, prompt: "a single ornate timber guild hall with carved gables, a balcony and colourful banners, on a small grass patch, isometric view", note: "Building — guild hall" },
  { id: "bld-granary", category: "buildings", filename: "bld-granary.png", width: 1024, height: 1024, prompt: "a single round wooden granary silo raised on stone stilts with a conical thatched roof, on a small grass patch, isometric view", note: "Building — granary" },
  { id: "bld-lighthouse", category: "buildings", filename: "bld-lighthouse.png", width: 1024, height: 1024, prompt: "a single tall striped stone lighthouse with a glowing lantern room at the top, on a small rocky grass patch, isometric view", note: "Building — lighthouse" },

  // ── Asset library: more isometric buildings (batch 17) ───────────────────────────
  { id: "bld-keep", category: "buildings", filename: "bld-keep.png", width: 1024, height: 1024, prompt: "a single small fortified stone castle keep with crenellated battlements, corner turrets and a banner, on a small grass patch, isometric view", note: "Building — castle keep" },
  { id: "bld-barracks", category: "buildings", filename: "bld-barracks.png", width: 1024, height: 1024, prompt: "a single military barracks, a long timber-and-stone building with a weapon rack and a training dummy outside, on a small grass patch, isometric view", note: "Building — barracks" },
  { id: "bld-armory", category: "buildings", filename: "bld-armory.png", width: 1024, height: 1024, prompt: "a single stone armory with an iron-banded door, a shield crest above and weapon racks visible inside, on a small grass patch, isometric view", note: "Building — armory" },
  { id: "bld-mine", category: "buildings", filename: "bld-mine.png", width: 1024, height: 1024, prompt: "a single mine entrance dug into a rocky hill with wooden support beams, a minecart on rails and a pickaxe, on a small grass patch, isometric view", note: "Building — mine entrance" },
  { id: "bld-brewery", category: "buildings", filename: "bld-brewery.png", width: 1024, height: 1024, prompt: "a single brewery with wooden barrels stacked outside, a copper kettle chimney and a timber-framed front, on a small grass patch, isometric view", note: "Building — brewery" },
  { id: "bld-stonemason", category: "buildings", filename: "bld-stonemason.png", width: 1024, height: 1024, prompt: "a single stonemason workshop with cut stone blocks, a chisel-and-mallet sign and an open work yard, on a small grass patch, isometric view", note: "Building — stonemason" },
  { id: "bld-tailor", category: "buildings", filename: "bld-tailor.png", width: 1024, height: 1024, prompt: "a single tailor shop with colourful cloth bolts in the window, a needle-and-thread sign and a striped awning, on a small grass patch, isometric view", note: "Building — tailor" },
  { id: "bld-fisherhut", category: "buildings", filename: "bld-fisherhut.png", width: 1024, height: 1024, prompt: "a single fisherman hut on wooden stilts with drying fishing nets and a small boat, on a small sandy grass patch, isometric view", note: "Building — fisher hut" },
  { id: "bld-dock", category: "buildings", filename: "bld-dock.png", width: 1024, height: 1024, prompt: "a single wooden dock pier extending over blue water with mooring posts and a small crane, on a small water base, isometric view", note: "Building — dock" },
  { id: "bld-greenhouse", category: "buildings", filename: "bld-greenhouse.png", width: 1024, height: 1024, prompt: "a single glass greenhouse with a green metal frame full of plants, on a small grass patch, isometric view", note: "Building — greenhouse" },
  { id: "bld-observatory", category: "buildings", filename: "bld-observatory.png", width: 1024, height: 1024, prompt: "a single stone observatory with a domed roof, a telescope poking out and arched windows, on a small grass patch, isometric view", note: "Building — observatory" },
  { id: "bld-shrine", category: "buildings", filename: "bld-shrine.png", width: 1024, height: 1024, prompt: "a single small wooden shrine with a curved tiled roof, stone lanterns and a torii-like gate, on a small grass patch, isometric view", note: "Building — shrine" },
  { id: "bld-tradingpost", category: "buildings", filename: "bld-tradingpost.png", width: 1024, height: 1024, prompt: "a single trading post with an open counter, hanging goods, barrels and a colourful flag, on a small grass patch, isometric view", note: "Building — trading post" },
  { id: "bld-windmilltower", category: "buildings", filename: "bld-windmilltower.png", width: 1024, height: 1024, prompt: "a single tall brick windmill tower with white wooden sail blades and a small balcony, on a small grass patch, isometric view", note: "Building — windmill tower" },

  // ── Asset library: more isometric buildings (batch 18) ───────────────────────────
  { id: "bld-cathedral", category: "buildings", filename: "bld-cathedral.png", width: 1024, height: 1024, prompt: "a single grand gothic cathedral with twin spires, a rose window and arched buttresses, on a small grass patch, isometric view", note: "Building — cathedral" },
  { id: "bld-mageguild", category: "buildings", filename: "bld-mageguild.png", width: 1024, height: 1024, prompt: "a single arcane mage guild, a purple-roofed stone tower with glowing runes and floating crystals, on a small grass patch, isometric view", note: "Building — mage guild" },
  { id: "bld-clocktower", category: "buildings", filename: "bld-clocktower.png", width: 1024, height: 1024, prompt: "a single tall stone clock tower with a round clock face and a pointed roof, on a small grass patch, isometric view", note: "Building — clock tower" },
  { id: "bld-bathhouse", category: "buildings", filename: "bld-bathhouse.png", width: 1024, height: 1024, prompt: "a single stone bathhouse with a steaming pool, a domed tiled roof and arched openings, on a small grass patch, isometric view", note: "Building — bathhouse" },
  { id: "bld-jail", category: "buildings", filename: "bld-jail.png", width: 1024, height: 1024, prompt: "a single small stone jail with iron-barred windows and a heavy studded door, on a small grass patch, isometric view", note: "Building — jail" },
  { id: "bld-pottery", category: "buildings", filename: "bld-pottery.png", width: 1024, height: 1024, prompt: "a single pottery workshop with a brick kiln, clay pots drying on shelves and a wheel, on a small grass patch, isometric view", note: "Building — pottery" },
  { id: "bld-gatehouse", category: "buildings", filename: "bld-gatehouse.png", width: 1024, height: 1024, prompt: "a single fortified stone gatehouse with twin towers, a raised portcullis and a banner, on a small grass patch, isometric view", note: "Building — gatehouse" },
  { id: "bld-carpenter", category: "buildings", filename: "bld-carpenter.png", width: 1024, height: 1024, prompt: "a single carpenter workshop with a sawhorse, stacked planks and a wood-shaving roof, on a small grass patch, isometric view", note: "Building — carpenter" },
  { id: "bld-apiary", category: "buildings", filename: "bld-apiary.png", width: 1024, height: 1024, prompt: "a single beekeeper apiary with several woven straw beehives and a flowering garden, on a small grass patch, isometric view", note: "Building — apiary" },
  { id: "bld-chickencoop", category: "buildings", filename: "bld-chickencoop.png", width: 1024, height: 1024, prompt: "a single small wooden chicken coop with a ramp, a fenced run and a little roof, on a small grass patch, isometric view", note: "Building — chicken coop" },
  { id: "bld-animalpen", category: "buildings", filename: "bld-animalpen.png", width: 1024, height: 1024, prompt: "a single fenced animal pen with a small open shelter and a water trough, on a small grass patch, isometric view", note: "Building — animal pen" },
  { id: "bld-fountain", category: "buildings", filename: "bld-fountain.png", width: 1024, height: 1024, prompt: "a single ornate stone fountain with tiered basins and flowing water, on a small cobblestone patch, isometric view", note: "Building — fountain" },
  { id: "bld-monument", category: "buildings", filename: "bld-monument.png", width: 1024, height: 1024, prompt: "a single stone hero statue monument on a carved pedestal, on a small cobblestone patch, isometric view", note: "Building — monument" },
  { id: "bld-arena", category: "buildings", filename: "bld-arena.png", width: 1024, height: 1024, prompt: "a single small round arena coliseum with stone arches and banners, on a small grass patch, isometric view", note: "Building — arena" },

  // ── Asset library: building states & variants (batch 19) ─────────────────────────
  // Damaged / ruined states — buildings lose durability to monster waves; useful for the
  // wave-damage UI. Plus a few house variants for town variety.
  { id: "bld-ruins", category: "buildings", filename: "bld-ruins.png", width: 1024, height: 1024, prompt: "a single ruined stone building, crumbled broken walls with no roof and scattered rubble, overgrown with moss, on a small grass patch, isometric view", note: "Building — generic ruins" },
  { id: "bld-rubble", category: "buildings", filename: "bld-rubble.png", width: 1024, height: 1024, prompt: "a single pile of broken stone rubble and shattered wooden beams from a collapsed building, on a small grass patch, isometric view", note: "Building — rubble (destroyed)" },
  { id: "bld-house-damaged", category: "buildings", filename: "bld-house-damaged.png", width: 1024, height: 1024, prompt: "a single damaged medieval timber house with a partly collapsed roof, broken planks and cracked walls but still standing, on a small grass patch, isometric view", note: "Building — house (damaged state)" },
  { id: "bld-house-burnt", category: "buildings", filename: "bld-house-burnt.png", width: 1024, height: 1024, prompt: "a single burnt charred ruin of a house, blackened timber frame and smoke, on a small scorched grass patch, isometric view", note: "Building — house (burnt)" },
  { id: "bld-tower-damaged", category: "buildings", filename: "bld-tower-damaged.png", width: 1024, height: 1024, prompt: "a single damaged round stone tower with crumbling battlements, cracks and a broken section, still standing, on a small grass patch, isometric view", note: "Building — tower (damaged)" },
  { id: "bld-wall-broken", category: "buildings", filename: "bld-wall-broken.png", width: 1024, height: 1024, prompt: "a single broken stone defensive wall section with a crumbled gap and fallen bricks, on a small grass patch, isometric view", note: "Building — broken wall" },
  { id: "bld-house-blue", category: "buildings", filename: "bld-house-blue.png", width: 1024, height: 1024, prompt: "a single cosy medieval house with whitewashed walls and a blue tiled roof, a small chimney, on a small grass patch, isometric view", note: "Building — house variant (blue roof)" },
  { id: "bld-house-stone", category: "buildings", filename: "bld-house-stone.png", width: 1024, height: 1024, prompt: "a single sturdy stone house with a grey slate roof and a wooden door, on a small grass patch, isometric view", note: "Building — house variant (stone)" },
  { id: "bld-house-large", category: "buildings", filename: "bld-house-large.png", width: 1024, height: 1024, prompt: "a single large two-storey timber-framed house with a balcony and a red tiled roof, on a small grass patch, isometric view", note: "Building — house variant (large)" },
  { id: "bld-wagon", category: "buildings", filename: "bld-wagon.png", width: 1024, height: 1024, prompt: "a single covered merchant wagon caravan with a canvas roof and wooden wheels, on a small grass patch, isometric view", note: "Building — merchant wagon" },
  { id: "bld-tent-camp", category: "buildings", filename: "bld-tent-camp.png", width: 1024, height: 1024, prompt: "a single camp with two canvas tents around a small campfire, on a small grass patch, isometric view", note: "Building — tent camp" },
  { id: "bld-mushroomhouse", category: "buildings", filename: "bld-mushroomhouse.png", width: 1024, height: 1024, prompt: "a single whimsical house built inside a giant red toadstool mushroom with a round door and windows, on a small grass patch, isometric view", note: "Building — mushroom house" },

  // ── Asset library: biome-themed buildings (batch 20) ─────────────────────────────
  // Variants matched to the game's biomes (sand/snow/swamp/forest/mountain) for placing
  // buildings that fit their environment.
  { id: "bld-adobe-house", category: "buildings", filename: "bld-adobe-house.png", width: 1024, height: 1024, prompt: "a single desert adobe house with sandy clay walls, a flat roof and a striped awning, on a small sandy patch, isometric view", note: "Building — desert adobe house" },
  { id: "bld-desert-tent", category: "buildings", filename: "bld-desert-tent.png", width: 1024, height: 1024, prompt: "a single large desert nomad tent with patterned cloth and wooden poles, on a small sandy patch, isometric view", note: "Building — desert tent" },
  { id: "bld-oasis-well", category: "buildings", filename: "bld-oasis-well.png", width: 1024, height: 1024, prompt: "a single desert oasis well with palm trees and a small water pool, on a small sandy patch, isometric view", note: "Building — oasis well" },
  { id: "bld-snow-cabin", category: "buildings", filename: "bld-snow-cabin.png", width: 1024, height: 1024, prompt: "a single cosy log cabin with a thick snow-covered roof, glowing windows and a smoking chimney, on a small snowy patch, isometric view", note: "Building — snow cabin" },
  { id: "bld-igloo", category: "buildings", filename: "bld-igloo.png", width: 1024, height: 1024, prompt: "a single white snow-brick igloo with a small tunnel entrance, on a small snowy patch, isometric view", note: "Building — igloo" },
  { id: "bld-ice-tower", category: "buildings", filename: "bld-ice-tower.png", width: 1024, height: 1024, prompt: "a single frozen ice tower of pale blue translucent ice with frosty crystals, on a small snowy patch, isometric view", note: "Building — ice tower" },
  { id: "bld-swamp-hut", category: "buildings", filename: "bld-swamp-hut.png", width: 1024, height: 1024, prompt: "a single swamp hut on wooden stilts over murky green water with a mossy thatched roof, on a small muddy water patch, isometric view", note: "Building — swamp hut" },
  { id: "bld-witch-hut", category: "buildings", filename: "bld-witch-hut.png", width: 1024, height: 1024, prompt: "a single crooked witch hut with a twisted chimney, glowing green window and hanging charms, on a small mossy patch, isometric view", note: "Building — witch hut" },
  { id: "bld-treehouse", category: "buildings", filename: "bld-treehouse.png", width: 1024, height: 1024, prompt: "a single wooden treehouse built around a big tree trunk with a rope ladder and a small platform, on a small grass patch, isometric view", note: "Building — treehouse" },
  { id: "bld-elven-house", category: "buildings", filename: "bld-elven-house.png", width: 1024, height: 1024, prompt: "a single graceful elven house with curved organic wooden walls, leafy green roof and glowing lanterns, on a small grass patch, isometric view", note: "Building — elven house" },
  { id: "bld-mountain-fort", category: "buildings", filename: "bld-mountain-fort.png", width: 1024, height: 1024, prompt: "a single rugged stone mountain fort carved into grey rock with a wooden gate and a watchpost, on a small rocky patch, isometric view", note: "Building — mountain fort" },
  { id: "bld-dwarven-forge", category: "buildings", filename: "bld-dwarven-forge.png", width: 1024, height: 1024, prompt: "a single dwarven forge built into stone with a glowing furnace, an anvil and a carved rune arch, on a small rocky patch, isometric view", note: "Building — dwarven forge" },

  // ── Asset library: more buildings, NO ground base (batch 21) ─────────────────────
  // User request: buildings must have NO grass/dirt/terrain base under them, so they sit
  // cleanly on the iso tile layer. Prompts end with an explicit "no ground" instruction.
  { id: "bld-butcher", category: "buildings", filename: "bld-butcher.png", width: 1024, height: 1024, prompt: "a single butcher shop with a striped awning, hanging meat and a wooden counter, isometric view, isolated building with no ground beneath it, no grass, no dirt base, floating, nothing else", note: "Building — butcher (no base)" },
  { id: "bld-tannery", category: "buildings", filename: "bld-tannery.png", width: 1024, height: 1024, prompt: "a single tannery workshop with leather hides drying on wooden racks and a timber front, isometric view, isolated building with no ground beneath it, no grass, no dirt base, floating, nothing else", note: "Building — tannery (no base)" },
  { id: "bld-silo", category: "buildings", filename: "bld-silo.png", width: 1024, height: 1024, prompt: "a single tall cylindrical grain silo of riveted metal with a conical roof, isometric view, isolated building with no ground beneath it, no grass, no dirt base, floating, nothing else", note: "Building — silo (no base)" },

  // ── Asset library: many more buildings, NO ground base (batch 22) ────────────────
  { id: "bld-glassblower", category: "buildings", filename: "bld-glassblower.png", width: 1024, height: 1024, prompt: `a single glassblower workshop with a glowing furnace, colourful glass vases on display and a brick chimney, ${NB}`, note: "Building — glassblower" },
  { id: "bld-jeweler", category: "buildings", filename: "bld-jeweler.png", width: 1024, height: 1024, prompt: `a single elegant jeweler shop with a gem-shaped sign, a glass display window of sparkling gems and a fine timber front, ${NB}`, note: "Building — jeweler" },
  { id: "bld-cartographer", category: "buildings", filename: "bld-cartographer.png", width: 1024, height: 1024, prompt: `a single cartographer shop with rolled maps in the window, a compass sign and a cosy timber front, ${NB}`, note: "Building — cartographer" },
  { id: "bld-fishmarket", category: "buildings", filename: "bld-fishmarket.png", width: 1024, height: 1024, prompt: `a single fish market stall with iced fish on display, a blue awning and a wooden counter, ${NB}`, note: "Building — fish market" },
  { id: "bld-foundry", category: "buildings", filename: "bld-foundry.png", width: 1024, height: 1024, prompt: `a single metal foundry with a tall brick smelter chimney releasing smoke, glowing molten metal and stone walls, ${NB}`, note: "Building — foundry" },
  { id: "bld-mint", category: "buildings", filename: "bld-mint.png", width: 1024, height: 1024, prompt: `a single coin mint building of stone with a golden coin emblem above the door and barred windows, ${NB}`, note: "Building — mint" },
  { id: "bld-courthouse", category: "buildings", filename: "bld-courthouse.png", width: 1024, height: 1024, prompt: `a single stone courthouse with columns, a triangular pediment, a scales-of-justice emblem and broad steps, ${NB}`, note: "Building — courthouse" },
  { id: "bld-shipyard", category: "buildings", filename: "bld-shipyard.png", width: 1024, height: 1024, prompt: `a single shipyard with a wooden boat hull under construction on a slipway and a timber crane, ${NB}`, note: "Building — shipyard" },
  { id: "bld-watchpost", category: "buildings", filename: "bld-watchpost.png", width: 1024, height: 1024, prompt: `a single small wooden sentry watchpost, a roofed platform on four posts with a ladder and a lantern, ${NB}`, note: "Building — watchpost" },
  { id: "bld-palisade", category: "buildings", filename: "bld-palisade.png", width: 1024, height: 1024, prompt: `a single section of sharpened wooden log palisade wall with a support frame, ${NB}`, note: "Building — palisade wall" },
  { id: "bld-sawmill", category: "buildings", filename: "bld-sawmill.png", width: 1024, height: 1024, prompt: `a single sawmill with a large circular saw blade, stacked fresh planks and a timber roof, ${NB}`, note: "Building — sawmill" },
  { id: "bld-weaponsmith", category: "buildings", filename: "bld-weaponsmith.png", width: 1024, height: 1024, prompt: `a single weaponsmith shop with swords and shields on a wall rack, an anvil and a crossed-swords sign, ${NB}`, note: "Building — weaponsmith" },
  { id: "bld-infirmary", category: "buildings", filename: "bld-infirmary.png", width: 1024, height: 1024, prompt: `a single infirmary building with a red cross sign, whitewashed walls and arched windows, ${NB}`, note: "Building — infirmary" },
  { id: "bld-schoolhouse", category: "buildings", filename: "bld-schoolhouse.png", width: 1024, height: 1024, prompt: `a single small schoolhouse with a little bell turret, arched windows and a red door, ${NB}`, note: "Building — schoolhouse" },
  { id: "bld-theater", category: "buildings", filename: "bld-theater.png", width: 1024, height: 1024, prompt: `a single small theater playhouse with a colourful marquee, banners and a grand arched entrance, ${NB}`, note: "Building — theater" },
  { id: "bld-stonebridge", category: "buildings", filename: "bld-stonebridge.png", width: 1024, height: 1024, prompt: `a single arched stone bridge with low side rails, ${NB}`, note: "Building — stone bridge" },

  // ── Asset library: cultural & trade buildings, NO ground base (batch 23) ─────────
  { id: "bld-longhouse", category: "buildings", filename: "bld-longhouse.png", width: 1024, height: 1024, prompt: `a single viking longhouse with a curved turf roof, carved dragon-head gables and timber walls, ${NB}`, note: "Building — viking longhouse" },
  { id: "bld-pagoda", category: "buildings", filename: "bld-pagoda.png", width: 1024, height: 1024, prompt: `a single multi-tiered red pagoda with curved upturned eaves and golden trim, ${NB}`, note: "Building — pagoda" },
  { id: "bld-yurt", category: "buildings", filename: "bld-yurt.png", width: 1024, height: 1024, prompt: `a single round nomad yurt tent with a felt cover, a wooden door and a small smoke hole, ${NB}`, note: "Building — yurt" },
  { id: "bld-villa", category: "buildings", filename: "bld-villa.png", width: 1024, height: 1024, prompt: `a single mediterranean villa with white plaster walls, a terracotta tiled roof and an arched veranda, ${NB}`, note: "Building — villa" },
  { id: "bld-roundhouse", category: "buildings", filename: "bld-roundhouse.png", width: 1024, height: 1024, prompt: `a single round stone roundhouse with a tall conical thatched roof, ${NB}`, note: "Building — roundhouse" },
  { id: "bld-smokehouse", category: "buildings", filename: "bld-smokehouse.png", width: 1024, height: 1024, prompt: `a single small smokehouse with a dark timber body, a vented roof releasing smoke and hanging fish, ${NB}`, note: "Building — smokehouse" },
  { id: "bld-chandler", category: "buildings", filename: "bld-chandler.png", width: 1024, height: 1024, prompt: `a single candlemaker chandler shop with hanging candles, a warm glowing window and a candle sign, ${NB}`, note: "Building — chandler" },
  { id: "bld-cobbler", category: "buildings", filename: "bld-cobbler.png", width: 1024, height: 1024, prompt: `a single cobbler shoemaker shop with a boot-shaped sign, shoes in the window and a timber front, ${NB}`, note: "Building — cobbler" },
  { id: "bld-teahouse", category: "buildings", filename: "bld-teahouse.png", width: 1024, height: 1024, prompt: `a single cosy teahouse with a curved green roof, paper lanterns and a steaming teapot sign, ${NB}`, note: "Building — teahouse" },
  { id: "bld-pawnshop", category: "buildings", filename: "bld-pawnshop.png", width: 1024, height: 1024, prompt: `a single pawnshop with three golden balls sign, a cluttered window of curios and a dark timber front, ${NB}`, note: "Building — pawnshop" },
  { id: "bld-windpump", category: "buildings", filename: "bld-windpump.png", width: 1024, height: 1024, prompt: `a single metal-framed windpump with a multi-blade fan wheel on a lattice tower and a water tank, ${NB}`, note: "Building — windpump" },
  { id: "bld-aqueduct", category: "buildings", filename: "bld-aqueduct.png", width: 1024, height: 1024, prompt: `a single section of stone roman aqueduct with tall arches carrying a water channel, ${NB}`, note: "Building — aqueduct" },
  { id: "bld-tollhouse", category: "buildings", filename: "bld-tollhouse.png", width: 1024, height: 1024, prompt: `a single tollhouse with a striped barrier gate, a small roofed booth and a lantern, ${NB}`, note: "Building — tollhouse" },
  { id: "bld-belltower", category: "buildings", filename: "bld-belltower.png", width: 1024, height: 1024, prompt: `a single open stone bell tower with a large bronze bell under a small pointed roof, ${NB}`, note: "Building — bell tower" },
  { id: "bld-printinghouse", category: "buildings", filename: "bld-printinghouse.png", width: 1024, height: 1024, prompt: `a single printing house with a printing press visible inside, stacked paper and a timber front, ${NB}`, note: "Building — printing house" },
  { id: "bld-boathouse", category: "buildings", filename: "bld-boathouse.png", width: 1024, height: 1024, prompt: `a single wooden boathouse with a wide arched opening over water and a small rowboat inside, ${NB}`, note: "Building — boathouse" },

  // ── Asset library: landmarks & special structures, NO ground base (batch 24) ─────
  { id: "bld-castle", category: "buildings", filename: "bld-castle.png", width: 1024, height: 1024, prompt: `a single grand fairytale castle with multiple round towers, blue conical roofs, battlements and waving banners, ${NB}`, note: "Building — grand castle" },
  { id: "bld-palace", category: "buildings", filename: "bld-palace.png", width: 1024, height: 1024, prompt: `a single ornate royal palace with golden domes, columns and a grand staircase, ${NB}`, note: "Building — palace" },
  { id: "bld-citadel", category: "buildings", filename: "bld-citadel.png", width: 1024, height: 1024, prompt: `a single mighty stone citadel fortress with thick layered walls, corner bastions and a central keep, ${NB}`, note: "Building — citadel" },
  { id: "bld-crypt", category: "buildings", filename: "bld-crypt.png", width: 1024, height: 1024, prompt: `a single dark stone crypt entrance with a heavy iron gate, mossy carved skulls and a small dome, ${NB}`, note: "Building — crypt" },
  { id: "bld-mausoleum", category: "buildings", filename: "bld-mausoleum.png", width: 1024, height: 1024, prompt: `a single marble mausoleum tomb with columns, a domed roof and an ornate door, ${NB}`, note: "Building — mausoleum" },
  { id: "bld-graveyard", category: "buildings", filename: "bld-graveyard.png", width: 1024, height: 1024, prompt: `a single small graveyard plot with a few weathered tombstones, a crooked iron fence and a dead tree, ${NB}`, note: "Building — graveyard" },
  { id: "bld-obelisk", category: "buildings", filename: "bld-obelisk.png", width: 1024, height: 1024, prompt: `a single tall carved stone obelisk with glowing engraved runes on a stepped base, ${NB}`, note: "Building — obelisk" },
  { id: "bld-standingstones", category: "buildings", filename: "bld-standingstones.png", width: 1024, height: 1024, prompt: `a single ring of ancient grey standing stones with faint magic glow, a small henge, ${NB}`, note: "Building — standing stones" },
  { id: "bld-altar", category: "buildings", filename: "bld-altar.png", width: 1024, height: 1024, prompt: `a single ancient stone altar shrine with a glowing crystal, carved steps and candles, ${NB}`, note: "Building — altar" },
  { id: "bld-portal", category: "buildings", filename: "bld-portal.png", width: 1024, height: 1024, prompt: `a single magic portal, a carved stone arch with a swirling glowing blue energy gate inside, ${NB}`, note: "Building — magic portal" },
  { id: "bld-darktower", category: "buildings", filename: "bld-darktower.png", width: 1024, height: 1024, prompt: `a single ominous dark wizard tower of black stone with glowing red windows and jagged spires, ${NB}`, note: "Building — dark tower" },
  { id: "bld-crystaltower", category: "buildings", filename: "bld-crystaltower.png", width: 1024, height: 1024, prompt: `a single magical tower grown from glowing blue crystal with floating shards, ${NB}`, note: "Building — crystal tower" },
  { id: "bld-gnomehouse", category: "buildings", filename: "bld-gnomehouse.png", width: 1024, height: 1024, prompt: `a single whimsical round gnome house built into a grassy mound with a round door and a crooked chimney, ${NB}`, note: "Building — gnome house" },
  { id: "bld-fairyhut", category: "buildings", filename: "bld-fairyhut.png", width: 1024, height: 1024, prompt: `a single tiny glowing fairy hut made of leaves and flower petals with soft magical light, ${NB}`, note: "Building — fairy hut" },
  { id: "bld-airshipdock", category: "buildings", filename: "bld-airshipdock.png", width: 1024, height: 1024, prompt: `a single floating airship dock, a wooden mooring tower with a small dirigible balloon tethered to it, ${NB}`, note: "Building — airship dock" },
  { id: "bld-totempole", category: "buildings", filename: "bld-totempole.png", width: 1024, height: 1024, prompt: `a single tall carved wooden totem pole with stacked painted animal faces, ${NB}`, note: "Building — totem pole" },

  // ── Asset library: defensive & siege structures, NO ground base (batch 25) ───────
  // Gameplay-relevant: the town defends against monster waves, so these are town defenses.
  { id: "bld-catapult", category: "buildings", filename: "bld-catapult.png", width: 1024, height: 1024, prompt: `a single wooden siege catapult with a loaded throwing arm and a boulder, ${NB}`, note: "Building — catapult" },
  { id: "bld-ballista", category: "buildings", filename: "bld-ballista.png", width: 1024, height: 1024, prompt: `a single mounted wooden ballista with a giant crossbow and a large bolt, ${NB}`, note: "Building — ballista" },
  { id: "bld-trebuchet", category: "buildings", filename: "bld-trebuchet.png", width: 1024, height: 1024, prompt: `a single tall wooden trebuchet siege engine with a counterweight and a sling, ${NB}`, note: "Building — trebuchet" },
  { id: "bld-cannon", category: "buildings", filename: "bld-cannon.png", width: 1024, height: 1024, prompt: `a single black iron cannon on a wooden carriage with a stack of cannonballs, ${NB}`, note: "Building — cannon" },
  { id: "bld-barricade", category: "buildings", filename: "bld-barricade.png", width: 1024, height: 1024, prompt: `a single defensive barricade of crossed sharpened wooden stakes and sandbags, ${NB}`, note: "Building — barricade" },
  { id: "bld-spikewall", category: "buildings", filename: "bld-spikewall.png", width: 1024, height: 1024, prompt: `a single row of angled sharpened wooden defensive spikes, an anti-charge obstacle, ${NB}`, note: "Building — spike wall" },
  { id: "bld-rampart", category: "buildings", filename: "bld-rampart.png", width: 1024, height: 1024, prompt: `a single stone rampart wall section with a crenellated walkway and a wooden ladder, ${NB}`, note: "Building — rampart" },
  { id: "bld-bastion", category: "buildings", filename: "bld-bastion.png", width: 1024, height: 1024, prompt: `a single angular stone corner bastion fort with battlements and arrow slits, ${NB}`, note: "Building — bastion" },
  { id: "bld-cornertower", category: "buildings", filename: "bld-cornertower.png", width: 1024, height: 1024, prompt: `a single round stone corner defense tower with crenellations and a conical roof, ${NB}`, note: "Building — corner tower" },
  { id: "bld-drawbridge", category: "buildings", filename: "bld-drawbridge.png", width: 1024, height: 1024, prompt: `a single raised wooden drawbridge with chains on a stone gate frame, ${NB}`, note: "Building — drawbridge" },
  { id: "bld-beacon", category: "buildings", filename: "bld-beacon.png", width: 1024, height: 1024, prompt: `a single signal beacon tower, a tall wooden frame holding a burning fire basket, ${NB}`, note: "Building — beacon" },
  { id: "bld-flagpole", category: "buildings", filename: "bld-flagpole.png", width: 1024, height: 1024, prompt: `a single tall wooden flagpole flying a colourful triangular banner on a stone base, ${NB}`, note: "Building — flagpole" },
  { id: "bld-supplydepot", category: "buildings", filename: "bld-supplydepot.png", width: 1024, height: 1024, prompt: `a single supply depot, a roofed wooden platform stacked with crates, barrels and sacks, ${NB}`, note: "Building — supply depot" },
  { id: "bld-guardhouse", category: "buildings", filename: "bld-guardhouse.png", width: 1024, height: 1024, prompt: `a single small stone guardhouse with a shield crest, a torch and a barred door, ${NB}`, note: "Building — guardhouse" },
  { id: "bld-archerytower", category: "buildings", filename: "bld-archerytower.png", width: 1024, height: 1024, prompt: `a single tall wooden archery defense tower with an open roofed top platform and arrow racks, ${NB}`, note: "Building — archery tower" },
  { id: "bld-cannontower", category: "buildings", filename: "bld-cannontower.png", width: 1024, height: 1024, prompt: `a single stone defense tower with a cannon poking out of a top embrasure, ${NB}`, note: "Building — cannon tower" },

  // ── Asset library: crafts, services & livestock, NO ground base (batch 26) ───────
  { id: "bld-dovecote", category: "buildings", filename: "bld-dovecote.png", width: 1024, height: 1024, prompt: `a single round stone dovecote pigeon tower with many nesting holes and a small domed roof, ${NB}`, note: "Building — dovecote" },
  { id: "bld-sheepfold", category: "buildings", filename: "bld-sheepfold.png", width: 1024, height: 1024, prompt: `a single sheepfold, a low wooden fenced pen with a small roofed shelter and a hay rack, ${NB}`, note: "Building — sheepfold" },
  { id: "bld-pigpen", category: "buildings", filename: "bld-pigpen.png", width: 1024, height: 1024, prompt: `a single pig pen with a muddy fenced yard, a low wooden sty and a feeding trough, ${NB}`, note: "Building — pig pen" },
  { id: "bld-kennel", category: "buildings", filename: "bld-kennel.png", width: 1024, height: 1024, prompt: `a single wooden dog kennel row with small arched doghouses and a fenced run, ${NB}`, note: "Building — kennel" },
  { id: "bld-washhouse", category: "buildings", filename: "bld-washhouse.png", width: 1024, height: 1024, prompt: `a single open washhouse with a tiled basin, hanging laundry lines and a low roof, ${NB}`, note: "Building — washhouse" },
  { id: "bld-icehouse", category: "buildings", filename: "bld-icehouse.png", width: 1024, height: 1024, prompt: `a single half-buried stone icehouse with a thick insulated door and a mounded turf roof, ${NB}`, note: "Building — icehouse" },
  { id: "bld-winery", category: "buildings", filename: "bld-winery.png", width: 1024, height: 1024, prompt: `a single winery with a large wooden wine press, stacked barrels and grape baskets, ${NB}`, note: "Building — winery" },
  { id: "bld-dairy", category: "buildings", filename: "bld-dairy.png", width: 1024, height: 1024, prompt: `a single dairy cheese house with milk churns, wheels of cheese on racks and a tiled roof, ${NB}`, note: "Building — dairy" },
  { id: "bld-cooper", category: "buildings", filename: "bld-cooper.png", width: 1024, height: 1024, prompt: `a single cooper barrel-maker workshop with stacked wooden barrels, metal hoops and a workbench, ${NB}`, note: "Building — cooper" },
  { id: "bld-wheelwright", category: "buildings", filename: "bld-wheelwright.png", width: 1024, height: 1024, prompt: `a single wheelwright workshop with large wooden cart wheels leaning against a timber front, ${NB}`, note: "Building — wheelwright" },
  { id: "bld-ropemaker", category: "buildings", filename: "bld-ropemaker.png", width: 1024, height: 1024, prompt: `a single ropemaker's shed with coiled ropes, a twisting wheel and bundles of fibre, ${NB}`, note: "Building — ropemaker" },
  { id: "bld-locksmith", category: "buildings", filename: "bld-locksmith.png", width: 1024, height: 1024, prompt: `a single locksmith shop with a big key sign, hanging keys and locks in the window, ${NB}`, note: "Building — locksmith" },
  { id: "bld-flowershop", category: "buildings", filename: "bld-flowershop.png", width: 1024, height: 1024, prompt: `a single charming flower shop with overflowing flower boxes, buckets of blooms and a striped awning, ${NB}`, note: "Building — flower shop" },
  { id: "bld-toyshop", category: "buildings", filename: "bld-toyshop.png", width: 1024, height: 1024, prompt: `a single cheerful toy shop with a rocking horse sign, toys in the window and bright paint, ${NB}`, note: "Building — toy shop" },
  { id: "bld-gazebo", category: "buildings", filename: "bld-gazebo.png", width: 1024, height: 1024, prompt: `a single ornate garden gazebo, an open hexagonal wooden pavilion with a pointed roof and climbing vines, ${NB}`, note: "Building — gazebo" },
  { id: "bld-statue", category: "buildings", filename: "bld-statue.png", width: 1024, height: 1024, prompt: `a single heroic stone statue of a knight on a tall carved pedestal, ${NB}`, note: "Building — hero statue" },

  // ── Asset library: kilns, textile/metal crafts & civic services, NO base (batch 27) ─
  { id: "bld-limekiln", category: "buildings", filename: "bld-limekiln.png", width: 1024, height: 1024, prompt: `a single stone lime kiln, a tall conical furnace with a glowing arched opening and a wood pile, ${NB}`, note: "Building — lime kiln" },
  { id: "bld-brickkiln", category: "buildings", filename: "bld-brickkiln.png", width: 1024, height: 1024, prompt: `a single brick kiln, a domed clay oven stacked with drying bricks and a smoking chimney, ${NB}`, note: "Building — brick kiln" },
  { id: "bld-charcoalkiln", category: "buildings", filename: "bld-charcoalkiln.png", width: 1024, height: 1024, prompt: `a single earthen charcoal kiln mound with a small smoking vent and stacked logs, ${NB}`, note: "Building — charcoal kiln" },
  { id: "bld-dyehouse", category: "buildings", filename: "bld-dyehouse.png", width: 1024, height: 1024, prompt: `a single dyehouse with colourful dye vats, hanging dyed cloth drying and a timber front, ${NB}`, note: "Building — dyehouse" },
  { id: "bld-weaver", category: "buildings", filename: "bld-weaver.png", width: 1024, height: 1024, prompt: `a single weaver's house with a wooden loom visible inside and rolls of woven cloth, ${NB}`, note: "Building — weaver" },
  { id: "bld-fletcher", category: "buildings", filename: "bld-fletcher.png", width: 1024, height: 1024, prompt: `a single fletcher workshop with bundles of arrows, feathers and a quiver sign, ${NB}`, note: "Building — fletcher" },
  { id: "bld-bowyer", category: "buildings", filename: "bld-bowyer.png", width: 1024, height: 1024, prompt: `a single bowyer workshop with longbows on a rack, bent wood staves and a bow sign, ${NB}`, note: "Building — bowyer" },
  { id: "bld-goldsmith", category: "buildings", filename: "bld-goldsmith.png", width: 1024, height: 1024, prompt: `a single goldsmith shop with a golden ring sign, glinting gold trinkets in the window, ${NB}`, note: "Building — goldsmith" },
  { id: "bld-furrier", category: "buildings", filename: "bld-furrier.png", width: 1024, height: 1024, prompt: `a single furrier shop with hanging fur pelts, a fur-trimmed coat in the window and a timber front, ${NB}`, note: "Building — furrier" },
  { id: "bld-hatter", category: "buildings", filename: "bld-hatter.png", width: 1024, height: 1024, prompt: `a single hatter milliner shop with a top-hat sign and assorted hats in the window, ${NB}`, note: "Building — hatter" },
  { id: "bld-academy", category: "buildings", filename: "bld-academy.png", width: 1024, height: 1024, prompt: `a single grand academy hall with columns, a tiled dome and tall arched windows, ${NB}`, note: "Building — academy" },
  { id: "bld-scriptorium", category: "buildings", filename: "bld-scriptorium.png", width: 1024, height: 1024, prompt: `a single monastic scriptorium with tall arched windows, writing desks and scroll racks visible, ${NB}`, note: "Building — scriptorium" },
  { id: "bld-orphanage", category: "buildings", filename: "bld-orphanage.png", width: 1024, height: 1024, prompt: `a single large warm orphanage house with many small shuttered windows and a welcoming door, ${NB}`, note: "Building — orphanage" },
  { id: "bld-almshouse", category: "buildings", filename: "bld-almshouse.png", width: 1024, height: 1024, prompt: `a single modest stone almshouse, a row of small charity cottages under one long roof, ${NB}`, note: "Building — almshouse" },
  { id: "bld-customshouse", category: "buildings", filename: "bld-customshouse.png", width: 1024, height: 1024, prompt: `a single customs house with a barrier, stacked taxed goods, a ledger desk and a flag, ${NB}`, note: "Building — customs house" },
  { id: "bld-exchange", category: "buildings", filename: "bld-exchange.png", width: 1024, height: 1024, prompt: `a single merchant exchange hall with a colonnaded front, a clock and a coin emblem, ${NB}`, note: "Building — exchange" },

  // ── Asset library: water/harbour infrastructure & religious, NO base (batch 28) ──
  { id: "bld-woodbridge", category: "buildings", filename: "bld-woodbridge.png", width: 1024, height: 1024, prompt: `a single wooden plank footbridge with low rope rails on timber supports, ${NB}`, note: "Building — wooden bridge" },
  { id: "bld-ropebridge", category: "buildings", filename: "bld-ropebridge.png", width: 1024, height: 1024, prompt: `a single swaying rope-and-plank suspension bridge between two wooden posts, ${NB}`, note: "Building — rope bridge" },
  { id: "bld-pier", category: "buildings", filename: "bld-pier.png", width: 1024, height: 1024, prompt: `a single wooden pier jetty on stilts with mooring posts and a tied rowboat, ${NB}`, note: "Building — pier" },
  { id: "bld-harborcrane", category: "buildings", filename: "bld-harborcrane.png", width: 1024, height: 1024, prompt: `a single medieval wooden harbour treadwheel crane with a swinging arm and a hanging crate, ${NB}`, note: "Building — harbour crane" },
  { id: "bld-cistern", category: "buildings", filename: "bld-cistern.png", width: 1024, height: 1024, prompt: `a single round stone water cistern with a domed cap, a spout and a small access hatch, ${NB}`, note: "Building — cistern" },
  { id: "bld-pumphouse", category: "buildings", filename: "bld-pumphouse.png", width: 1024, height: 1024, prompt: `a single small brick pumphouse with a hand pump, pipes and a low tiled roof, ${NB}`, note: "Building — pumphouse" },
  { id: "bld-canallock", category: "buildings", filename: "bld-canallock.png", width: 1024, height: 1024, prompt: `a single canal lock with stone walls, wooden lock gates and a balance beam, ${NB}`, note: "Building — canal lock" },
  { id: "bld-fishdryingracks", category: "buildings", filename: "bld-fishdryingracks.png", width: 1024, height: 1024, prompt: `a single set of wooden fish drying racks hung with rows of split fish, ${NB}`, note: "Building — fish drying racks" },
  { id: "bld-chapel", category: "buildings", filename: "bld-chapel.png", width: 1024, height: 1024, prompt: `a single small stone chapel with a pointed steeple, arched stained-glass window and a wooden door, ${NB}`, note: "Building — chapel" },
  { id: "bld-monastery", category: "buildings", filename: "bld-monastery.png", width: 1024, height: 1024, prompt: `a single stone monastery with a bell gable, arched cloister windows and a tiled roof, ${NB}`, note: "Building — monastery" },
  { id: "bld-abbey", category: "buildings", filename: "bld-abbey.png", width: 1024, height: 1024, prompt: `a single grand abbey with twin towers, a rose window and flying buttresses, ${NB}`, note: "Building — abbey" },
  { id: "bld-cloister", category: "buildings", filename: "bld-cloister.png", width: 1024, height: 1024, prompt: `a single covered cloister walk, a square of arched stone columns around a tiny garden, ${NB}`, note: "Building — cloister" },
  { id: "bld-hermitage", category: "buildings", filename: "bld-hermitage.png", width: 1024, height: 1024, prompt: `a single tiny stone hermitage hut with a small cross, a single window and a mossy roof, ${NB}`, note: "Building — hermitage" },
  { id: "bld-wayshrine", category: "buildings", filename: "bld-wayshrine.png", width: 1024, height: 1024, prompt: `a single roadside wayshrine, a small roofed stone niche holding a statue with candles, ${NB}`, note: "Building — wayshrine" },
  { id: "bld-ossuary", category: "buildings", filename: "bld-ossuary.png", width: 1024, height: 1024, prompt: `a single small stone ossuary chapel with a skull-and-bone carving over an iron-barred door, ${NB}`, note: "Building — ossuary" },
  { id: "bld-bellcote", category: "buildings", filename: "bld-bellcote.png", width: 1024, height: 1024, prompt: `a single stone bellcote, a small freestanding gabled wall holding two hanging bells, ${NB}`, note: "Building — bellcote" },

  // ── Asset library: buildings (batch 29 — new types, NEAR default) ─────────────────
  { id: "bld-saltworks", category: "buildings", filename: "bld-saltworks.png", width: 1024, height: 1024, prompt: `a single saltworks with shallow salt evaporation pans and a small wooden drying shed, ${NB}`, note: "Building — saltworks" },
  { id: "bld-papermill", category: "buildings", filename: "bld-papermill.png", width: 1024, height: 1024, prompt: `a single water-powered paper mill with a wooden waterwheel and paper drying racks, ${NB}`, note: "Building — papermill" },
  { id: "bld-tarkiln", category: "buildings", filename: "bld-tarkiln.png", width: 1024, height: 1024, prompt: `a single earthen tar kiln, a smoking turf-covered mound with a small collection trough, ${NB}`, note: "Building — tarkiln" },
  { id: "bld-bellfoundry", category: "buildings", filename: "bld-bellfoundry.png", width: 1024, height: 1024, prompt: `a single bell foundry with a stone furnace, a casting pit and a large bronze bell, ${NB}`, note: "Building — bellfoundry" },
  { id: "bld-nailmaker", category: "buildings", filename: "bld-nailmaker.png", width: 1024, height: 1024, prompt: `a single small nailmaker's forge workshop with an anvil and a glowing hearth, ${NB}`, note: "Building — nailmaker" },
  { id: "bld-chocolatier", category: "buildings", filename: "bld-chocolatier.png", width: 1024, height: 1024, prompt: `a single cozy chocolatier shop with a brown awning and chocolate treats in the window, ${NB}`, note: "Building — chocolatier" },
  { id: "bld-cheesemonger", category: "buildings", filename: "bld-cheesemonger.png", width: 1024, height: 1024, prompt: `a single cheese shop with stacked round cheese wheels and a striped awning, ${NB}`, note: "Building — cheesemonger" },
  { id: "bld-coffeehouse", category: "buildings", filename: "bld-coffeehouse.png", width: 1024, height: 1024, prompt: `a single charming coffeehouse with an awning, outdoor tables and a hanging sign, ${NB}`, note: "Building — coffeehouse" },
  { id: "bld-falconry", category: "buildings", filename: "bld-falconry.png", width: 1024, height: 1024, prompt: `a single falconry mews, a timber hut with wooden perches and a falcon, ${NB}`, note: "Building — falconry" },
  { id: "bld-mushroomfarm", category: "buildings", filename: "bld-mushroomfarm.png", width: 1024, height: 1024, prompt: `a single timber mushroom farm shed with shaded growing beds of mushrooms, ${NB}`, note: "Building — mushroomfarm" },
  { id: "bld-herbgarden", category: "buildings", filename: "bld-herbgarden.png", width: 1024, height: 1024, prompt: `a single herbalist's hut surrounded by neat raised garden boxes of green herbs, ${NB}`, note: "Building — herbgarden" },
  { id: "bld-fortuneteller", category: "buildings", filename: "bld-fortuneteller.png", width: 1024, height: 1024, prompt: `a single fortune teller's ornate painted wagon caravan with a crescent moon sign, ${NB}`, note: "Building — fortuneteller" },
  { id: "bld-puppettheater", category: "buildings", filename: "bld-puppettheater.png", width: 1024, height: 1024, prompt: `a single small striped puppet theater booth with a curtained stage, ${NB}`, note: "Building — puppettheater" },
  { id: "bld-signaltower", category: "buildings", filename: "bld-signaltower.png", width: 1024, height: 1024, prompt: `a single coastal signal tower with a semaphore mast and a small stone base, ${NB}`, note: "Building — signaltower" },

  // ── A+B style test (temporary; delete after the look is chosen) ───────────────────
  { id: "_test-near-chapel", category: "buildings", filename: "_test-near-chapel.png", style: STYLE_NEAR, width: 1024, height: 1024, prompt: `a single small stone chapel with a pointed steeple, arched stained-glass window and a wooden door, ${NB}`, note: "TEST — chapel NEAR" },
  { id: "_test-far-chapel", category: "buildings", filename: "_test-far-chapel.png", style: STYLE_FAR, width: 1024, height: 1024, prompt: `a single small stone chapel with a pointed steeple, arched stained-glass window and a wooden door, ${NB}`, note: "TEST — chapel FAR" },
  { id: "_test-near-flowershop", category: "buildings", filename: "_test-near-flowershop.png", style: STYLE_NEAR, width: 1024, height: 1024, prompt: `a single charming flower shop with overflowing flower boxes, buckets of blooms and a striped awning, ${NB}`, note: "TEST — flowershop NEAR" },
  { id: "_test-far-flowershop", category: "buildings", filename: "_test-far-flowershop.png", style: STYLE_FAR, width: 1024, height: 1024, prompt: `a single charming flower shop with overflowing flower boxes, buckets of blooms and a striped awning, ${NB}`, note: "TEST — flowershop FAR" },
  { id: "_test-near-foundry", category: "buildings", filename: "_test-near-foundry.png", style: STYLE_NEAR, width: 1024, height: 1024, prompt: `a single metal foundry with a tall brick smelter chimney releasing smoke, glowing molten metal and stone walls, ${NB}`, note: "TEST — foundry NEAR" },
  { id: "_test-far-foundry", category: "buildings", filename: "_test-far-foundry.png", style: STYLE_FAR, width: 1024, height: 1024, prompt: `a single metal foundry with a tall brick smelter chimney releasing smoke, glowing molten metal and stone walls, ${NB}`, note: "TEST — foundry FAR" },
  // FAR landscape set (less-washed STYLE_FAR) — distant/background big structures.
  { id: "_far-castle", category: "buildings", filename: "_far-castle.png", style: STYLE_FAR, width: 1024, height: 1024, prompt: `a single grand fairytale castle with multiple round towers, blue conical roofs, battlements and waving banners, ${NB}`, note: "FAR — castle" },
  { id: "_far-palace", category: "buildings", filename: "_far-palace.png", style: STYLE_FAR, width: 1024, height: 1024, prompt: `a single ornate royal palace with golden domes, columns and a grand staircase, ${NB}`, note: "FAR — palace" },
  { id: "_far-citadel", category: "buildings", filename: "_far-citadel.png", style: STYLE_FAR, width: 1024, height: 1024, prompt: `a single mighty stone citadel fortress with thick layered walls, corner bastions and a central keep, ${NB}`, note: "FAR — citadel" },
  { id: "_far-abbey", category: "buildings", filename: "_far-abbey.png", style: STYLE_FAR, width: 1024, height: 1024, prompt: `a single grand abbey with twin towers, a rose window and flying buttresses, ${NB}`, note: "FAR — abbey" },
  { id: "_far-monastery", category: "buildings", filename: "_far-monastery.png", style: STYLE_FAR, width: 1024, height: 1024, prompt: `a single stone monastery with a bell gable, arched cloister windows and a tiled roof, ${NB}`, note: "FAR — monastery" },
  { id: "_far-aqueduct", category: "buildings", filename: "_far-aqueduct.png", style: STYLE_FAR, width: 1024, height: 1024, prompt: `a single section of stone roman aqueduct with tall arches carrying a water channel, ${NB}`, note: "FAR — aqueduct" },

  // ── No-base test (strengthened NB; delete after validated) ────────────────────────
  { id: "_nb-ruins", category: "buildings", filename: "_nb-ruins.png", style: STYLE_NEAR, width: 1024, height: 1024, prompt: `a single ruined stone house with crumbling moss-covered walls and a broken doorway, ${NB}`, note: "NB test — ruins" },
  { id: "_nb-roundtower", category: "buildings", filename: "_nb-roundtower.png", style: STYLE_NEAR, width: 1024, height: 1024, prompt: `a single round crenellated stone watchtower with a small arched door and arrow slits, ${NB}`, note: "NB test — roundtower" },
  { id: "_nb-portal", category: "buildings", filename: "_nb-portal.png", style: STYLE_NEAR, width: 1024, height: 1024, prompt: `a single stone archway gate with a glowing swirling blue magic portal inside, ${NB}`, note: "NB test — portal" },
  { id: "_nb-cannontower", category: "buildings", filename: "_nb-cannontower.png", style: STYLE_NEAR, width: 1024, height: 1024, prompt: `a single square stone cannon tower with crenellations and a cannon on top, ${NB}`, note: "NB test — cannontower" },
  { id: "_nb-cottage", category: "buildings", filename: "_nb-cottage.png", style: STYLE_NEAR, width: 1024, height: 1024, prompt: `a single cozy thatched-roof cottage with a stone chimney and a wooden door, ${NB}`, note: "NB test — cottage" },
  { id: "_nb-watermill", category: "buildings", filename: "_nb-watermill.png", style: STYLE_NEAR, width: 1024, height: 1024, prompt: `a single stone watermill with a wooden waterwheel on its side, ${NB}`, note: "NB test — watermill" },

  // ── Asset library: chibi characters (batch 7) ────────────────────────────────────
  { id: "char-wizard", category: "characters", filename: "char-wizard.png", style: CHAR_STYLE, width: 1024, height: 1024, prompt: "a young wizard boy with a big pointed brown hat, a teal cloak and a wooden staff, determined face", note: "Character — wizard" },
  { id: "char-knight", category: "characters", filename: "char-knight.png", style: CHAR_STYLE, width: 1024, height: 1024, prompt: "a brave knight in shiny steel plate armour holding a sword and a shield", note: "Character — knight" },
  { id: "char-archer", category: "characters", filename: "char-archer.png", style: CHAR_STYLE, width: 1024, height: 1024, prompt: "a hooded archer in green leather with a wooden bow and a quiver on the back", note: "Character — archer" },
  { id: "char-scout", category: "characters", filename: "char-scout.png", style: CHAR_STYLE, width: 1024, height: 1024, prompt: "an agile scout in light brown leather with a short sword and a feathered cap", note: "Character — scout" },
  { id: "char-healer", category: "characters", filename: "char-healer.png", style: CHAR_STYLE, width: 1024, height: 1024, prompt: "a gentle healer in white and blue robes holding a glowing staff and a herb pouch", note: "Character — healer" },
  { id: "char-merchant", category: "characters", filename: "char-merchant.png", style: CHAR_STYLE, width: 1024, height: 1024, prompt: "a cheerful merchant in a fine vest with a coin pouch and a backpack", note: "Character — merchant" },
  { id: "char-miner", category: "characters", filename: "char-miner.png", style: CHAR_STYLE, width: 1024, height: 1024, prompt: "a rugged miner with a helmet, a pickaxe over the shoulder and a lantern", note: "Character — miner" },
  { id: "char-farmer", category: "characters", filename: "char-farmer.png", style: CHAR_STYLE, width: 1024, height: 1024, prompt: "a friendly farmer in overalls and a straw hat holding a hoe", note: "Character — farmer" },
  { id: "char-hunter", category: "characters", filename: "char-hunter.png", style: CHAR_STYLE, width: 1024, height: 1024, prompt: "a fur-clad hunter with a spear and a wolf-pelt cloak", note: "Character — hunter" },
  { id: "char-builder", category: "characters", filename: "char-builder.png", style: CHAR_STYLE, width: 1024, height: 1024, prompt: "a sturdy builder with a tool belt, a hard leather cap and a hammer", note: "Character — builder" },
  { id: "char-rogue", category: "characters", filename: "char-rogue.png", style: CHAR_STYLE, width: 1024, height: 1024, prompt: "a sneaky rogue in a dark hooded cloak with two daggers", note: "Character — rogue" },
  { id: "char-bard", category: "characters", filename: "char-bard.png", style: CHAR_STYLE, width: 1024, height: 1024, prompt: "a merry bard in colourful clothes with a feathered hat playing a lute", note: "Character — bard" },

  // ── Asset library: more iso cube tiles (batch 8) ─────────────────────────────────
  { id: "iso-gravel", category: "isotiles", filename: "gravel.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "loose grey gravel top with small pebbles, rocky sides", note: "Iso cube — gravel" },
  { id: "iso-clay", category: "isotiles", filename: "clay.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "smooth reddish-orange clay top, layered clay sides", note: "Iso cube — clay" },
  { id: "iso-swamp", category: "isotiles", filename: "swamp.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "murky dark green swamp water top with lily pads, muddy mossy sides", note: "Iso cube — swamp" },
  { id: "iso-junglegrass", category: "isotiles", filename: "junglegrass.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "lush tropical jungle grass top with big leaves and a flower, dark soil sides", note: "Iso cube — jungle grass" },
  { id: "iso-savanna", category: "isotiles", filename: "savanna.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "dry yellow savanna grass top, cracked tan earth sides", note: "Iso cube — savanna" },
  { id: "iso-cobblestone", category: "isotiles", filename: "cobblestone.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "neat grey cobblestone paving top, stone block sides", note: "Iso cube — cobblestone path" },
  { id: "iso-woodfloor", category: "isotiles", filename: "woodfloor.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "wooden plank floor top, timber beam sides", note: "Iso cube — wood floor" },
  { id: "iso-brick", category: "isotiles", filename: "brick.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "red brick paving top, brick wall sides with mortar", note: "Iso cube — brick" },
  { id: "iso-sandstone", category: "isotiles", filename: "sandstone.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "carved tan sandstone block top and sides with smooth layers", note: "Iso cube — sandstone" },
  { id: "iso-obsidian", category: "isotiles", filename: "obsidian.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "glossy black obsidian top with sharp purple-black sheen, dark glassy sides", note: "Iso cube — obsidian" },
  { id: "iso-deepsnow", category: "isotiles", filename: "deepsnow.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "thick fluffy white deep snow top, packed snow and ice sides", note: "Iso cube — deep snow" },
  { id: "iso-crackedearth", category: "isotiles", filename: "crackedearth.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "dry cracked brown earth top with deep cracks, dusty sides", note: "Iso cube — cracked earth" },
  { id: "iso-pineforest", category: "isotiles", filename: "pineforest.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "dark frozen taiga soil top with scattered pine needles and a dusting of snow, flat top face, frozen earth block sides, nothing protruding above the top face", note: "Iso cube — taiga (flat)" },
  { id: "iso-cactus", category: "isotiles", filename: "cactus.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "cracked dry reddish desert hardpan, flat top face, layered dusty rock sides, nothing protruding above the top face", note: "Iso cube — desert hardpan (flat)" },

  // ── Asset library: more pure iso cubes (batch 12) — flat tops, precise tessellation ─
  { id: "iso-redsand", category: "isotiles", filename: "redsand.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "fine red-orange desert sand flat top, layered red sandstone sides", note: "Iso cube — red sand" },
  { id: "iso-darkstone", category: "isotiles", filename: "darkstone.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "dark grey volcanic stone flat top and sides with faint cracks", note: "Iso cube — dark stone" },
  { id: "iso-marble", category: "isotiles", filename: "marble.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "polished white marble flat top with grey veins, marble block sides", note: "Iso cube — marble" },
  { id: "iso-permafrost", category: "isotiles", filename: "permafrost.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "pale blue-white frozen permafrost ground flat top, icy frozen earth sides", note: "Iso cube — permafrost" },
  { id: "iso-ash", category: "isotiles", filename: "ash.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "grey volcanic ash flat top with faint embers, charred rock sides", note: "Iso cube — volcanic ash" },
  { id: "iso-bog", category: "isotiles", filename: "bog.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "dark wet peat bog flat top with muddy patches, boggy earth sides", note: "Iso cube — bog" },
  { id: "iso-meadow", category: "isotiles", filename: "meadow.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "bright lush green meadow grass flat top, rich brown soil sides", note: "Iso cube — meadow" },
  { id: "iso-saltflat", category: "isotiles", filename: "saltflat.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "cracked white salt flat top with hexagon patterns, pale crust sides", note: "Iso cube — salt flat" },
  { id: "iso-basalt", category: "isotiles", filename: "basalt.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "black hexagonal basalt column flat top, dark columnar basalt sides", note: "Iso cube — basalt" },
  { id: "iso-coral", category: "isotiles", filename: "coral.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "pink and orange coral reef flat top under shallow water, sandy rock sides", note: "Iso cube — coral reef" },

  // ── Asset library: rock & resource iso blocks (batch 13) — pure flat tops ─────────
  { id: "iso-granite", category: "isotiles", filename: "granite.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "speckled grey-pink granite flat top, solid granite block sides", note: "Iso cube — granite" },
  { id: "iso-slate", category: "isotiles", filename: "slate.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "flat dark blue-grey slate top in thin layers, layered slate sides", note: "Iso cube — slate" },
  { id: "iso-limestone", category: "isotiles", filename: "limestone.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "pale beige limestone flat top, smooth limestone block sides", note: "Iso cube — limestone" },
  { id: "iso-quartz", category: "isotiles", filename: "quartz.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "white crystalline quartz flat top with a faint sparkle, pale quartz sides", note: "Iso cube — quartz" },
  { id: "iso-ironblock", category: "isotiles", filename: "ironblock.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "grey stone block flat top with embedded shiny silver iron ore chunks, rocky sides", note: "Iso cube — iron ore block" },
  { id: "iso-goldblock", category: "isotiles", filename: "goldblock.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "grey stone block flat top with embedded glittering gold ore veins, rocky sides", note: "Iso cube — gold ore block" },
  { id: "iso-copperblock", category: "isotiles", filename: "copperblock.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "grey stone block flat top with embedded orange copper ore, rocky sides", note: "Iso cube — copper ore block" },
  { id: "iso-coalblock", category: "isotiles", filename: "coalblock.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "grey stone block flat top with embedded black coal chunks, rocky sides", note: "Iso cube — coal ore block" },
  { id: "iso-hay", category: "isotiles", filename: "hay.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "golden hay bale block flat top, bound straw sides", note: "Iso cube — hay block" },
  { id: "iso-thatch", category: "isotiles", filename: "thatch.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "woven straw thatch flat top, thatched block sides", note: "Iso cube — thatch" },
  { id: "iso-jungle", category: "isotiles", filename: "jungle.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "dark rich jungle floor flat top with moss and small leaves, dark soil sides", note: "Iso cube — jungle floor" },
  { id: "iso-volcanic", category: "isotiles", filename: "volcanic.png", style: ISO_TILE, width: 1024, height: 1024, prompt: "dark volcanic rock flat top with faint glowing red cracks, charred basalt sides", note: "Iso cube — volcanic rock" },

  // ── Asset library: iso furniture & structures (batch 14) — grid-placed props ──────
  { id: "str-chest", category: "structures", filename: "str-chest.png", style: PROP_STYLE, width: 1024, height: 1024, prompt: "a closed wooden treasure chest with iron bands and a gold lock", note: "Structure — chest" },
  { id: "str-craftingtable", category: "structures", filename: "str-craftingtable.png", style: PROP_STYLE, width: 1024, height: 1024, prompt: "a wooden crafting workbench with tools and sawdust on top", note: "Structure — crafting table" },
  { id: "str-furnace", category: "structures", filename: "str-furnace.png", style: PROP_STYLE, width: 1024, height: 1024, prompt: "a stone furnace with a glowing fire inside and a small chimney", note: "Structure — furnace" },
  { id: "str-cookingpot", category: "structures", filename: "str-cookingpot.png", style: PROP_STYLE, width: 1024, height: 1024, prompt: "a black cooking pot over a small campfire on stones", note: "Structure — cooking pot" },
  { id: "str-anvil", category: "structures", filename: "str-anvil.png", style: PROP_STYLE, width: 1024, height: 1024, prompt: "a heavy iron anvil on a wooden block", note: "Structure — anvil" },
  { id: "str-bookshelf", category: "structures", filename: "str-bookshelf.png", style: PROP_STYLE, width: 1024, height: 1024, prompt: "a wooden bookshelf full of colourful old books", note: "Structure — bookshelf" },
  { id: "str-bed", category: "structures", filename: "str-bed.png", style: PROP_STYLE, width: 1024, height: 1024, prompt: "a simple wooden bed with a red blanket and a pillow", note: "Structure — bed" },
  { id: "str-table", category: "structures", filename: "str-table.png", style: PROP_STYLE, width: 1024, height: 1024, prompt: "a wooden table with two stools", note: "Structure — table" },
  { id: "str-cauldron", category: "structures", filename: "str-cauldron.png", style: PROP_STYLE, width: 1024, height: 1024, prompt: "a black iron cauldron with bubbling green brew", note: "Structure — cauldron" },
  { id: "str-grindstone", category: "structures", filename: "str-grindstone.png", style: PROP_STYLE, width: 1024, height: 1024, prompt: "a stone grindstone wheel on a wooden frame", note: "Structure — grindstone" },
  { id: "str-barrelrack", category: "structures", filename: "str-barrelrack.png", style: PROP_STYLE, width: 1024, height: 1024, prompt: "a wooden rack holding stacked barrels", note: "Structure — barrel rack" },
  { id: "str-well", category: "structures", filename: "str-well.png", style: PROP_STYLE, width: 1024, height: 1024, prompt: "a stone water well with a small wooden roof and a bucket on a rope", note: "Structure — well" },

  // ── Asset library: more orthogonal map tiles (batch 9) ───────────────────────────
  { id: "mtile-deepwater", category: "tiles", filename: "deepwater.png", style: TILE_STYLE, width: 512, height: 512, keepBackground: true, prompt: "deep dark blue ocean water with gentle waves", note: "Map tile — deep water" },
  { id: "mtile-shallowwater", category: "tiles", filename: "shallowwater.png", style: TILE_STYLE, width: 512, height: 512, keepBackground: true, prompt: "clear shallow turquoise water over a sandy bottom", note: "Map tile — shallow water" },
  { id: "mtile-beach", category: "tiles", filename: "beach.png", style: TILE_STYLE, width: 512, height: 512, keepBackground: true, prompt: "pale sandy beach with a few small shells", note: "Map tile — beach" },
  { id: "mtile-plains", category: "tiles", filename: "plains.png", style: TILE_STYLE, width: 512, height: 512, keepBackground: true, prompt: "lush green grassy plains with tiny flowers", note: "Map tile — plains" },
  { id: "mtile-denseforest", category: "tiles", filename: "denseforest.png", style: TILE_STYLE, width: 512, height: 512, keepBackground: true, prompt: "dense dark green forest canopy from above, packed treetops", note: "Map tile — dense forest" },
  { id: "mtile-hills", category: "tiles", filename: "hills.png", style: TILE_STYLE, width: 512, height: 512, keepBackground: true, prompt: "rolling green grassy hills seen from above", note: "Map tile — hills" },
  { id: "mtile-rockymountain", category: "tiles", filename: "rockymountain.png", style: TILE_STYLE, width: 512, height: 512, keepBackground: true, prompt: "rugged grey rocky mountain terrain from above", note: "Map tile — rocky mountain" },
  { id: "mtile-tundra", category: "tiles", filename: "tundra.png", style: TILE_STYLE, width: 512, height: 512, keepBackground: true, prompt: "frosty tundra ground, patchy snow over frozen grass", note: "Map tile — tundra" },
  { id: "mtile-swamp", category: "tiles", filename: "swamp.png", style: TILE_STYLE, width: 512, height: 512, keepBackground: true, prompt: "murky green swamp with muddy water and reeds, from above", note: "Map tile — swamp" },
  { id: "mtile-desert", category: "tiles", filename: "desert.png", style: TILE_STYLE, width: 512, height: 512, keepBackground: true, prompt: "rippled golden desert sand dunes from above", note: "Map tile — desert dunes" },
  { id: "mtile-roaddirt", category: "tiles", filename: "roaddirt.png", style: TILE_STYLE, width: 512, height: 512, keepBackground: true, prompt: "a worn brown dirt road path on grass, from above", note: "Map tile — dirt road" },
  { id: "mtile-farmfield", category: "tiles", filename: "farmfield.png", style: TILE_STYLE, width: 512, height: 512, keepBackground: true, prompt: "ploughed farm field with neat soil furrows, from above", note: "Map tile — farm field" },

  // ── Asset library: iso props & decorations (batch 10) ────────────────────────────
  { id: "prop-treeoak", category: "props", filename: "prop-treeoak.png", style: PROP_STYLE, width: 1024, height: 1024, prompt: "a big round green oak tree with a thick brown trunk", note: "Prop — oak tree" },
  { id: "prop-treepine", category: "props", filename: "prop-treepine.png", style: PROP_STYLE, width: 1024, height: 1024, prompt: "a tall green pine fir tree", note: "Prop — pine tree" },
  { id: "prop-treedead", category: "props", filename: "prop-treedead.png", style: PROP_STYLE, width: 1024, height: 1024, prompt: "a bare twisted dead tree with no leaves", note: "Prop — dead tree" },
  { id: "prop-bush", category: "props", filename: "prop-bush.png", style: PROP_STYLE, width: 1024, height: 1024, prompt: "a round green bush with small berries", note: "Prop — bush" },
  { id: "prop-rocksmall", category: "props", filename: "prop-rocksmall.png", style: PROP_STYLE, width: 1024, height: 1024, prompt: "a small cluster of grey rocks with moss", note: "Prop — small rocks" },
  { id: "prop-rocklarge", category: "props", filename: "prop-rocklarge.png", style: PROP_STYLE, width: 1024, height: 1024, prompt: "a large mossy grey boulder", note: "Prop — large rock" },
  { id: "prop-flowers", category: "props", filename: "prop-flowers.png", style: PROP_STYLE, width: 1024, height: 1024, prompt: "a small patch of colourful wild flowers", note: "Prop — flower patch" },
  { id: "prop-fence", category: "props", filename: "prop-fence.png", style: PROP_STYLE, width: 1024, height: 1024, prompt: "a section of wooden post-and-rail fence", note: "Prop — fence" },
  { id: "prop-lamppost", category: "props", filename: "prop-lamppost.png", style: PROP_STYLE, width: 1024, height: 1024, prompt: "an iron street lamp post with a warm glowing lantern", note: "Prop — lamp post" },
  { id: "prop-signpost", category: "props", filename: "prop-signpost.png", style: PROP_STYLE, width: 1024, height: 1024, prompt: "a wooden directional signpost with arrow boards", note: "Prop — signpost" },
  { id: "prop-stump", category: "props", filename: "prop-stump.png", style: PROP_STYLE, width: 1024, height: 1024, prompt: "a cut tree stump with rings and an axe in it", note: "Prop — stump" },
  { id: "prop-campfire", category: "props", filename: "prop-campfire.png", style: PROP_STYLE, width: 1024, height: 1024, prompt: "a campfire of logs with orange flames and stones around", note: "Prop — campfire" },
  { id: "prop-tent", category: "props", filename: "prop-tent.png", style: PROP_STYLE, width: 1024, height: 1024, prompt: "a small triangular canvas camping tent", note: "Prop — tent" },
  { id: "prop-haystack", category: "props", filename: "prop-haystack.png", style: PROP_STYLE, width: 1024, height: 1024, prompt: "a round golden haystack", note: "Prop — haystack" },
  // batch 15 — more iso nature decorations
  { id: "prop-palmtree", category: "props", filename: "prop-palmtree.png", style: PROP_STYLE, width: 1024, height: 1024, prompt: "a tall tropical palm tree with green fronds and coconuts", note: "Prop — palm tree" },
  { id: "prop-cherrytree", category: "props", filename: "prop-cherrytree.png", style: PROP_STYLE, width: 1024, height: 1024, prompt: "a pink blossoming cherry tree", note: "Prop — cherry tree" },
  { id: "prop-birchtree", category: "props", filename: "prop-birchtree.png", style: PROP_STYLE, width: 1024, height: 1024, prompt: "a slender white birch tree with green leaves", note: "Prop — birch tree" },
  { id: "prop-willowtree", category: "props", filename: "prop-willowtree.png", style: PROP_STYLE, width: 1024, height: 1024, prompt: "a drooping green willow tree", note: "Prop — willow tree" },
  { id: "prop-boulder", category: "props", filename: "prop-boulder.png", style: PROP_STYLE, width: 1024, height: 1024, prompt: "a big rounded grey boulder with moss", note: "Prop — boulder" },
  { id: "prop-rockpile", category: "props", filename: "prop-rockpile.png", style: PROP_STYLE, width: 1024, height: 1024, prompt: "a small pile of mossy grey rocks", note: "Prop — rock pile" },
  { id: "prop-fern", category: "props", filename: "prop-fern.png", style: PROP_STYLE, width: 1024, height: 1024, prompt: "a leafy green fern plant", note: "Prop — fern" },
  { id: "prop-cattails", category: "props", filename: "prop-cattails.png", style: PROP_STYLE, width: 1024, height: 1024, prompt: "a cluster of green cattails reeds with brown tips", note: "Prop — cattails" },
  { id: "prop-mushroomcluster", category: "props", filename: "prop-mushroomcluster.png", style: PROP_STYLE, width: 1024, height: 1024, prompt: "a cluster of red and brown mushrooms", note: "Prop — mushroom cluster" },
  { id: "prop-lilypad", category: "props", filename: "prop-lilypad.png", style: PROP_STYLE, width: 1024, height: 1024, prompt: "a few green lily pads with a pink water lily on water", note: "Prop — lily pad" },
  { id: "prop-flowerbed", category: "props", filename: "prop-flowerbed.png", style: PROP_STYLE, width: 1024, height: 1024, prompt: "a small flower bed with red, yellow and blue tulips", note: "Prop — flower bed" },
  { id: "prop-logpile", category: "props", filename: "prop-logpile.png", style: PROP_STYLE, width: 1024, height: 1024, prompt: "a stacked pile of cut brown logs", note: "Prop — log pile" },

  // ── Asset library: monsters & creatures (batch 11) ───────────────────────────────
  { id: "mob-goblin", category: "monsters", filename: "mob-goblin.png", style: MONSTER_STYLE, width: 1024, height: 1024, prompt: "a small green goblin raider with pointed ears, ragged clothes and a crude dagger", note: "Monster — goblin (Goblin Pillard)" },
  { id: "mob-slime", category: "monsters", filename: "mob-slime.png", style: MONSTER_STYLE, width: 1024, height: 1024, prompt: "a wobbly translucent purple slime blob with two big eyes", note: "Monster — slime (Slime Vorace)" },
  { id: "mob-windelemental", category: "monsters", filename: "mob-windelemental.png", style: MONSTER_STYLE, width: 1024, height: 1024, prompt: "a swirling pale blue wind elemental spirit made of spinning air with a face", note: "Monster — wind elemental (Élémentaire de Vent)" },
  { id: "mob-skeleton", category: "monsters", filename: "mob-skeleton.png", style: MONSTER_STYLE, width: 1024, height: 1024, prompt: "a small undead skeleton warrior holding a rusty sword", note: "Monster — skeleton" },
  { id: "mob-wolf", category: "monsters", filename: "mob-wolf.png", style: MONSTER_STYLE, width: 1024, height: 1024, prompt: "a fierce grey wolf snarling", note: "Monster — wolf" },
  { id: "mob-bat", category: "monsters", filename: "mob-bat.png", style: MONSTER_STYLE, width: 1024, height: 1024, prompt: "a purple cave bat with spread wings and sharp little fangs", note: "Monster — bat" },
  { id: "mob-spider", category: "monsters", filename: "mob-spider.png", style: MONSTER_STYLE, width: 1024, height: 1024, prompt: "a chunky dark spider with eight legs and several eyes", note: "Monster — spider" },
  { id: "mob-orc", category: "monsters", filename: "mob-orc.png", style: MONSTER_STYLE, width: 1024, height: 1024, prompt: "a big muscular green orc brute with tusks holding a heavy club", note: "Monster — orc" },
  { id: "mob-mushroomling", category: "monsters", filename: "mob-mushroomling.png", style: MONSTER_STYLE, width: 1024, height: 1024, prompt: "a small walking red mushroom creature with little legs and an angry face", note: "Monster — mushroomling" },
  { id: "mob-ghost", category: "monsters", filename: "mob-ghost.png", style: MONSTER_STYLE, width: 1024, height: 1024, prompt: "a floating pale translucent ghost with a wispy tail and a spooky face", note: "Monster — ghost" },

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
