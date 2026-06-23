import { useEditorStore } from "./editorStore";
import { assetUrlFor } from "./assetIndex";

// Floating panel to transform the currently selected object: resize, rotate, flip,
// raise (height), nudge position, reset, delete. Shown only when an object is selected.
export function Inspector() {
  const selection = useEditorStore((s) => s.selection);
  // Subscribe to doc so the controls reflect live edits (drag-move etc.).
  const doc = useEditorStore((s) => s.doc);
  const { updateSelected, deleteSelected, nudgeSelected, beginStroke, openCropPlacement } =
    useEditorStore.getState();

  if (!selection) return null;
  const layer = doc.layers.find((l) => l.id === selection.layerId);
  const pl = layer?.placements.find((p) => p.id === selection.id);
  if (!pl) return null;

  const url = assetUrlFor(pl.asset.cat, pl.asset.file);
  const scale = pl.scale ?? 1;
  const rot = pl.rot ?? 0;
  const lift = pl.lift ?? 0;

  return (
    <div className="ed-inspector">
      <div className="ed-panel-title">
        Objet
        <button className="ed-mini" title="Désélectionner" onClick={() => useEditorStore.getState().selectObject(null)}>
          ✕
        </button>
      </div>
      <div className="ed-insp-head">
        {url && <img src={url} alt="" />}
        <div>
          <div className="ed-insp-name">{pl.asset.file}</div>
          <div className="ed-muted-sm">
            ({pl.cx},{pl.cy}) · {layer?.name}
          </div>
        </div>
      </div>

      <label className="ed-field">
        <span>Taille · {scale.toFixed(2)}×</span>
        <input
          type="range"
          min={0.2}
          max={3}
          step={0.05}
          value={scale}
          onPointerDown={() => beginStroke()}
          onChange={(e) => updateSelected({ scale: Number(e.target.value) }, false)}
        />
      </label>

      <label className="ed-field">
        <span>Rotation · {rot}°</span>
        <input
          type="range"
          min={-180}
          max={180}
          step={1}
          value={rot}
          onPointerDown={() => beginStroke()}
          onChange={(e) => updateSelected({ rot: Number(e.target.value) }, false)}
        />
      </label>
      <div className="ed-row">
        <button className="ed-btn sm" onClick={() => updateSelected({ rot: rot - 90 })}>
          ⟲ 90°
        </button>
        <button className="ed-btn sm" onClick={() => updateSelected({ rot: rot + 90 })}>
          ⟳ 90°
        </button>
        <button
          className={`ed-btn sm${pl.flipX ? " primary" : ""}`}
          onClick={() => updateSelected({ flipX: !pl.flipX })}
        >
          ⇋ Miroir
        </button>
      </div>

      <div className="ed-field">
        <span>Hauteur · {lift}</span>
        <div className="ed-row">
          <button className="ed-btn sm" onClick={() => updateSelected({ lift: Math.max(0, lift - 1) })}>
            −
          </button>
          <button className="ed-btn sm" onClick={() => updateSelected({ lift: lift + 1 })}>
            ＋
          </button>
          <span className="ed-muted-sm">élève l'objet au-dessus du sol</span>
        </div>
      </div>

      <div className="ed-field">
        <span>Position fine</span>
        <div className="ed-nudge">
          <button className="ed-mini" onClick={() => { beginStroke(); nudgeSelected(0, -2); }}>↑</button>
          <div className="ed-nudge-row">
            <button className="ed-mini" onClick={() => { beginStroke(); nudgeSelected(-2, 0); }}>←</button>
            <button className="ed-mini" onClick={() => { beginStroke(); nudgeSelected(2, 0); }}>→</button>
          </div>
          <button className="ed-mini" onClick={() => { beginStroke(); nudgeSelected(0, 2); }}>↓</button>
        </div>
      </div>

      <div className="ed-field">
        <span>Zone source (crop)</span>
        <div className="ed-row" style={{ padding: 0 }}>
          <button className={`ed-btn sm${pl.crop ? " primary" : ""}`} onClick={() => openCropPlacement()}>
            ✂ Recadrer…
          </button>
          {pl.crop && (
            <button className="ed-btn sm" onClick={() => updateSelected({ crop: undefined })}>
              Image entière
            </button>
          )}
        </div>
      </div>

      <div className="ed-row">
        <button
          className="ed-btn sm"
          onClick={() => updateSelected({ scale: 1, rot: 0, flipX: false, lift: 0, dx: 0, dy: 0, crop: undefined })}
        >
          Réinitialiser
        </button>
        <button className="ed-btn sm danger" onClick={() => deleteSelected()}>
          🗑 Supprimer
        </button>
      </div>
    </div>
  );
}
