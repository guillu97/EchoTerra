import { useEffect, useRef } from "react";
import { useEditorStore } from "./editorStore";
import { drawMap, project, screenToCellAtLevel, screenToObject } from "./isoRender";

// The drawing surface. Pure canvas2d (no Phaser) so the exact same drawMap() is reused
// by the PNG exporter. Handles pan (space/middle-drag or the Pan tool), wheel zoom and
// painting; all map mutations go through the editor store.
export function EditorCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // View + interaction kept in refs to avoid re-render churn during pan/paint.
  const view = useRef({ ox: 0, oy: 0, zoom: 1 });
  const hover = useRef<{ cx: number; cy: number } | null>(null);
  const painting = useRef(false);
  const panning = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const draggingSel = useRef<{ wx: number; wy: number } | null>(null);
  const marquee = useRef<{ cx: number; cy: number } | null>(null);
  const spaceDown = useRef(false);
  const strokeCells = useRef<Set<string>>(new Set());
  const centered = useRef(false);
  const rafId = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext("2d")!;

    const draw = () => {
      rafId.current = 0;
      const dpr = window.devicePixelRatio || 1;
      const cw = wrap.clientWidth;
      const ch = wrap.clientHeight;
      if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
        canvas.width = Math.round(cw * dpr);
        canvas.height = Math.round(ch * dpr);
        canvas.style.width = `${cw}px`;
        canvas.style.height = `${ch}px`;
      }
      const doc = useEditorStore.getState().doc;

      // First paint: centre the grid in the viewport.
      if (!centered.current && cw > 0) {
        const c = project((doc.gridW - 1) / 2, (doc.gridH - 1) / 2, 0);
        view.current.ox = cw / 2 - c.sx;
        view.current.oy = ch / 2 - c.sy;
        centered.current = true;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      ctx.save();
      ctx.translate(view.current.ox, view.current.oy);
      ctx.scale(view.current.zoom, view.current.zoom);
      const st = useEditorStore.getState();
      const brushTool = st.tool === "paint" || st.tool === "erase" || st.tool === "raise" || st.tool === "lower";
      drawMap(ctx, doc, schedule, {
        grid: true,
        focusLevel: st.level,
        focusDim: st.levelFocus,
        hover: hover.current,
        hoverRadius: brushTool ? st.brush.size : 1,
        showLevels: st.showLevels,
        selected: st.selection,
        region: st.region,
      });
      ctx.restore();
    };

    const schedule = () => {
      if (!rafId.current) rafId.current = requestAnimationFrame(draw);
    };

    // World coords from a pointer event (CSS px).
    const toWorld = (e: PointerEvent | WheelEvent) => {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      return { x: (x - view.current.ox) / view.current.zoom, y: (y - view.current.oy) / view.current.zoom };
    };

    const applyAtPointer = (e: PointerEvent) => {
      const w = toWorld(e);
      const st = useEditorStore.getState();
      const cell = screenToCellAtLevel(w.x, w.y, st.doc, st.level);
      hover.current = cell;
      if (cell) {
        const key = `${cell.cx},${cell.cy}`;
        if (!strokeCells.current.has(key)) {
          strokeCells.current.add(key);
          useEditorStore.getState().applyAt(cell.cx, cell.cy);
        }
      }
      schedule();
    };

    const onPointerDown = (e: PointerEvent) => {
      // Drop DOM focus from any toolbar/palette button so a later Space/Enter (pan, etc.)
      // can't accidentally re-activate it (e.g. toggling Focus while placing buildings).
      (document.activeElement as HTMLElement | null)?.blur();
      canvas.setPointerCapture(e.pointerId);
      const st = useEditorStore.getState();
      const tool = st.tool;
      const wantPan = tool === "pan" || e.button === 1 || spaceDown.current;
      if (wantPan) {
        panning.current = { x: e.clientX, y: e.clientY, ox: view.current.ox, oy: view.current.oy };
        return;
      }
      if (tool === "select") {
        const w = toWorld(e);
        const hit = screenToObject(w.x, w.y, st.doc);
        st.selectObject(hit);
        if (hit) {
          st.beginStroke();
          draggingSel.current = { wx: w.x, wy: w.y };
        }
        schedule();
        return;
      }
      if (tool === "marquee") {
        const w = toWorld(e);
        const cell = screenToCellAtLevel(w.x, w.y, st.doc, st.level);
        if (cell) {
          marquee.current = cell;
          st.setRegion({ x: cell.cx, y: cell.cy, w: 1, h: 1 });
        }
        schedule();
        return;
      }
      if (tool === "stamp") {
        painting.current = true;
        strokeCells.current = new Set();
        st.beginStroke();
        const w = toWorld(e);
        const cell = screenToCellAtLevel(w.x, w.y, st.doc, st.level);
        if (cell) {
          strokeCells.current.add(`${cell.cx},${cell.cy}`);
          st.stampAt(cell.cx, cell.cy);
        }
        schedule();
        return;
      }
      painting.current = true;
      strokeCells.current = new Set();
      st.beginStroke();
      applyAtPointer(e);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (panning.current) {
        view.current.ox = panning.current.ox + (e.clientX - panning.current.x);
        view.current.oy = panning.current.oy + (e.clientY - panning.current.y);
        schedule();
        return;
      }
      if (draggingSel.current) {
        const w = toWorld(e);
        useEditorStore.getState().nudgeSelected(w.x - draggingSel.current.wx, w.y - draggingSel.current.wy);
        draggingSel.current = { wx: w.x, wy: w.y };
        schedule();
        return;
      }
      if (marquee.current) {
        const w = toWorld(e);
        const mst = useEditorStore.getState();
        const cell = screenToCellAtLevel(w.x, w.y, mst.doc, mst.level);
        if (cell) {
          const a = marquee.current;
          useEditorStore.getState().setRegion({
            x: Math.min(a.cx, cell.cx),
            y: Math.min(a.cy, cell.cy),
            w: Math.abs(cell.cx - a.cx) + 1,
            h: Math.abs(cell.cy - a.cy) + 1,
          });
        }
        schedule();
        return;
      }
      if (painting.current) {
        const st = useEditorStore.getState();
        if (st.tool === "stamp") {
          const w = toWorld(e);
          const cell = screenToCellAtLevel(w.x, w.y, st.doc, st.level);
          if (cell) {
            const key = `${cell.cx},${cell.cy}`;
            if (!strokeCells.current.has(key)) {
              strokeCells.current.add(key);
              st.stampAt(cell.cx, cell.cy);
            }
          }
          // Track hover so the stamp origin is visible.
          hover.current = cell;
          schedule();
        } else {
          applyAtPointer(e);
        }
        return;
      }
      // Idle hover preview (only meaningful for cell tools).
      const w = toWorld(e);
      const hst = useEditorStore.getState();
      hover.current = hst.tool === "select" ? null : screenToCellAtLevel(w.x, w.y, hst.doc, hst.level);
      schedule();
    };

    const onPointerUp = (e: PointerEvent) => {
      painting.current = false;
      panning.current = null;
      draggingSel.current = null;
      marquee.current = null;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const before = toWorld(e);
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      view.current.zoom = Math.max(0.25, Math.min(4, view.current.zoom * factor));
      // Keep the point under the cursor fixed while zooming.
      const r = canvas.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      view.current.ox = px - before.x * view.current.zoom;
      view.current.oy = py - before.y * view.current.zoom;
      schedule();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.code === "Space") {
        // Pan modifier — stop the default (page scroll AND activating a focused button).
        e.preventDefault();
        spaceDown.current = true;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && useEditorStore.getState().selection) {
        e.preventDefault();
        useEditorStore.getState().deleteSelected();
      }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        useEditorStore.getState().undo();
      } else if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault();
        useEditorStore.getState().redo();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceDown.current = false;
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    const ro = new ResizeObserver(() => schedule());
    ro.observe(wrap);
    const unsub = useEditorStore.subscribe(() => schedule());
    schedule();

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      ro.disconnect();
      unsub();
      if (rafId.current) cancelAnimationFrame(rafId.current);
    };
  }, []);

  return (
    <div ref={wrapRef} className="ed-canvas-wrap">
      <canvas ref={canvasRef} className="ed-canvas" />
    </div>
  );
}
