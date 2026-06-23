import { useRef, useState } from "react";
import { useStore } from "../store";
import { MAX_HEIGHT, useEditorStore } from "./editorStore";
import type { Tool } from "./editorStore";
import { exportJson, exportPng, importJson } from "./editorExport";

const TOOLS: { id: Tool; icon: string; label: string }[] = [
  { id: "paint", icon: "🖌", label: "Poser (B)" },
  { id: "select", icon: "➤", label: "Sélectionner / déplacer un objet (V)" },
  { id: "erase", icon: "🧽", label: "Effacer (E)" },
  { id: "raise", icon: "⬆", label: "Monter (+1 hauteur) (R)" },
  { id: "lower", icon: "⬇", label: "Descendre (-1 hauteur) (F)" },
  { id: "marquee", icon: "⬚", label: "Sélectionner une zone (preset) (M)" },
  { id: "stamp", icon: "🧷", label: "Tampon : poser le preset armé (T)" },
  { id: "pan", icon: "✋", label: "Déplacer la vue (Espace)" },
];

export function Toolbar() {
  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const doc = useEditorStore((s) => s.doc);
  const gridTile = useEditorStore((s) => s.gridTile);
  const level = useEditorStore((s) => s.level);
  const showLevels = useEditorStore((s) => s.showLevels);
  const levelFocus = useEditorStore((s) => s.levelFocus);
  const fillColumn = useEditorStore((s) => s.fillColumn);
  const { setGrid, newDoc, loadDoc, undo, redo, setGridTile, autoResizeAllIso, setLevel, setShowLevels, setLevelFocus, setFillColumn } =
    useEditorStore.getState();
  const [resizing, setResizing] = useState(false);
  const setScreen = useStore((s) => s.setScreen);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const onImport = async (file: File) => {
    try {
      loadDoc(await importJson(file));
    } catch (err) {
      alert(`Import impossible : ${(err as Error).message}`);
    }
  };

  return (
    <div className="ed-toolbar">
      <button className="ed-back" onClick={() => setScreen("title")} title="Retour au menu">
        ←
      </button>
      <span className="ed-brand">🗺️ Éditeur</span>

      <div className="ed-tools">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`ed-tool${tool === t.id ? " active" : ""}`}
            title={t.label}
            onClick={() => setTool(t.id)}
          >
            {t.icon}
          </button>
        ))}
      </div>

      <div className="ed-group">
        <button className="ed-tool" title="Annuler (Ctrl+Z)" onClick={() => undo()}>
          ↶
        </button>
        <button className="ed-tool" title="Rétablir (Ctrl+Y)" onClick={() => redo()}>
          ↷
        </button>
      </div>

      <div className="ed-group ed-grid-size">
        <label>Grille</label>
        <input
          type="number"
          min={1}
          max={64}
          value={doc.gridW}
          onChange={(e) => setGrid(Number(e.target.value), doc.gridH)}
        />
        ×
        <input
          type="number"
          min={1}
          max={64}
          value={doc.gridH}
          onChange={(e) => setGrid(doc.gridW, Number(e.target.value))}
        />
      </div>

      <div className="ed-group ed-grid-size">
        <label title="Taille d'un bloc iso (px) — liée à la grille">Bloc</label>
        <input
          type="number"
          min={16}
          max={256}
          step={2}
          value={gridTile}
          onChange={(e) => setGridTile(Number(e.target.value))}
        />
        <button
          className="ed-btn"
          disabled={resizing}
          title="Auto-ajuster : recadre toutes les tuiles iso pour qu'elles fassent toutes la taille du bloc"
          onClick={async () => {
            setResizing(true);
            try {
              await autoResizeAllIso();
            } finally {
              setResizing(false);
            }
          }}
        >
          {resizing ? "…" : "⤢ Auto-ajuster iso"}
        </button>
      </div>

      <div className="ed-group ed-grid-size">
        <label title="Niveau d'élévation où la pose de sol place les blocs ([ et ])">Niveau</label>
        <button className="ed-tool" title="Niveau −1 ( [ )" onClick={() => setLevel(level - 1)}>
          −
        </button>
        <input
          type="number"
          min={0}
          max={MAX_HEIGHT}
          value={level}
          onChange={(e) => setLevel(Number(e.target.value))}
        />
        <button className="ed-tool" title="Niveau +1 ( ] )" onClick={() => setLevel(level + 1)}>
          ＋
        </button>
        <button
          className={`ed-btn${showLevels ? " active" : ""}`}
          title="Afficher le numéro de hauteur sur chaque bloc"
          onClick={() => setShowLevels(!showLevels)}
        >
          👁 Niveaux
        </button>
        <button
          className={`ed-btn${levelFocus ? " active" : ""}`}
          title="Focus : atténue les blocs des autres niveaux"
          onClick={() => setLevelFocus(!levelFocus)}
        >
          🔍 Focus
        </button>
        <button
          className={`ed-btn${fillColumn ? " active" : ""}`}
          title="Colonne pleine : un clic remplit les niveaux 0 → actif d'un coup"
          onClick={() => setFillColumn(!fillColumn)}
        >
          🏛 Colonne
        </button>
      </div>

      <div className="ed-group ed-actions">
        <button className="ed-btn" onClick={() => newDoc()} title="Nouvelle carte (vide)">
          Nouveau
        </button>
        <button className="ed-btn" onClick={() => fileRef.current?.click()}>
          Charger JSON
        </button>
        <button className="ed-btn" onClick={() => exportJson(doc)}>
          ⬇ JSON
        </button>
        <button
          className="ed-btn primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await exportPng(doc);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "…" : "⬇ PNG"}
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onImport(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
