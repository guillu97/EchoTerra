import { useEffect, useRef } from "react";
import Phaser from "phaser";
import { MapScene } from "./MapScene";
import { CombatScene } from "./CombatScene";
import { bus, EV } from "../eventBus";

// PhaserGame fills its parent container (the Map tab) and resizes with it. It holds
// both scenes; CombatScene boots then sleeps so its listeners exist. ShowScene events
// wake/sleep the right scene.
export function PhaserGame() {
  const ref = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game>();

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
      render: { antialias: true },
    });
    gameRef.current = game;
    if (import.meta.env.DEV) (window as any).__phaser = game;

    game.scene.start("combat");

    const show = (name: string) => {
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
