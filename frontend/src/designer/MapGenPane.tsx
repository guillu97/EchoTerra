import { useEffect, useMemo, useRef, useState } from "react";
import { useDesigner } from "./store";
import type { MapGenDef } from "./types";
import { BIOME_IDS, generateMap } from "./mapgen";
import { BIOME_COLORS } from "../game/render";

// 🌍 Génération tab: live-preview the world generation parameters. The terrain,
// resource and monster views consume the OTHER tabs' data (Ressources drop tables,
// Monstres spawn biomes), so the whole design loop stays in one tool.

type View = "terrain" | "levels" | "resources" | "monsters";

const VIEWS: { id: View; label: string }[] = [
  { id: "terrain", label: "🗺️ Terrain" },
  { id: "levels", label: "⛰️ Hauteurs" },
  { id: "resources", label: "🌿 Ressources" },
  { id: "monsters", label: "👹 Monstres" },
];

const PACK_COLORS = ["#e74c3c", "#9b59b6", "#00bcd4", "#ff9800", "#4caf50", "#f06292"];

const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;
const mix = (c: number, to: number, t: number) => {
  const r = Math.round(((c >> 16) & 255) * (1 - t) + ((to >> 16) & 255) * t);
  const g = Math.round(((c >> 8) & 255) * (1 - t) + ((to >> 8) & 255) * t);
  const b = Math.round((c & 255) * (1 - t) + (to & 255) * t);
  return `rgb(${r},${g},${b})`;
};

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  fmt,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  fmt?: (v: number) => string;
}) {
  return (
    <label className="dz-slider">
      <span>
        {label} <b>{fmt ? fmt(value) : value}</b>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function MapGenPane() {
  const doc = useDesigner((s) => s.doc);
  const updateMapgen = useDesigner((s) => s.updateMapgen);
  const def = doc.mapgen;
  const [view, setView] = useState<View>("terrain");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const up = (patch: Partial<MapGenDef>) => updateMapgen({ ...def, ...patch });
  // Thresholds must stay ascending — clamp each between its neighbours.
  const upThreshold = (key: keyof MapGenDef["thresholds"], v: number) => {
    const order: (keyof MapGenDef["thresholds"])[] = ["water", "sand", "grass", "forest", "mountain"];
    const i = order.indexOf(key);
    const lo = i > 0 ? def.thresholds[order[i - 1]] + 0.01 : 0.01;
    const hi = i < order.length - 1 ? def.thresholds[order[i + 1]] - 0.01 : 0.99;
    up({ thresholds: { ...def.thresholds, [key]: Math.min(hi, Math.max(lo, v)) } });
  };

  const gen = useMemo(() => generateMap(def, doc.terrains, doc.monsters), [def, doc.terrains, doc.monsters]);
  const speciesColor = (species: string) => {
    const i = Math.max(0, doc.monsters.findIndex((m) => m.name === species));
    return PACK_COLORS[i % PACK_COLORS.length];
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const px = Math.max(5, Math.min(24, Math.floor(Math.min(760 / gen.w, 620 / gen.h))));
    canvas.width = gen.w * px;
    canvas.height = gen.h * px;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const maxRes = Math.max(1, ...doc.terrains.map((r) => r.resourcesMax));

    for (let y = 0; y < gen.h; y++)
      for (let x = 0; x < gen.w; x++) {
        const i = y * gen.w + x;
        const b = gen.biome[i];
        const lvl = gen.level[i];
        const base = BIOME_COLORS[b as keyof typeof BIOME_COLORS] ?? 0x888888;
        let fill: string;
        if (view === "levels") {
          const t = def.maxHeight > 0 ? lvl / def.maxHeight : 0;
          fill = mix(0x10151f, 0xffffff, t);
        } else {
          // Terrain shading: higher tiles are brighter (relief reads at a glance).
          const shade = b === 0 ? 0 : (def.maxHeight > 0 ? lvl / def.maxHeight : 0) * 0.35;
          fill = mix(base, 0xffffff, shade);
          if (view === "resources" || view === "monsters") fill = mix(base, 0x10151f, 0.55);
        }
        ctx.fillStyle = fill;
        ctx.fillRect(x * px, y * px, px, px);
        if (view === "resources" && gen.resources[i] > 0) {
          ctx.fillStyle = `rgba(76, 220, 110, ${0.25 + 0.65 * (gen.resources[i] / maxRes)})`;
          ctx.fillRect(x * px + 1, y * px + 1, px - 2, px - 2);
        }
      }

    // subtle grid
    ctx.strokeStyle = "rgba(0,0,0,0.15)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= gen.w; x++) {
      ctx.beginPath();
      ctx.moveTo(x * px + 0.5, 0);
      ctx.lineTo(x * px + 0.5, gen.h * px);
      ctx.stroke();
    }
    for (let y = 0; y <= gen.h; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * px + 0.5);
      ctx.lineTo(gen.w * px, y * px + 0.5);
      ctx.stroke();
    }

    if (view === "monsters") {
      for (const p of gen.packs) {
        ctx.fillStyle = speciesColor(p.species);
        ctx.beginPath();
        ctx.arc(p.x * px + px / 2, p.y * px + px / 2, Math.max(3, px * 0.32), 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        if (px >= 12) {
          ctx.fillStyle = "#fff";
          ctx.font = `bold ${Math.max(8, px * 0.42)}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(p.count), p.x * px + px / 2, p.y * px + px / 2 + 0.5);
        }
      }
    }

    // town marker (all views)
    ctx.fillStyle = "#ffd23f";
    ctx.strokeStyle = "#7a5b00";
    ctx.lineWidth = 2;
    const tx = gen.town.x * px;
    const ty = gen.town.y * px;
    ctx.fillRect(tx + 2, ty + 2, px - 4, px - 4);
    ctx.strokeRect(tx + 2, ty + 2, px - 4, px - 4);
  }, [gen, view, def.maxHeight, doc.terrains, doc.monsters]);

  return (
    <div className="dz-mapgen">
      <div className="dz-mg-params">
        <h4>Graine</h4>
        <div className="dz-form-head">
          <input
            type="number"
            value={def.seed}
            onChange={(e) => up({ seed: Number(e.target.value) || 0 })}
            style={{ flex: 1 }}
          />
          <button className="dz-btn" onClick={() => up({ seed: Math.floor(Math.random() * 1_000_000) })}>🎲</button>
        </div>
        <h4>Dimensions</h4>
        <div className="dz-form-head">
          <Slider label="Largeur" value={def.width} min={10} max={60} step={1} onChange={(v) => up({ width: v })} />
          <Slider label="Hauteur" value={def.height} min={10} max={60} step={1} onChange={(v) => up({ height: v })} />
        </div>
        <h4>Relief (Perlin)</h4>
        <Slider label="Échelle du bruit" value={def.scale} min={0.02} max={0.3} step={0.005} onChange={(v) => up({ scale: v })} fmt={(v) => v.toFixed(3)} />
        <Slider label="Octaves" value={def.octaves} min={1} max={4} step={1} onChange={(v) => up({ octaves: v })} />
        <Slider label="Persistance" value={def.persistence} min={0.1} max={0.9} step={0.05} onChange={(v) => up({ persistence: v })} fmt={(v) => v.toFixed(2)} />
        <Slider label="Hauteur max (niveaux)" value={def.maxHeight} min={1} max={8} step={1} onChange={(v) => up({ maxHeight: v })} />
        <Slider
          label="Lissage — écart max entre voisins"
          value={def.maxStep}
          min={1}
          max={6}
          step={1}
          onChange={(v) => up({ maxStep: v })}
          fmt={(v) => (v === 1 ? "1 (très doux)" : String(v))}
        />
        <h4>Seuils de biomes (sur la hauteur lissée)</h4>
        <Slider label="🌊 Eau <" value={def.thresholds.water} min={0} max={1} step={0.01} onChange={(v) => upThreshold("water", v)} fmt={(v) => v.toFixed(2)} />
        <Slider label="🏜️ Sable <" value={def.thresholds.sand} min={0} max={1} step={0.01} onChange={(v) => upThreshold("sand", v)} fmt={(v) => v.toFixed(2)} />
        <Slider label="🌾 Plaine <" value={def.thresholds.grass} min={0} max={1} step={0.01} onChange={(v) => upThreshold("grass", v)} fmt={(v) => v.toFixed(2)} />
        <Slider label="🌲 Forêt <" value={def.thresholds.forest} min={0} max={1} step={0.01} onChange={(v) => upThreshold("forest", v)} fmt={(v) => v.toFixed(2)} />
        <Slider label="⛰️ Montagne <" value={def.thresholds.mountain} min={0} max={1} step={0.01} onChange={(v) => upThreshold("mountain", v)} fmt={(v) => v.toFixed(2)} />
        <h4>Monstres au départ</h4>
        <Slider label="Nombre de packs" value={def.monsterPacks} min={0} max={24} step={1} onChange={(v) => up({ monsterPacks: v })} />
        <div className="dz-form-head">
          <Slider label="Pack min" value={def.packSizeMin} min={1} max={8} step={1} onChange={(v) => up({ packSizeMin: Math.min(v, def.packSizeMax) })} />
          <Slider label="Pack max" value={def.packSizeMax} min={1} max={10} step={1} onChange={(v) => up({ packSizeMax: Math.max(v, def.packSizeMin) })} />
        </div>
        <p className="dz-mg-note">
          Les vues Ressources et Monstres utilisent les tables des onglets 🌿 et 👹 (richesse par biome,
          terrains d'apparition par espèce). L'aperçu Perlin JS illustre le style — l'export des
          paramètres pilote l'implémentation serveur.
        </p>
      </div>

      <div className="dz-mg-view">
        <div className="dz-mg-viewbar">
          {VIEWS.map((v) => (
            <button key={v.id} className={`dz-btn tab ${view === v.id ? "on" : ""}`} onClick={() => setView(v.id)}>
              {v.label}
            </button>
          ))}
        </div>
        <div className="dz-mg-canvas">
          <canvas ref={canvasRef} />
        </div>
        <div className="dz-mg-legend">
          {view === "monsters"
            ? doc.monsters.map((m) => (
                <span key={m.id} className="dz-leg">
                  <i style={{ background: speciesColor(m.name) }} /> {m.name}
                </span>
              ))
            : BIOME_IDS.map((id, i) => (
                <span key={id} className="dz-leg">
                  <i style={{ background: hex(BIOME_COLORS[i as keyof typeof BIOME_COLORS] ?? 0x888888) }} /> {doc.terrains.find((r) => r.id === id)?.name ?? id}
                </span>
              ))}
          <span className="dz-leg">
            <i style={{ background: "#ffd23f" }} /> Ville
          </span>
          <span className="dz-leg muted">{gen.packs.length} packs placés</span>
        </div>
      </div>
    </div>
  );
}
