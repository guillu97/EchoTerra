import { useEffect } from "react";
import { Toolbar } from "./Toolbar";
import { AssetPalette } from "./AssetPalette";
import { EditorCanvas } from "./EditorCanvas";
import { LayersPanel } from "./LayersPanel";
import { Inspector } from "./Inspector";
import { CropModal } from "./CropModal";
import { BrushPanel } from "./BrushPanel";
import { PresetsPanel } from "./PresetsPanel";
import { useEditorStore } from "./editorStore";
import { assetUrlFor } from "./assetIndex";
import { getAssetCrop } from "./assetCrops";
import "./editor.css";

// Full-screen isometric map editor (dev tool). Left: asset palette. Centre: canvas.
// Right: layers. Top: tools + save/load.
export function EditorScreen() {
  const selected = useEditorStore((s) => s.selectedAsset);
  const setTool = useEditorStore((s) => s.setTool);
  const openCropAsset = useEditorStore((s) => s.openCropAsset);
  const autoCropAsset = useEditorStore((s) => s.autoCropAsset);
  useEditorStore((s) => s.assetCropRev); // reflect crop badge in the HUD

  // Single-key tool shortcuts (ignored while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const k = e.key.toLowerCase();
      if (k === "b") setTool("paint");
      else if (k === "v") setTool("select");
      else if (k === "e") setTool("erase");
      else if (k === "r") setTool("raise");
      else if (k === "f") setTool("lower");
      else if (k === "m") setTool("marquee");
      else if (k === "t") setTool("stamp");
      else if (e.key === "[") {
        const s = useEditorStore.getState();
        s.setLevel(s.level - 1);
      } else if (e.key === "]") {
        const s = useEditorStore.getState();
        s.setLevel(s.level + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setTool]);

  const selUrl = selected ? assetUrlFor(selected.cat, selected.file) : undefined;

  return (
    <div className="ed-root">
      <Toolbar />
      <div className="ed-body">
        <div className="ed-left">
          <AssetPalette />
          <BrushPanel />
        </div>
        <div className="ed-stage">
          <EditorCanvas />
          <Inspector />
          <div className="ed-stage-hud">
            {selUrl ? (
              <>
                <img src={selUrl} alt="" />
                <span>{selected!.file}</span>
                <button
                  className="ed-btn sm"
                  style={{ pointerEvents: "auto" }}
                  onClick={() => autoCropAsset(selected!.cat, selected!.file)}
                  title="Auto-crop : détecte le contenu et cadre le bloc automatiquement"
                >
                  ⤢ Auto-crop
                </button>
                <button
                  className={`ed-btn sm${getAssetCrop(selected!.cat, selected!.file) ? " primary" : ""}`}
                  style={{ pointerEvents: "auto" }}
                  onClick={() => openCropAsset(selected!)}
                  title="Recadrer la source de cet asset (s'applique partout)"
                >
                  ✂ Recadrer la source
                </button>
              </>
            ) : (
              <span className="ed-muted">Choisis un asset à gauche, puis pose-le sur la grille</span>
            )}
          </div>
        </div>
        <div className="ed-right">
          <LayersPanel />
          <PresetsPanel />
        </div>
      </div>
      <CropModal />
    </div>
  );
}
