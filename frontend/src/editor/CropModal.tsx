import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "./editorStore";
import { assetUrlFor } from "./assetIndex";
import { detectContentCrop, getAssetCrop } from "./assetCrops";
import type { AssetRef, CropRect } from "./types";

// Pick a sub-rectangle of a source image to render. Two targets:
//   • placement — crops just the selected placed object
//   • asset     — crops the asset's SOURCE everywhere it's used (ground cubes, objects,
//                 palette), to normalize slightly-misframed iso tiles.
export function CropModal() {
  const cropTarget = useEditorStore((s) => s.cropTarget);
  const selection = useEditorStore((s) => s.selection);
  const doc = useEditorStore((s) => s.doc);
  useEditorStore((s) => s.assetCropRev); // re-render when an asset crop changes
  const { closeCrop, updateSelected, setAssetCropFor } = useEditorStore.getState();

  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [rect, setRect] = useState<CropRect | null>(null);

  // Resolve the asset + current crop + how to apply, per target kind.
  let asset: AssetRef | undefined;
  let current: CropRect | undefined;
  let isAsset = false;
  if (cropTarget?.kind === "placement") {
    const layer = doc.layers.find((l) => l.id === selection?.layerId);
    const pl = layer?.placements.find((p) => p.id === selection?.id);
    asset = pl?.asset;
    current = pl?.crop;
  } else if (cropTarget?.kind === "asset") {
    asset = cropTarget.asset;
    current = getAssetCrop(asset.cat, asset.file);
    isAsset = true;
  }

  // Seed the selection box from the current crop whenever the target changes.
  useEffect(() => {
    if (cropTarget && asset) setRect(current ?? { x: 0, y: 0, w: 1, h: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cropTarget, asset?.cat, asset?.file]);

  if (!cropTarget || !asset) return null;
  const url = assetUrlFor(asset.cat, asset.file);
  if (!url) return null;

  const apply = (crop: CropRect | undefined) => {
    if (isAsset) setAssetCropFor(asset!.cat, asset!.file, crop);
    else updateSelected({ crop });
  };

  const frac = (e: React.PointerEvent) => {
    const r = boxRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };
  const onDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = frac(e);
    setRect({ x: drag.current.x, y: drag.current.y, w: 0, h: 0 });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const p = frac(e);
    setRect({
      x: Math.min(drag.current.x, p.x),
      y: Math.min(drag.current.y, p.y),
      w: Math.abs(p.x - drag.current.x),
      h: Math.abs(p.y - drag.current.y),
    });
  };
  const onUp = () => {
    drag.current = null;
  };

  const onApply = () => {
    if (rect && rect.w > 0.02 && rect.h > 0.02) apply(rect);
    closeCrop();
  };
  const onReset = () => {
    apply(undefined);
    closeCrop();
  };

  const pct = (n: number) => `${n * 100}%`;

  return (
    <div className="ed-modal-bg" onClick={() => closeCrop()}>
      <div className="ed-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ed-panel-title">
          {isAsset ? "Recadrer la source — " : "Recadrer l'objet — "}
          {asset.file}
        </div>
        <p className="ed-hint" style={{ borderTop: "none" }}>
          {isAsset
            ? "Glisse pour sélectionner la zone utile : elle reformate cet asset partout (sol, objets, palette)."
            : "Glisse sur l'image pour sélectionner la zone à rendre."}
        </p>
        <div className="ed-crop-stage">
          <div
            ref={boxRef}
            className="ed-crop-box"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
          >
            <img src={url} alt="" draggable={false} />
            {rect && (
              <div
                className="ed-crop-sel"
                style={{ left: pct(rect.x), top: pct(rect.y), width: pct(rect.w), height: pct(rect.h) }}
              />
            )}
          </div>
        </div>
        <div className="ed-row" style={{ justifyContent: "flex-end" }}>
          <button
            className="ed-btn sm"
            title="Détecter automatiquement le contenu (cadre serré)"
            onClick={async () => {
              const c = await detectContentCrop(asset!.cat, asset!.file);
              if (c) setRect(c);
            }}
          >
            ⤢ Auto
          </button>
          <button className="ed-btn sm" onClick={onReset}>
            Image entière
          </button>
          <button className="ed-btn sm" onClick={() => closeCrop()}>
            Annuler
          </button>
          <button className="ed-btn sm primary" onClick={onApply}>
            Appliquer
          </button>
        </div>
      </div>
    </div>
  );
}
