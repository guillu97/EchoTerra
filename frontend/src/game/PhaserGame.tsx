import { useEffect, useRef } from "react";
import Phaser from "phaser";
import { MapScene } from "./MapScene";
import { CombatScene } from "./CombatScene";
import { bus, EV } from "../eventBus";
import { DPR } from "./dpr";

// PhaserGame fills its parent container (the Map tab) and resizes with it. It holds
// both scenes; CombatScene boots then sleeps so its listeners exist. ShowScene events
// wake/sleep the right scene.
// The component lives as long as the game session: when the Map tab is hidden
// (`active` = false) the game is NOT destroyed — its scenes are put to sleep so the
// hidden canvas stops rendering, and everything (textures, atlas, tile layer) stays
// warm for an instant re-open.
export function PhaserGame({ active = true }: { active?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game>();
  const activeRef = useRef(active);
  activeRef.current = active;

  // Sleep both scenes while the tab is hidden. Waking is driven by the next
  // ShowScene event (syncScene fires when the tab becomes active again).
  useEffect(() => {
    const game = gameRef.current;
    if (active || !game || !game.isBooted) return;
    for (const name of ["map", "combat"]) {
      if (game.scene.isActive(name)) game.scene.sleep(name);
    }
  }, [active]);

  useEffect(() => {
    if (gameRef.current || !ref.current) return;
    const parent = ref.current;

    // High-DPI: the canvas backing store is DPR× the CSS size (zoom 1/DPR keeps the
    // CSS size and the input transform consistent) — otherwise phones (DPR 2–3)
    // upscale a CSS-pixel canvas and the map looks pixelated. Scale mode NONE +
    // a ResizeObserver below: Phaser's RESIZE mode would size the canvas in CSS
    // pixels, so we own the resize and multiply by DPR ourselves.
    const sizeOf = () => ({
      w: Math.max(1, Math.floor((parent.clientWidth || 390) * DPR)),
      h: Math.max(1, Math.floor((parent.clientHeight || 560) * DPR)),
    });
    const initial = sizeOf();
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent,
      width: initial.w,
      height: initial.h,
      // Transparent canvas: the Map tab shows the app's sky background (.sky, same
      // image as the Home tab) behind the iso terrain. CombatScene keeps its own
      // opaque camera background color.
      transparent: true,
      scale: { mode: Phaser.Scale.NONE, zoom: 1 / DPR },
      scene: [MapScene, CombatScene],
      // Mipmaps: the unit/building PNGs render small — trilinear minification
      // is both faster (texture-cache friendly) and less shimmery than raw LINEAR.
      render: { antialias: true, mipmapFilter: "LINEAR_MIPMAP_LINEAR", powerPreference: "high-performance" },
    });
    gameRef.current = game;
    if (import.meta.env.DEV) (window as any).__phaser = game;

    const syncSize = () => {
      if (!game.isBooted) return;
      const { w, h } = sizeOf();
      if (game.scale.width !== w || game.scale.height !== h) game.scale.resize(w, h);
    };
    game.events.once(Phaser.Core.Events.READY, syncSize);
    const ro = new ResizeObserver(syncSize);
    ro.observe(parent);

    game.scene.start("combat");

    const show = (name: string) => {
      // renderMap/renderCombat fire on every state refresh (incl. the 20s poll);
      // while the tab is hidden they must not wake the slept scenes.
      if (!activeRef.current) return;
      const sm = game.scene;
      const other = name === "map" ? "combat" : "map";
      if (sm.isSleeping(name)) sm.wake(name);
      else if (!sm.isActive(name)) sm.start(name);
      if (sm.isActive(other) && !sm.isSleeping(other)) sm.sleep(other);
      sm.bringToTop(name);
    };
    const unsub = bus.on(EV.ShowScene, show);

    return () => {
      unsub();
      ro.disconnect();
      game.destroy(true);
      gameRef.current = undefined;
    };
  }, []);

  return <div ref={ref} style={{ position: "absolute", inset: 0 }} />;
}
