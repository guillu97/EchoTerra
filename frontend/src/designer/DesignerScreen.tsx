import { useMemo, useRef } from "react";
import { useStore } from "../store";
import { useDesigner, type DesignTab } from "./store";
import type {
  AttackDef,
  BiomeResourceDef,
  BuildingDef,
  DesignDoc,
  GridCell,
  HeroClassDef,
  MaterialCost,
  MonsterDef,
  RecipeDef,
  ResourceDrop,
  SkillDef,
} from "./types";
import { manhattanCells } from "./types";
import { ALL_ASSETS } from "../editor/assetIndex";
import { MapGenPane } from "./MapGenPane";
import "./designer.css";

// Game-design data studio (dev tool, like the map editor): three JSON catalogs —
// the buildings tech tree, the crafting catalog and the hero class tree — edited
// visually and exported as JSON to be handed back for implementation.

const TABS: { id: DesignTab; label: string }[] = [
  { id: "buildings", label: "🏗️ Bâtiments" },
  { id: "recipes", label: "⚒️ Craft" },
  { id: "classes", label: "🧙 Classes" },
  { id: "resources", label: "🌿 Ressources" },
  { id: "monsters", label: "👹 Monstres" },
  { id: "mapgen", label: "🌍 Génération" },
];

const DROP_TYPES = ["plante", "animal", "objet", "minerai", "eau", "aliment", "consommable", "arme", "deco"];

// --- small shared editors -----------------------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="dz-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function CostList({
  items,
  onChange,
  addLabel,
}: {
  items: MaterialCost[];
  onChange: (next: MaterialCost[]) => void;
  addLabel: string;
}) {
  return (
    <div className="dz-costs">
      {items.map((m, i) => (
        <div className="dz-cost-row" key={i}>
          <input
            value={m.name}
            placeholder="Matériau"
            onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
          />
          <input
            type="number"
            min={1}
            value={m.qty}
            onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) || 1 } : x)))}
          />
          <button className="dz-x" onClick={() => onChange(items.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button className="dz-add" onClick={() => onChange([...items, { name: "Bois", qty: 1 }])}>
        ＋ {addLabel}
      </button>
    </div>
  );
}

// Drop-table editor: type + name + qty + draw weight per row.
function DropsList({
  items,
  onChange,
  addLabel,
}: {
  items: ResourceDrop[];
  onChange: (next: ResourceDrop[]) => void;
  addLabel: string;
}) {
  const upRow = (i: number, patch: Partial<ResourceDrop>) =>
    onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="dz-costs">
      {items.length > 0 && (
        <div className="dz-drop-head">
          <span>Type</span><span>Nom</span><span>Qté</span><span>Poids</span><span />
        </div>
      )}
      {items.map((d, i) => (
        <div className="dz-cost-row drop" key={i}>
          <select value={d.type} onChange={(e) => upRow(i, { type: e.target.value })}>
            {DROP_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
          <input value={d.name} placeholder="Objet" onChange={(e) => upRow(i, { name: e.target.value })} />
          <input type="number" min={1} value={d.qty} onChange={(e) => upRow(i, { qty: Number(e.target.value) || 1 })} />
          <input type="number" min={1} title="Pondération du tirage" value={d.weight} onChange={(e) => upRow(i, { weight: Number(e.target.value) || 1 })} />
          <button className="dz-x" onClick={() => onChange(items.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button className="dz-add" onClick={() => onChange([...items, { type: "objet", name: "Bois", qty: 1, weight: 1 }])}>
        ＋ {addLabel}
      </button>
    </div>
  );
}

// GDD-style shape editor: a 7×7 clickable grid of offsets around an anchor.
// mode "target" (green, anchor = the attacker ⚔️) or "damage" (red, anchor = the
// struck cell 🎯 — always hit, shown solid).
const GRID_R = 3;
function GridShapeEditor({
  label,
  cells,
  onChange,
  mode,
}: {
  label: string;
  cells: GridCell[];
  onChange: (next: GridCell[]) => void;
  mode: "target" | "damage";
}) {
  const has = (dx: number, dy: number) => cells.some((c) => c.dx === dx && c.dy === dy);
  const toggle = (dx: number, dy: number) => {
    if (dx === 0 && dy === 0 && mode === "damage") return; // the struck cell is always hit
    onChange(has(dx, dy) ? cells.filter((c) => !(c.dx === dx && c.dy === dy)) : [...cells, { dx, dy }]);
  };
  const rows = [];
  for (let dy = -GRID_R; dy <= GRID_R; dy++) {
    const cols = [];
    for (let dx = -GRID_R; dx <= GRID_R; dx++) {
      const centre = dx === 0 && dy === 0;
      const on = has(dx, dy) || (centre && mode === "damage");
      cols.push(
        <button
          key={dx}
          className={`dz-gcell ${on ? `on ${mode}` : ""} ${centre ? "centre" : ""}`}
          title={centre ? (mode === "target" ? "Attaquant" : "Case touchée") : `${dx},${dy}`}
          onClick={() => toggle(dx, dy)}
        >
          {centre ? (mode === "target" ? "⚔️" : "🎯") : ""}
        </button>,
      );
    }
    rows.push(
      <div className="dz-grow" key={dy}>
        {cols}
      </div>,
    );
  }
  return (
    <div className={`dz-grid ${mode}`}>
      <span className="dz-grid-label">{label}</span>
      <div className="dz-gwrap">{rows}</div>
      <div className="dz-grid-tools">
        <button className="dz-add" onClick={() => onChange(manhattanCells(1, 1))}>mêlée</button>
        <button className="dz-add" onClick={() => onChange(manhattanCells(1, 3))}>portée 3</button>
        <button className="dz-add" onClick={() => onChange([])}>vider</button>
      </div>
    </div>
  );
}

// --- tech-tree pane (shared by buildings & classes) ----------------------------

interface TreeNode {
  id: string;
  icon: string;
  name: string;
  sub: string;
  parents: { id: string; label?: string }[];
}

const COL_W = 210;
const ROW_H = 74;
const NODE_W = 178;
const NODE_H = 56;

function TreePane({
  nodes,
  selId,
  onSelect,
  rootLabel,
}: {
  nodes: TreeNode[];
  selId: string | null;
  onSelect: (id: string) => void;
  rootLabel?: string;
}) {
  const layout = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const depth = new Map<string, number>();
    const seen = new Set<string>();
    const d = (id: string): number => {
      if (depth.has(id)) return depth.get(id)!;
      if (seen.has(id)) return 0; // cycle guard
      seen.add(id);
      const n = byId.get(id);
      const parents = (n?.parents ?? []).filter((p) => byId.has(p.id));
      const v = parents.length === 0 ? 0 : 1 + Math.max(...parents.map((p) => d(p.id)));
      depth.set(id, v);
      return v;
    };
    nodes.forEach((n) => d(n.id));
    const rootOffset = rootLabel ? 1 : 0;
    const cols = new Map<number, TreeNode[]>();
    for (const n of nodes) {
      const c = depth.get(n.id)! + rootOffset;
      if (!cols.has(c)) cols.set(c, []);
      cols.get(c)!.push(n);
    }
    const pos = new Map<string, { x: number; y: number }>();
    for (const [c, list] of cols) list.forEach((n, row) => pos.set(n.id, { x: c * COL_W + 14, y: row * ROW_H + 14 }));
    const maxCol = Math.max(0, ...[...cols.keys()]);
    const maxRows = Math.max(1, ...[...cols.values()].map((l) => l.length), rootLabel ? 1 : 0);
    return { pos, w: (maxCol + 1) * COL_W + 28, h: maxRows * ROW_H + 28 };
  }, [nodes, rootLabel]);

  return (
    <div className="dz-tree">
      <div className="dz-tree-canvas" style={{ width: layout.w, height: layout.h }}>
        <svg className="dz-edges" width={layout.w} height={layout.h}>
          {rootLabel &&
            nodes
              .filter((n) => n.parents.length === 0)
              .map((n) => {
                const to = layout.pos.get(n.id)!;
                return (
                  <path
                    key={`root-${n.id}`}
                    d={`M ${14 + NODE_W} ${14 + NODE_H / 2} C ${to.x - 40} ${14 + NODE_H / 2}, ${to.x - 40} ${to.y + NODE_H / 2}, ${to.x} ${to.y + NODE_H / 2}`}
                    className="dz-edge"
                  />
                );
              })}
          {nodes.flatMap((n) =>
            n.parents
              .filter((p) => layout.pos.has(p.id))
              .map((p) => {
                const from = layout.pos.get(p.id)!;
                const to = layout.pos.get(n.id)!;
                const x1 = from.x + NODE_W;
                const y1 = from.y + NODE_H / 2;
                const x2 = to.x;
                const y2 = to.y + NODE_H / 2;
                return (
                  <g key={`${p.id}->${n.id}`}>
                    <path d={`M ${x1} ${y1} C ${x1 + 40} ${y1}, ${x2 - 40} ${y2}, ${x2} ${y2}`} className="dz-edge" />
                    {p.label && (
                      <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 5} className="dz-edge-label">
                        {p.label}
                      </text>
                    )}
                  </g>
                );
              }),
          )}
        </svg>
        {rootLabel && (
          <div className="dz-node root" style={{ left: 14, top: 14 }}>
            <span className="dz-node-name">{rootLabel}</span>
          </div>
        )}
        {nodes.map((n) => {
          const p = layout.pos.get(n.id)!;
          return (
            <button
              key={n.id}
              className={`dz-node ${n.id === selId ? "sel" : ""}`}
              style={{ left: p.x, top: p.y }}
              onClick={() => onSelect(n.id)}
            >
              <span className="dz-node-name">{n.icon} {n.name}</span>
              <span className="dz-node-sub">{n.sub}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// --- inspectors -----------------------------------------------------------------

function BuildingForm({ b }: { b: BuildingDef }) {
  const doc = useDesigner((s) => s.doc);
  const update = useDesigner((s) => s.updateBuilding);
  const removeItem = useDesigner((s) => s.removeItem);
  const up = (patch: Partial<BuildingDef>) => update(b.id, { ...b, ...patch });
  const others = doc.buildings.filter((x) => x.id !== b.id);
  return (
    <div className="dz-form">
      <div className="dz-form-head">
        <Field label="Icône"><input className="dz-icon" value={b.icon} onChange={(e) => up({ icon: e.target.value })} /></Field>
        <Field label="Nom"><input value={b.name} onChange={(e) => up({ name: e.target.value })} /></Field>
        <Field label="Id"><input value={b.id} onChange={(e) => up({ id: e.target.value })} /></Field>
      </div>
      <Field label="Description"><textarea value={b.blurb} onChange={(e) => up({ blurb: e.target.value })} /></Field>
      <label className="dz-check">
        <input type="checkbox" checked={b.startsBuilt} onChange={(e) => up({ startsBuilt: e.target.checked })} />
        Construit dès le départ
      </label>

      <h4>Prérequis (arbre techno)</h4>
      {b.requires.map((r, i) => (
        <div className="dz-cost-row" key={i}>
          <select
            value={r.building}
            onChange={(e) => up({ requires: b.requires.map((x, j) => (j === i ? { ...x, building: e.target.value } : x)) })}
          >
            {others.map((o) => (
              <option key={o.id} value={o.id}>{o.icon} {o.name}</option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            title="Niveau requis"
            value={r.level}
            onChange={(e) => up({ requires: b.requires.map((x, j) => (j === i ? { ...x, level: Number(e.target.value) || 1 } : x)) })}
          />
          <button className="dz-x" onClick={() => up({ requires: b.requires.filter((_, j) => j !== i) })}>✕</button>
        </div>
      ))}
      <button className="dz-add" onClick={() => up({ requires: [...b.requires, { building: others[0]?.id ?? "", level: 1 }] })}>
        ＋ Ajouter un prérequis
      </button>

      <h4>Niveaux (coûts & effets)</h4>
      {b.levels.map((l, i) => (
        <div className="dz-level" key={i}>
          <div className="dz-level-head">
            <b>{i === 0 ? "Construction (niv. 1)" : `Amélioration → niv. ${i + 1}`}</b>
            {b.levels.length > 1 && (
              <button className="dz-x" onClick={() => up({ levels: b.levels.filter((_, j) => j !== i) })}>✕</button>
            )}
          </div>
          <Field label="Points d'action">
            <input type="number" min={0} value={l.pa} onChange={(e) => up({ levels: b.levels.map((x, j) => (j === i ? { ...x, pa: Number(e.target.value) || 0 } : x)) })} />
          </Field>
          <CostList
            items={l.materials}
            addLabel="Matériau"
            onChange={(materials) => up({ levels: b.levels.map((x, j) => (j === i ? { ...x, materials } : x)) })}
          />
          <Field label="Effets du niveau">
            <input value={l.effects} onChange={(e) => up({ levels: b.levels.map((x, j) => (j === i ? { ...x, effects: e.target.value } : x)) })} />
          </Field>
        </div>
      ))}
      <button className="dz-add" onClick={() => up({ levels: [...b.levels, { pa: 2 + b.levels.length, materials: [], effects: "" }] })}>
        ＋ Ajouter un niveau
      </button>

      <button className="dz-del" onClick={() => removeItem(b.id)}>🗑️ Supprimer ce bâtiment</button>
    </div>
  );
}

function RecipeForm({ r }: { r: RecipeDef }) {
  const doc = useDesigner((s) => s.doc);
  const update = useDesigner((s) => s.updateRecipe);
  const removeItem = useDesigner((s) => s.removeItem);
  const up = (patch: Partial<RecipeDef>) => update(r.id, { ...r, ...patch });
  return (
    <div className="dz-form">
      <div className="dz-form-head">
        <Field label="Icône"><input className="dz-icon" value={r.icon} onChange={(e) => up({ icon: e.target.value })} /></Field>
        <Field label="Nom"><input value={r.name} onChange={(e) => up({ name: e.target.value })} /></Field>
        <Field label="Id"><input value={r.id} onChange={(e) => up({ id: e.target.value })} /></Field>
      </div>
      <div className="dz-form-head">
        <Field label="Catégorie">
          <select value={r.category} onChange={(e) => up({ category: e.target.value })}>
            {["conso", "potion", "forge", "deco"].map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="PA"><input type="number" min={0} value={r.pa} onChange={(e) => up({ pa: Number(e.target.value) || 0 })} /></Field>
      </div>
      <div className="dz-form-head">
        <Field label="Bâtiment requis">
          <select value={r.building} onChange={(e) => up({ building: e.target.value })}>
            <option value="">— aucun —</option>
            {doc.buildings.map((b) => <option key={b.id} value={b.id}>{b.icon} {b.name}</option>)}
          </select>
        </Field>
        <Field label="Niveau min.">
          <input type="number" min={1} value={r.buildingLevel} onChange={(e) => up({ buildingLevel: Number(e.target.value) || 1 })} />
        </Field>
      </div>
      <label className="dz-check">
        <input type="checkbox" checked={r.field} onChange={(e) => up({ field: e.target.checked })} />
        Réalisable en expédition (hors ville)
      </label>

      <h4>Ingrédients</h4>
      <CostList items={r.ingredients} addLabel="Ingrédient" onChange={(ingredients) => up({ ingredients })} />

      <h4>Produit</h4>
      <div className="dz-form-head">
        <Field label="Type">
          <select value={r.output.type} onChange={(e) => up({ output: { ...r.output, type: e.target.value } })}>
            {["aliment", "eau", "consommable", "arme", "objet", "deco"].map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Nom"><input value={r.output.name} onChange={(e) => up({ output: { ...r.output, name: e.target.value } })} /></Field>
        <Field label="Qté"><input type="number" min={1} value={r.output.qty} onChange={(e) => up({ output: { ...r.output, qty: Number(e.target.value) || 1 } })} /></Field>
      </div>
      <Field label="Effets (à l'utilisation / équipé)">
        <textarea value={r.effects} onChange={(e) => up({ effects: e.target.value })} />
      </Field>

      <button className="dz-del" onClick={() => removeItem(r.id)}>🗑️ Supprimer cette recette</button>
    </div>
  );
}

const STAT_KEYS = ["force", "dexterite", "agilite", "endurance", "athletisme", "precision"] as const;

function ClassForm({ c }: { c: HeroClassDef }) {
  const doc = useDesigner((s) => s.doc);
  const update = useDesigner((s) => s.updateClass);
  const removeItem = useDesigner((s) => s.removeItem);
  const up = (patch: Partial<HeroClassDef>) => update(c.id, { ...c, ...patch });
  const charAssets = useMemo(
    () => ALL_ASSETS.filter((a) => ["characters", "heroes", "npc"].includes(a.cat)),
    [],
  );
  const urlOf = (file: string) => charAssets.find((a) => a.file === file)?.url ?? `/assets/characters/${file}.png`;
  const upSkill = (i: number, patch: Partial<SkillDef>) =>
    up({ skills: c.skills.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  return (
    <div className="dz-form">
      <div className="dz-form-head">
        <Field label="Nom"><input value={c.name} onChange={(e) => up({ name: e.target.value })} /></Field>
        <Field label="Id"><input value={c.id} onChange={(e) => up({ id: e.target.value })} /></Field>
      </div>
      <div className="dz-form-head">
        <Field label="Palier">
          <select value={c.tier} onChange={(e) => up({ tier: Number(e.target.value) })}>
            <option value={1}>1 — intermédiaire</option>
            <option value={2}>2 — avancée</option>
          </select>
        </Field>
        <Field label="Jour requis"><input type="number" min={1} value={c.day} onChange={(e) => up({ day: Number(e.target.value) || 1 })} /></Field>
        <Field label="Bonus PA"><input type="number" min={0} value={c.paBonus} onChange={(e) => up({ paBonus: Number(e.target.value) || 0 })} /></Field>
      </div>
      <Field label="Rôle"><textarea value={c.role} onChange={(e) => up({ role: e.target.value })} /></Field>

      <h4>Prérequis (classes parentes)</h4>
      <div className="dz-req-classes">
        {doc.classes.filter((o) => o.id !== c.id).map((o) => (
          <label key={o.id} className="dz-check">
            <input
              type="checkbox"
              checked={c.requires.includes(o.id)}
              onChange={(e) =>
                up({ requires: e.target.checked ? [...c.requires, o.id] : c.requires.filter((x) => x !== o.id) })
              }
            />
            {o.name}
          </label>
        ))}
      </div>

      <h4>Bonus de stats</h4>
      <div className="dz-stats">
        {STAT_KEYS.map((k) => (
          <Field key={k} label={k}>
            <input type="number" value={c.bonuses[k]} onChange={(e) => up({ bonuses: { ...c.bonuses, [k]: Number(e.target.value) || 0 } })} />
          </Field>
        ))}
      </div>

      <h4>Pouvoirs</h4>
      {c.skills.map((s, i) => (
        <div className="dz-level" key={i}>
          <div className="dz-level-head">
            <input className="dz-skill-name" value={s.name} onChange={(e) => upSkill(i, { name: e.target.value })} />
            <button className="dz-x" onClick={() => up({ skills: c.skills.filter((_, j) => j !== i) })}>✕</button>
          </div>
          <div className="dz-form-head">
            <Field label="Portée">
              <select value={s.scope} onChange={(e) => upSkill(i, { scope: e.target.value as "map" | "iso" })}>
                <option value="map">🗺️ map (monde)</option>
                <option value="iso">⚔️ iso (combat)</option>
              </select>
            </Field>
            <Field label="PA (0 = passif)">
              <input type="number" min={0} value={s.pa} onChange={(e) => upSkill(i, { pa: Number(e.target.value) || 0 })} />
            </Field>
          </div>
          <Field label="Description"><input value={s.desc} onChange={(e) => upSkill(i, { desc: e.target.value })} /></Field>
          <Field label="Effets (mécanique)"><input value={s.effects} onChange={(e) => upSkill(i, { effects: e.target.value })} /></Field>
          {s.scope === "iso" && (
            <div className="dz-grids">
              <GridShapeEditor
                label="Ciblage (depuis le héros)"
                mode="target"
                cells={s.targets ?? []}
                onChange={(targets) => upSkill(i, { targets })}
              />
              <GridShapeEditor
                label="Zone de dégâts (autour de la case touchée)"
                mode="damage"
                cells={s.damage ?? []}
                onChange={(damage) => upSkill(i, { damage })}
              />
            </div>
          )}
        </div>
      ))}
      <button
        className="dz-add"
        onClick={() =>
          up({ skills: [...c.skills, { name: "Nouveau pouvoir", scope: "iso", pa: 1, desc: "", effects: "", targets: manhattanCells(1, 1), damage: [] }] })
        }
      >
        ＋ Ajouter un pouvoir
      </button>

      <h4>Apparence</h4>
      <div className="dz-appearance">
        {(["map", "icon"] as const).map((slot) => (
          <div key={slot} className="dz-app-slot">
            <span className="dz-app-label">{slot === "map" ? "Sur la carte" : "Icône (fiche perso)"}</span>
            <img src={urlOf(c.appearance[slot])} alt="" />
            <select
              value={c.appearance[slot]}
              onChange={(e) => up({ appearance: { ...c.appearance, [slot]: e.target.value } })}
            >
              {charAssets.map((a) => (
                <option key={`${a.cat}/${a.file}`} value={a.file}>{a.label} ({a.cat})</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <button className="dz-del" onClick={() => removeItem(c.id)}>🗑️ Supprimer cette classe</button>
    </div>
  );
}

function BiomeForm({ r }: { r: BiomeResourceDef }) {
  const update = useDesigner((s) => s.updateResource);
  const removeItem = useDesigner((s) => s.removeItem);
  const up = (patch: Partial<BiomeResourceDef>) => update(r.id, { ...r, ...patch });
  return (
    <div className="dz-form">
      <div className="dz-form-head">
        <Field label="Icône"><input className="dz-icon" value={r.icon} onChange={(e) => up({ icon: e.target.value })} /></Field>
        <Field label="Nom"><input value={r.name} onChange={(e) => up({ name: e.target.value })} /></Field>
        <Field label="Id"><input value={r.id} onChange={(e) => up({ id: e.target.value })} /></Field>
      </div>
      <label className="dz-check">
        <input type="checkbox" checked={r.walkable} onChange={(e) => up({ walkable: e.target.checked })} />
        Praticable (les héros peuvent y marcher)
      </label>
      <label className="dz-check">
        <input type="checkbox" checked={r.searchable} onChange={(e) => up({ searchable: e.target.checked })} />
        Fouillable (action Search)
      </label>
      <h4>Richesse à la génération</h4>
      <div className="dz-form-head">
        <Field label="Fouilles min">
          <input type="number" min={0} value={r.resourcesMin} onChange={(e) => up({ resourcesMin: Number(e.target.value) || 0 })} />
        </Field>
        <Field label="Fouilles max">
          <input type="number" min={0} value={r.resourcesMax} onChange={(e) => up({ resourcesMax: Number(e.target.value) || 0 })} />
        </Field>
      </div>
      <h4>Table de fouille (drops)</h4>
      <DropsList items={r.drops} addLabel="Drop" onChange={(drops) => up({ drops })} />
      <Field label="Notes"><textarea value={r.notes} onChange={(e) => up({ notes: e.target.value })} /></Field>
      <button className="dz-del" onClick={() => removeItem(r.id)}>🗑️ Supprimer ce biome</button>
    </div>
  );
}

function MonsterForm({ m }: { m: MonsterDef }) {
  const doc = useDesigner((s) => s.doc);
  const update = useDesigner((s) => s.updateMonster);
  const removeItem = useDesigner((s) => s.removeItem);
  const up = (patch: Partial<MonsterDef>) => update(m.id, { ...m, ...patch });
  const mobAssets = useMemo(() => ALL_ASSETS.filter((a) => a.cat === "monsters"), []);
  const url = mobAssets.find((a) => a.file === m.appearance)?.url ?? `/assets/monsters/${m.appearance}.png`;
  return (
    <div className="dz-form">
      <div className="dz-form-head">
        <Field label="Icône"><input className="dz-icon" value={m.icon} onChange={(e) => up({ icon: e.target.value })} /></Field>
        <Field label="Espèce (nom)"><input value={m.name} onChange={(e) => up({ name: e.target.value })} /></Field>
        <Field label="Id"><input value={m.id} onChange={(e) => up({ id: e.target.value })} /></Field>
      </div>
      <div className="dz-form-head">
        <Field label="PV"><input type="number" min={1} value={m.hp} onChange={(e) => up({ hp: Number(e.target.value) || 1 })} /></Field>
        <Field label="Pack min"><input type="number" min={1} value={m.packMin} onChange={(e) => up({ packMin: Number(e.target.value) || 1 })} /></Field>
        <Field label="Pack max"><input type="number" min={1} value={m.packMax} onChange={(e) => up({ packMax: Number(e.target.value) || 1 })} /></Field>
      </div>
      <h4>Stats</h4>
      <div className="dz-stats">
        {STAT_KEYS.map((k) => (
          <Field key={k} label={k}>
            <input type="number" value={m.stats[k]} onChange={(e) => up({ stats: { ...m.stats, [k]: Number(e.target.value) || 0 } })} />
          </Field>
        ))}
      </div>
      <h4>Terrains d'apparition</h4>
      <div className="dz-req-classes">
        {doc.resources.map((b) => (
          <label key={b.id} className="dz-check">
            <input
              type="checkbox"
              checked={m.biomes.includes(b.id)}
              onChange={(e) => up({ biomes: e.target.checked ? [...m.biomes, b.id] : m.biomes.filter((x) => x !== b.id) })}
            />
            {b.icon} {b.name}
          </label>
        ))}
      </div>
      <h4>Attaques (combat iso)</h4>
      {m.attacks.map((a, i) => {
        const upAtk = (patch: Partial<AttackDef>) =>
          up({ attacks: m.attacks.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
        return (
          <div className="dz-level" key={i}>
            <div className="dz-level-head">
              <input className="dz-skill-name" value={a.name} onChange={(e) => upAtk({ name: e.target.value })} />
              <button className="dz-x" onClick={() => up({ attacks: m.attacks.filter((_, j) => j !== i) })}>✕</button>
            </div>
            <div className="dz-form-head">
              <Field label="Type">
                <select value={a.kind} onChange={(e) => upAtk({ kind: e.target.value as "base" | "special" })}>
                  <option value="base">attaque de base</option>
                  <option value="special">compétence spéciale</option>
                </select>
              </Field>
              <Field label="PA"><input type="number" min={0} value={a.pa} onChange={(e) => upAtk({ pa: Number(e.target.value) || 0 })} /></Field>
            </div>
            <Field label="Description"><input value={a.desc} onChange={(e) => upAtk({ desc: e.target.value })} /></Field>
            <Field label="Effets (dégâts, états…)"><input value={a.effects} onChange={(e) => upAtk({ effects: e.target.value })} /></Field>
            <div className="dz-grids">
              <GridShapeEditor label="Ciblage (depuis l'attaquant)" mode="target" cells={a.targets} onChange={(targets) => upAtk({ targets })} />
              <GridShapeEditor label="Zone de dégâts (autour de la case touchée)" mode="damage" cells={a.damage} onChange={(damage) => upAtk({ damage })} />
            </div>
          </div>
        );
      })}
      <button
        className="dz-add"
        onClick={() =>
          up({
            attacks: [
              ...m.attacks,
              { name: "Nouvelle attaque", kind: m.attacks.length === 0 ? "base" : "special", pa: 1, desc: "", effects: "", targets: manhattanCells(1, 1), damage: [] },
            ],
          })
        }
      >
        ＋ Ajouter une attaque
      </button>
      <h4>Loot (pack vaincu)</h4>
      <DropsList items={m.drops} addLabel="Loot" onChange={(drops) => up({ drops })} />
      <h4>Apparence</h4>
      <div className="dz-appearance">
        <div className="dz-app-slot">
          <span className="dz-app-label">Sprite (carte & combat)</span>
          <img src={url} alt="" />
          <select value={m.appearance} onChange={(e) => up({ appearance: e.target.value })}>
            {mobAssets.map((a) => (
              <option key={a.file} value={a.file}>{a.label}</option>
            ))}
          </select>
        </div>
      </div>
      <Field label="Notes"><textarea value={m.notes} onChange={(e) => up({ notes: e.target.value })} /></Field>
      <button className="dz-del" onClick={() => removeItem(m.id)}>🗑️ Supprimer ce monstre</button>
    </div>
  );
}

// --- export / import ------------------------------------------------------------

function download(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

// --- screen -----------------------------------------------------------------------

export function DesignerScreen() {
  const setScreen = useStore((s) => s.setScreen);
  const { doc, tab, selId, setTab, select, addItem, importDoc, resetSeed } = useDesigner();
  const fileRef = useRef<HTMLInputElement>(null);

  const sel = selId[tab];
  const list: { id: string; icon: string; name: string; sub: string }[] =
    tab === "buildings"
      ? doc.buildings.map((b) => ({ id: b.id, icon: b.icon, name: b.name, sub: b.startsBuilt ? "de départ" : "chantier" }))
      : tab === "recipes"
      ? doc.recipes.map((r) => ({ id: r.id, icon: r.icon, name: r.name, sub: r.building ? `${r.building} · ${r.pa} PA` : `${r.pa} PA` }))
      : tab === "classes"
      ? doc.classes.map((c) => ({ id: c.id, icon: c.tier === 1 ? "🟢" : "🟣", name: c.name, sub: `palier ${c.tier} · J${c.day}` }))
      : tab === "resources"
      ? doc.resources.map((r) => ({ id: r.id, icon: r.icon, name: r.name, sub: r.searchable ? `${r.drops.length} drops · ${r.resourcesMin}–${r.resourcesMax} fouilles` : "non fouillable" }))
      : tab === "monsters"
      ? doc.monsters.map((m) => ({ id: m.id, icon: m.icon, name: m.name, sub: `${m.hp} PV · pack ${m.packMin}–${m.packMax}` }))
      : [];

  const treeNodes: TreeNode[] =
    tab === "buildings"
      ? doc.buildings.map((b) => ({
          id: b.id,
          icon: b.icon,
          name: b.name,
          sub: `${b.levels[0]?.pa ?? "?"} PA · ${b.levels[0]?.materials.map((m) => `${m.qty} ${m.name}`).join(", ") || "—"}`,
          parents: b.requires.map((r) => ({ id: r.building, label: `niv. ${r.level}` })),
        }))
      : doc.classes.map((c) => ({
          id: c.id,
          icon: c.tier === 1 ? "🟢" : "🟣",
          name: c.name,
          sub: `J${c.day} · +${c.paBonus} PA`,
          parents: c.requires.map((id) => ({ id })),
        }));

  const onImport = async (f: File) => {
    try {
      const parsed = JSON.parse(await f.text());
      const merged: DesignDoc = {
        ...doc,
        ...(Array.isArray(parsed.buildings) && { buildings: parsed.buildings }),
        ...(Array.isArray(parsed.recipes) && { recipes: parsed.recipes }),
        ...(Array.isArray(parsed.classes) && { classes: parsed.classes }),
        ...(Array.isArray(parsed.resources) && { resources: parsed.resources }),
        ...(Array.isArray(parsed.monsters) && { monsters: parsed.monsters }),
        version: parsed.version ?? doc.version,
      };
      importDoc(merged);
    } catch {
      alert("JSON invalide");
    }
  };

  const selBuilding = tab === "buildings" ? doc.buildings.find((b) => b.id === sel) : undefined;
  const selRecipe = tab === "recipes" ? doc.recipes.find((r) => r.id === sel) : undefined;
  const selClass = tab === "classes" ? doc.classes.find((c) => c.id === sel) : undefined;
  const selResource = tab === "resources" ? doc.resources.find((r) => r.id === sel) : undefined;
  const selMonster = tab === "monsters" ? doc.monsters.find((m) => m.id === sel) : undefined;
  const dropsSummary = (drops: ResourceDrop[]) =>
    drops.map((d) => `${d.qty > 1 ? `${d.qty} ` : ""}${d.name}${d.weight !== 1 ? ` (×${d.weight})` : ""}`).join(", ") || "—";

  return (
    <div className="dz-screen">
      <div className="dz-toolbar">
        <button className="dz-btn" onClick={() => setScreen("title")}>← Menu</button>
        <span className="dz-title">🧬 Studio de données</span>
        <div className="dz-tabs">
          {TABS.map((t) => (
            <button key={t.id} className={`dz-btn tab ${tab === t.id ? "on" : ""}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <span className="dz-spacer" />
        {tab !== "mapgen" && (
          <button className="dz-btn" onClick={addItem}>＋ Nouveau</button>
        )}
        <button
          className="dz-btn"
          title="Exporter uniquement l'onglet courant"
          onClick={() => download(`echoterra-${tab}-${stamp()}.json`, { version: doc.version, [tab]: doc[tab] })}
        >
          📤 Exporter l'onglet
        </button>
        <button className="dz-btn primary" onClick={() => download(`echoterra-design-${stamp()}.json`, doc)}>
          💾 Exporter tout
        </button>
        <button className="dz-btn" onClick={() => fileRef.current?.click()}>📥 Importer</button>
        <button
          className="dz-btn danger"
          onClick={() => confirm("Réinitialiser avec les données actuelles du jeu ? (le travail non exporté est perdu)") && resetSeed()}
        >
          ♻️ Reset
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onImport(f);
            e.target.value = "";
          }}
        />
      </div>

      <div className="dz-body">
        {tab === "mapgen" ? (
          <MapGenPane />
        ) : (
          <>
        <div className="dz-list">
          {list.map((it) => (
            <button key={it.id} className={`dz-item ${it.id === sel ? "sel" : ""}`} onClick={() => select(it.id)}>
              <span className="dz-item-ic">{it.icon}</span>
              <span className="dz-item-tx">
                <b>{it.name}</b>
                <i>{it.sub}</i>
              </span>
            </button>
          ))}
        </div>

        {tab === "resources" ? (
          <div className="dz-tree dz-recipe-groups">
            {doc.resources.map((r) => (
              <button key={r.id} className={`dz-node recipe ${r.id === sel ? "sel" : ""}`} onClick={() => select(r.id)}>
                <span className="dz-node-name">{r.icon} {r.name}</span>
                <span className="dz-node-sub">
                  {r.searchable ? `🔎 ${r.resourcesMin}–${r.resourcesMax} fouilles · ${dropsSummary(r.drops)}` : "non fouillable"}
                  {!r.walkable ? " · ⛔ impraticable" : ""}
                </span>
              </button>
            ))}
          </div>
        ) : tab === "monsters" ? (
          <div className="dz-tree dz-recipe-groups">
            {doc.monsters.map((m) => (
              <button key={m.id} className={`dz-node recipe monster ${m.id === sel ? "sel" : ""}`} onClick={() => select(m.id)}>
                <img className="dz-mob-img" src={`/assets/monsters/${m.appearance}.png`} alt="" />
                <span className="dz-node-name">{m.icon} {m.name}</span>
                <span className="dz-node-sub">
                  {m.hp} PV · pack {m.packMin}–{m.packMax} · {m.biomes.length ? m.biomes.join(", ") : "aucun terrain"}
                </span>
                <span className="dz-node-sub">
                  🗡 {m.attacks.map((a) => a.name).join(", ") || "aucune attaque"} · 🎁 {dropsSummary(m.drops)}
                </span>
              </button>
            ))}
          </div>
        ) : tab === "recipes" ? (
          <div className="dz-tree dz-recipe-groups">
            {[...doc.buildings.map((b) => ({ id: b.id, label: `${b.icon} ${b.name}` })), { id: "", label: "🎒 Sans bâtiment" }].map(
              (g) => {
                const rs = doc.recipes.filter((r) => r.building === g.id);
                if (rs.length === 0) return null;
                return (
                  <div className="dz-group" key={g.id || "none"}>
                    <div className="dz-group-title">{g.label}</div>
                    {rs.map((r) => (
                      <button key={r.id} className={`dz-node recipe ${r.id === sel ? "sel" : ""}`} onClick={() => select(r.id)}>
                        <span className="dz-node-name">{r.icon} {r.name}</span>
                        <span className="dz-node-sub">
                          {r.pa} PA · {r.ingredients.map((m) => `${m.qty} ${m.name}`).join(", ") || "—"}
                          {r.field ? " · 🏕️ field" : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                );
              },
            )}
          </div>
        ) : (
          <TreePane nodes={treeNodes} selId={sel} onSelect={select} rootLabel={tab === "classes" ? "🙂 Sans classe" : undefined} />
        )}

        <div className="dz-inspector">
          {selBuilding && <BuildingForm b={selBuilding} />}
          {selRecipe && <RecipeForm r={selRecipe} />}
          {selClass && <ClassForm c={selClass} />}
          {selResource && <BiomeForm r={selResource} />}
          {selMonster && <MonsterForm m={selMonster} />}
          {!selBuilding && !selRecipe && !selClass && !selResource && !selMonster && (
            <div className="dz-empty">
              Sélectionne un élément (liste ou arbre) pour l'éditer,
              <br />ou crée-en un avec ＋ Nouveau.
              <br />
              <br />💾 Exporte le JSON et donne-le moi pour implémentation.
            </div>
          )}
        </div>
          </>
        )}
      </div>
    </div>
  );
}
