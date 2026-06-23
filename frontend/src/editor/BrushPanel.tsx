import { useEditorStore } from "./editorStore";
import { assetUrlFor } from "./assetIndex";

// Brush settings: footprint size, scatter density, randomization (rotation / scale /
// flip / jitter) and a random asset set. A size-1, no-random brush behaves like the
// classic single-cell paint.
export function BrushPanel() {
  const brush = useEditorStore((s) => s.brush);
  const selectedAsset = useEditorStore((s) => s.selectedAsset);
  const { setBrush, addToBrushSet, removeFromBrushSet, clearBrushSet } = useEditorStore.getState();

  return (
    <div className="ed-brush">
      <div className="ed-panel-title">Pinceau</div>
      <div className="ed-brush-body">
        <label className="ed-field">
          <span>Taille · {brush.size}×{brush.size}</span>
          <input
            type="range"
            min={1}
            max={7}
            step={1}
            value={brush.size}
            onChange={(e) => setBrush({ size: Number(e.target.value) })}
          />
        </label>
        {brush.size > 1 && (
          <label className="ed-field">
            <span>Densité · {Math.round(brush.density * 100)}%</span>
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={brush.density}
              onChange={(e) => setBrush({ density: Number(e.target.value) })}
            />
          </label>
        )}

        <div className="ed-brush-sep">Aléatoire (objets)</div>
        <label className="ed-field">
          <span>Rotation · ±{brush.randomRot}°</span>
          <input
            type="range"
            min={0}
            max={180}
            step={5}
            value={brush.randomRot}
            onChange={(e) => setBrush({ randomRot: Number(e.target.value) })}
          />
        </label>
        <label className="ed-field">
          <span>
            Échelle · {brush.scaleMin.toFixed(2)}–{brush.scaleMax.toFixed(2)}×
          </span>
          <div className="ed-row" style={{ padding: 0 }}>
            <input
              type="range"
              min={0.2}
              max={2}
              step={0.05}
              value={brush.scaleMin}
              onChange={(e) => setBrush({ scaleMin: Math.min(Number(e.target.value), brush.scaleMax) })}
            />
            <input
              type="range"
              min={0.2}
              max={2}
              step={0.05}
              value={brush.scaleMax}
              onChange={(e) => setBrush({ scaleMax: Math.max(Number(e.target.value), brush.scaleMin) })}
            />
          </div>
        </label>
        <label className="ed-field ed-check">
          <input
            type="checkbox"
            checked={brush.randomFlip}
            onChange={(e) => setBrush({ randomFlip: e.target.checked })}
          />
          <span>Miroir aléatoire</span>
        </label>
        <label className="ed-field">
          <span>Dispersion · ±{brush.jitter}px</span>
          <input
            type="range"
            min={0}
            max={20}
            step={1}
            value={brush.jitter}
            onChange={(e) => setBrush({ jitter: Number(e.target.value) })}
          />
        </label>

        <div className="ed-brush-sep">
          Set aléatoire ({brush.assetSet.length})
          {brush.assetSet.length > 0 && (
            <button className="ed-mini" title="Vider" onClick={() => clearBrushSet()}>
              ✕
            </button>
          )}
        </div>
        <div className="ed-brush-set">
          {brush.assetSet.map((a, i) => {
            const url = assetUrlFor(a.cat, a.file);
            return (
              <button
                key={`${a.cat}/${a.file}`}
                className="ed-set-item"
                title={`${a.file} — retirer`}
                onClick={() => removeFromBrushSet(i)}
              >
                {url && <img src={url} alt="" />}
              </button>
            );
          })}
        </div>
        <button
          className="ed-btn sm"
          disabled={!selectedAsset}
          onClick={() => selectedAsset && addToBrushSet(selectedAsset)}
        >
          ＋ Ajouter la sélection
        </button>
        {brush.assetSet.length > 0 && (
          <p className="ed-hint" style={{ border: "none", padding: "6px 0 0" }}>
            La pose tire au hasard dans ce set.
          </p>
        )}
      </div>
    </div>
  );
}
