import { useRef, useState } from "react";
import { useEditorStore } from "./editorStore";
import type { Preset } from "./types";

// Capture a marquee region as a reusable preset, then arm it to stamp elsewhere.
// Presets persist in localStorage and can be exported / imported as JSON.
export function PresetsPanel() {
  const region = useEditorStore((s) => s.region);
  const presets = useEditorStore((s) => s.presets);
  const stamp = useEditorStore((s) => s.stamp);
  const tool = useEditorStore((s) => s.tool);
  const { setTool, capturePreset, deletePreset, armStamp, importPresets } = useEditorStore.getState();
  const [name, setName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const onImport = async (f: File) => {
    try {
      const arr = JSON.parse(await f.text());
      if (Array.isArray(arr)) importPresets(arr as Preset[]);
    } catch {
      alert("Fichier de presets invalide");
    }
  };

  const exportAll = () => {
    const blob = new Blob([JSON.stringify(presets, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "echoterra-presets.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  return (
    <div className="ed-presets">
      <div className="ed-panel-title">Presets</div>
      <div className="ed-preset-body">
        <div className="ed-row" style={{ padding: 0 }}>
          <button
            className={`ed-btn sm${tool === "marquee" ? " primary" : ""}`}
            onClick={() => setTool("marquee")}
            title="Sélectionner une zone à capturer"
          >
            ⬚ Sélectionner
          </button>
        </div>
        {region && (
          <div className="ed-capture">
            <span className="ed-muted-sm">
              Zone {region.w}×{region.h}
            </span>
            <div className="ed-row" style={{ padding: 0 }}>
              <input
                className="ed-search"
                style={{ margin: 0, flex: 1 }}
                placeholder="Nom du preset…"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <button
                className="ed-btn sm primary"
                onClick={async () => {
                  await capturePreset(name.trim() || `Preset ${presets.length + 1}`);
                  setName("");
                }}
              >
                Capturer
              </button>
            </div>
          </div>
        )}

        <div className="ed-preset-list">
          {presets.map((p) => (
            <div key={p.id} className={`ed-preset${stamp?.id === p.id ? " active" : ""}`}>
              <button
                className="ed-preset-pick"
                title="Armer ce preset (Tampon)"
                onClick={() => armStamp(stamp?.id === p.id ? null : p)}
              >
                {p.thumb ? <img src={p.thumb} alt="" /> : <div className="ed-preset-noimg">{p.w}×{p.h}</div>}
                <span>{p.name}</span>
              </button>
              <button className="ed-mini" title="Supprimer" onClick={() => deletePreset(p.id)}>
                🗑
              </button>
            </div>
          ))}
          {presets.length === 0 && <div className="ed-empty">Aucun preset</div>}
        </div>

        {stamp && (
          <p className="ed-hint" style={{ border: "none", padding: "6px 0 0" }}>
            🧷 « {stamp.name} » armé — clique sur la grille (outil Tampon) pour le poser.
          </p>
        )}

        <div className="ed-row" style={{ padding: "6px 0 0" }}>
          <button className="ed-btn sm" onClick={() => fileRef.current?.click()}>
            Importer
          </button>
          <button className="ed-btn sm" disabled={!presets.length} onClick={exportAll}>
            Exporter
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
    </div>
  );
}
