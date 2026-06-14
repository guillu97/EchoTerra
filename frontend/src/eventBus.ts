// Tiny typed event bus that decouples React (state + REST) from Phaser (rendering
// and pointer input). React pushes "render" events to the scenes; the scenes emit
// "intent" events (clicks) back to React.
type Handler = (payload: any) => void;

class EventBus {
  private handlers: Record<string, Handler[]> = {};

  on(event: string, fn: Handler) {
    (this.handlers[event] ||= []).push(fn);
    return () => this.off(event, fn);
  }

  off(event: string, fn: Handler) {
    this.handlers[event] = (this.handlers[event] || []).filter((h) => h !== fn);
  }

  emit(event: string, payload?: any) {
    (this.handlers[event] || []).forEach((h) => h(payload));
  }
}

export const bus = new EventBus();

// Event names (kept as constants to avoid typos across files).
export const EV = {
  // React -> Phaser
  MapRender: "map:render", // { game, selectedHeroId }
  CombatRender: "combat:render", // { resp, mode }
  ShowScene: "scene:show", // "map" | "combat"
  // Phaser -> React
  MapTileClick: "map:tileClick", // { x, y }
  MapHeroClick: "map:heroClick", // { heroId }
  MapHeroMenu: "map:heroMenu", // { sx, sy } — open the radial action menu at screen coords
  CombatTileClick: "combat:tileClick", // { x, y }
  CombatUnitClick: "combat:unitClick", // { unitId }
} as const;
