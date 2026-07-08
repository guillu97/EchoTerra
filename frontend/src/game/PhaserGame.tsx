import { useEffect, useRef } from "react";
import Phaser from "phaser";
import { MapScene } from "./MapScene";
import { CombatScene } from "./CombatScene";
import { bus, EV } from "../eventBus";

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

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent,
      width: parent.clientWidth || 390,
      height: parent.clientHeight || 560,
      backgroundColor: "#0e1626",
      scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.NO_CENTER },
      scene: [MapScene, CombatScene],
      // Mipmaps: the 1024² unit/building PNGs render at ~40px — trilinear minification
      // is both faster (texture-cache friendly) and less shimmery than raw LINEAR.
      render: { antialias: true, mipmapFilter: "LINEAR_MIPMAP_LINEAR", powerPreference: "high-performance" },
    });
    gameRef.current = game;
    if (import.meta.env.DEV) (window as any).__phaser = game;

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
      game.destroy(true);
      gameRef.current = undefined;
    };
  }, []);

  return <div ref={ref} style={{ position: "absolute", inset: 0 }} />;
}
