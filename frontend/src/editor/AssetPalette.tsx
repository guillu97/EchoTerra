import { useMemo, useState } from "react";
import { groupedAssets } from "./assetIndex";
import { useEditorStore } from "./editorStore";
import { getAssetCrop } from "./assetCrops";

// Browse + select the asset to paint. Categories along the top, a scrollable thumbnail
// grid below, with a search box.
export function AssetPalette() {
  const groups = useMemo(() => groupedAssets(), []);
  const [cat, setCat] = useState(groups[0]?.cat ?? "");
  const [q, setQ] = useState("");
  const selected = useEditorStore((s) => s.selectedAsset);
  const selectAsset = useEditorStore((s) => s.selectAsset);
  const autoCropAssets = useEditorStore((s) => s.autoCropAssets);
  useEditorStore((s) => s.assetCropRev); // refresh crop badges

  const active = groups.find((g) => g.cat === cat) ?? groups[0];
  const entries = useMemo(() => {
    if (!active) return [];
    const needle = q.trim().toLowerCase();
    return needle ? active.entries.filter((e) => e.file.toLowerCase().includes(needle)) : active.entries;
  }, [active, q]);

  return (
    <div className="ed-palette">
      <div className="ed-panel-title">
        Assets
        <button
          className="ed-mini"
          title={`Auto-crop tous les assets de « ${active?.label ?? ""} »`}
          onClick={() => active && autoCropAssets(active.entries.map((e) => ({ cat: e.cat, file: e.file })))}
        >
          ⤢
        </button>
      </div>
      <div className="ed-cat-tabs">
        {groups.map((g) => (
          <button
            key={g.cat}
            className={`ed-cat-tab${g.cat === cat ? " active" : ""}`}
            onClick={() => setCat(g.cat)}
          >
            {g.label}
          </button>
        ))}
      </div>
      <input
        className="ed-search"
        placeholder="Rechercher…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="ed-asset-grid">
        {entries.map((e) => {
          const sel = selected && selected.cat === e.cat && selected.file === e.file;
          return (
            <button
              key={`${e.cat}/${e.file}`}
              className={`ed-asset${sel ? " active" : ""}`}
              title={e.file}
              onClick={() => selectAsset({ cat: e.cat, file: e.file })}
            >
              {getAssetCrop(e.cat, e.file) && <i className="ed-crop-badge" title="Source recadrée">✂</i>}
              <img src={e.url} alt={e.label} loading="lazy" />
              <span>{e.label}</span>
            </button>
          );
        })}
        {entries.length === 0 && <div className="ed-empty">Aucun asset</div>}
      </div>
    </div>
  );
}
