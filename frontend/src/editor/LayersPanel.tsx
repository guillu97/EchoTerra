import { useEditorStore } from "./editorStore";

// Layer stack (top of the list = drawn on top). The ground layer (tiles + height) is
// pinned at the bottom and can't be removed/reordered.
export function LayersPanel() {
  const doc = useEditorStore((s) => s.doc);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const { setActiveLayer, toggleLayer, addLayer, removeLayer, renameLayer, moveLayer } =
    useEditorStore.getState();

  // Display top→bottom (reverse of render order).
  const layers = [...doc.layers].reverse();

  return (
    <div className="ed-layers">
      <div className="ed-panel-title">
        Calques
        <button className="ed-mini" title="Ajouter un calque" onClick={() => addLayer()}>
          ＋
        </button>
      </div>
      <div className="ed-layer-list">
        {layers.map((l) => {
          const isGround = l.kind === "ground";
          const count = isGround
            ? doc.cells.reduce((n, c) => n + (c.blocks?.filter(Boolean).length ?? 0), 0)
            : l.placements.length;
          return (
            <div
              key={l.id}
              className={`ed-layer${l.id === activeLayerId ? " active" : ""}`}
              onClick={() => setActiveLayer(l.id)}
            >
              <button
                className="ed-eye"
                title={l.visible ? "Masquer" : "Afficher"}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleLayer(l.id);
                }}
              >
                {l.visible ? "👁" : "🚫"}
              </button>
              <input
                className="ed-layer-name"
                value={l.name}
                onChange={(e) => renameLayer(l.id, e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
              <span className="ed-layer-count">{count}</span>
              {!isGround && (
                <span className="ed-layer-ctrls" onClick={(e) => e.stopPropagation()}>
                  <button className="ed-mini" title="Monter" onClick={() => moveLayer(l.id, 1)}>
                    ▲
                  </button>
                  <button className="ed-mini" title="Descendre" onClick={() => moveLayer(l.id, -1)}>
                    ▼
                  </button>
                  <button className="ed-mini" title="Supprimer" onClick={() => removeLayer(l.id)}>
                    🗑
                  </button>
                </span>
              )}
            </div>
          );
        })}
      </div>
      <p className="ed-hint">
        Le calque <b>Sol</b> reçoit les tuiles iso et la hauteur. Les autres calques
        reçoivent bâtiments / objets / décor.
      </p>
    </div>
  );
}
