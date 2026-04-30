import { useEffect, useRef, useCallback, useState } from 'react';
import { fabric } from 'fabric';
import { useDrawingStore } from '../../stores/useDrawingStore';

const getActiveTool = () => useDrawingStore.getState().activeTool;

/** Eraser stroke is thicker than the pen so it is usable; matches the hollow guide ring diameter. */
function getEraserBrushWidth(penWidth) {
  return Math.max(Math.round(Number(penWidth) * 2.5), 22);
}

/** Semi-transparent preview on the upper canvas while dragging the eraser (stroke removal is applied on mouse up). */
const ERASER_PREVIEW_COLOR = 'rgba(90, 90, 90, 0.4)';

function distancePointToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const ix = x1 + t * dx;
  const iy = y1 + t * dy;
  return Math.hypot(px - ix, py - iy);
}

function pathVertexToCanvas(pathObj, vx, vy) {
  const ox = pathObj.pathOffset?.x || 0;
  const oy = pathObj.pathOffset?.y || 0;
  const local = new fabric.Point(vx - ox, vy - oy);
  return fabric.util.transformPoint(local, pathObj.calcTransformMatrix());
}

function sampleCubic(ax, ay, c1x, c1y, c2x, c2y, bx, by, toCanvas, out, steps = 10) {
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const u3 = u * u * u;
    const u2 = u * u;
    const t2 = t * t;
    const t3 = t2 * t;
    const x = u3 * ax + 3 * u2 * t * c1x + 3 * u * t2 * c2x + t3 * bx;
    const y = u3 * ay + 3 * u2 * t * c1y + 3 * u * t2 * c2y + t3 * by;
    out.push(toCanvas(x, y));
  }
}

function sampleQuad(ax, ay, qx, qy, bx, by, toCanvas, out, steps = 8) {
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const x = u * u * ax + 2 * u * t * qx + t * t * bx;
    const y = u * u * ay + 2 * u * t * qy + t * t * by;
    out.push(toCanvas(x, y));
  }
}

/** Canvas-space points along a fabric.Path (stroke centerline approximation). */
function samplePathStrokePoints(pathObj) {
  const out = [];
  const path = pathObj.path;
  if (!path?.length) return out;

  const tc = (vx, vy) => pathVertexToCanvas(pathObj, vx, vy);

  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;

  const pushUnique = (p) => {
    const last = out[out.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p);
  };

  for (let i = 0; i < path.length; i++) {
    const seg = path[i];
    const cmd = String(seg[0]).toUpperCase();

    switch (cmd) {
      case 'M': {
        x = seg[1];
        y = seg[2];
        sx = x;
        sy = y;
        pushUnique(tc(x, y));
        break;
      }
      case 'L': {
        const nx = seg[1];
        const ny = seg[2];
        pushUnique(tc(nx, ny));
        x = nx;
        y = ny;
        break;
      }
      case 'C': {
        const c1x = seg[1];
        const c1y = seg[2];
        const c2x = seg[3];
        const c2y = seg[4];
        const bx = seg[5];
        const by = seg[6];
        sampleCubic(x, y, c1x, c1y, c2x, c2y, bx, by, tc, out, 10);
        x = bx;
        y = by;
        break;
      }
      case 'Q': {
        const qx = seg[1];
        const qy = seg[2];
        const bx = seg[3];
        const by = seg[4];
        sampleQuad(x, y, qx, qy, bx, by, tc, out, 8);
        x = bx;
        y = by;
        break;
      }
      case 'Z': {
        if (x !== sx || y !== sy) {
          pushUnique(tc(sx, sy));
          x = sx;
          y = sy;
        }
        break;
      }
      default:
        break;
    }
  }

  return out;
}

/** Only freehand pen strokes (`fabric.Path`) are on the canvas. */
function canObjectBeErased(obj) {
  return !!(obj && obj.visible && obj.type === 'path');
}

function collectPathStrokeSamples(pathObj, out, budget = { left: 400 }) {
  if (!pathObj || pathObj.type !== 'path' || budget.left <= 0) return;
  const pts = samplePathStrokePoints(pathObj);
  const step = Math.max(1, Math.ceil(pts.length / 120));
  for (let i = 0; i < pts.length && budget.left > 0; i += step) {
    out.push(pts[i]);
    budget.left--;
  }
}

function minDistanceToEraserStroke(px, py, eraserPts, eraserWidth) {
  const r = eraserWidth / 2;
  if (eraserPts.length === 0) return Infinity;
  if (eraserPts.length === 1) {
    return Math.hypot(px - eraserPts[0].x, py - eraserPts[0].y) - r;
  }
  let minD = Infinity;
  for (let i = 0; i < eraserPts.length - 1; i++) {
    const d = distancePointToSegment(
      px,
      py,
      eraserPts[i].x,
      eraserPts[i].y,
      eraserPts[i + 1].x,
      eraserPts[i + 1].y
    );
    minD = Math.min(minD, d);
  }
  return minD - r;
}

function pathHitByEraser(pathObj, eraserPts, eraserWidth) {
  const samples = [];
  collectPathStrokeSamples(pathObj, samples, { left: 500 });
  if (samples.length === 0) return false;

  const sw = pathObj.strokeWidth || 2;
  const penRadius = sw / 2;
  const epsilon = 3;

  for (const p of samples) {
    if (minDistanceToEraserStroke(p.x, p.y, eraserPts, eraserWidth) <= penRadius + epsilon) {
      return true;
    }
  }
  return false;
}

/** Remove pen paths whose geometry overlaps the eraser stroke. */
function removeStrokesOverlappingEraser(canvas, eraserPoints, eraserWidth) {
  const roots = canvas.getObjects().filter(canObjectBeErased);
  const toRemove = roots.filter((obj) => pathHitByEraser(obj, eraserPoints, eraserWidth));
  toRemove.forEach((obj) => canvas.remove(obj));
}

function patchPencilBrushForStrokeEraser(pencilBrush, isEraserMode) {
  const protoFinalize = fabric.PencilBrush.prototype._finalizeAndAddPath;
  const protoDown = fabric.PencilBrush.prototype.onMouseDown;

  pencilBrush.onMouseDown = function (pointer, options) {
    this.__cvaEraserStroke = !!isEraserMode();
    return protoDown.call(this, pointer, options);
  };

  pencilBrush._finalizeAndAddPath = function () {
    if (!this.__cvaEraserStroke) {
      return protoFinalize.call(this);
    }

    this.canvas.clearContext(this.canvas.contextTop);
    this.oldEnd = undefined;

    if (this.decimate) {
      this._points = this.decimatePoints(this._points, this.decimate);
    }

    if (this._points.length === 0) {
      this._resetShadow();
      this.canvas.requestRenderAll();
      return;
    }

    if (this._points.length < 2) {
      const p = this._points[0];
      removeStrokesOverlappingEraser(this.canvas, [p], this.width);
      this._resetShadow();
      this.canvas.requestRenderAll();
      const plain = this._points.map((q) => ({ x: q.x, y: q.y }));
      this.canvas.fire('eraser:stroke:end', { points: plain, brushWidth: this.width });
      return;
    }

    const pathData = this.convertPointsToSVGPath(this._points);
    if (this._isEmptySVGPath(pathData)) {
      this.canvas.requestRenderAll();
      this._resetShadow();
      return;
    }

    removeStrokesOverlappingEraser(this.canvas, this._points, this.width);
    this._resetShadow();
    this.canvas.requestRenderAll();

    const plain = this._points.map((q) => ({ x: q.x, y: q.y }));
    this.canvas.fire('eraser:stroke:end', { points: plain, brushWidth: this.width });
  };
}

/**
 * Fabric loadFromJSON only shallow-clones the argument; enliven can mutate nested `objects`.
 * Deep snapshots keep undo/redo stacks stable.
 */
function cloneFabricJson(json) {
  return JSON.parse(JSON.stringify(json));
}

/** `width` / `height` = maximum box; after the chart image loads the canvas shrinks to the fitted size (no empty margin). */
export default function ChartCanvas({ 
  imageUrl, 
  onCanvasReady,
  width = 700,
  height = 500 
}) {
  const canvasRef = useRef(null);
  const fabricRef = useRef(null);
  const underlayImgRef = useRef(null);
  const underlayLayoutRef = useRef({ left: 0, top: 0, dw: 0, dh: 0, nw: 0, nh: 0 });
  const historyRef = useRef([]);
  const historyIndexRef = useRef(-1);
  /** Tool at start of current free-draw stroke (fixes any store/event ordering issues). */
  const freeDrawToolRef = useRef('pen');
  
  const [eraserGuide, setEraserGuide] = useState(null);
  /** Canvas + stack size after fitting chart to maxWidth×maxHeight (no letterboxing). */
  const [viewSize, setViewSize] = useState({ w: width, h: height });

  const {
    config,
    activeTool,
    onStrokeStart,
    onStrokeEnd,
    onUndo: logUndo,
    onClear: logClear,
  } = useDrawingStore();

  // Initialize Fabric canvas
  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = new fabric.Canvas(canvasRef.current, {
      isDrawingMode: activeTool === 'pen' || activeTool === 'eraser',
      width,
      height,
      backgroundColor: 'transparent',
      selection: false,
      skipTargetFind: true,
      preserveObjectStacking: true,
    });

    const pencilBrush = new fabric.PencilBrush(canvas);
    const baseSetBrushStyles = fabric.BaseBrush.prototype._setBrushStyles;
    pencilBrush._setBrushStyles = function setBrushStylesWithComposite(ctx) {
      baseSetBrushStyles.call(this, ctx);
      ctx.globalCompositeOperation = 'source-over';
    };
    patchPencilBrushForStrokeEraser(pencilBrush, () => getActiveTool() === 'eraser');
    canvas.freeDrawingBrush = pencilBrush;
    canvas.freeDrawingBrush.color = config.color;
    canvas.freeDrawingBrush.width = config.width;

    fabricRef.current = canvas;

    if (onCanvasReady) {
      onCanvasReady({
        export: () => exportCanvas(),
        clear: () => clearCanvas(),
        undo: () => undoAction(),
        redo: () => redoAction(),
        getCanvas: () => canvas,
      });
    }

    return () => {
      canvas.dispose();
    };
  }, [width, height]);

  useEffect(() => {
    if (!fabricRef.current) return;
    const canvas = fabricRef.current;
    canvas.isDrawingMode = activeTool === 'pen' || activeTool === 'eraser';
    canvas.skipTargetFind = true;
    canvas.selection = false;
  }, [activeTool]);

  // Brush width & color (eraser: wide semi-transparent preview stroke; objects removed on mouse up)
  useEffect(() => {
    if (!fabricRef.current) return;
    const brush = fabricRef.current.freeDrawingBrush;
    if (!brush) return;
    const strokeW = activeTool === 'eraser' ? getEraserBrushWidth(config.width) : config.width;
    brush.width = strokeW;
    brush.color = activeTool === 'eraser' ? ERASER_PREVIEW_COLOR : config.color;
  }, [activeTool, config.color, config.width]);

  useEffect(() => {
    if (activeTool !== 'eraser') setEraserGuide(null);
  }, [activeTool]);

  // Hollow ring follows pointer so users see the eraser footprint (Fabric has no built-in eraser cursor).
  useEffect(() => {
    if (!fabricRef.current) return;

    const canvas = fabricRef.current;

    const onMove = (opt) => {
      if (getActiveTool() !== 'eraser') {
        setEraserGuide(null);
        return;
      }
      const p = canvas.getPointer(opt.e);
      const d = getEraserBrushWidth(useDrawingStore.getState().config.width);
      setEraserGuide({ x: p.x, y: p.y, d });
    };

    const clear = () => setEraserGuide(null);

    canvas.on('mouse:move', onMove);
    canvas.on('mouse:out', clear);

    return () => {
      canvas.off('mouse:move', onMove);
      canvas.off('mouse:out', clear);
    };
  }, [width, height, imageUrl, activeTool, viewSize.w, viewSize.h]);

  // Chart as HTML underlay so eraser does not remove the chart image
  useEffect(() => {
    setViewSize({ w: width, h: height });

    if (!fabricRef.current || !imageUrl || !underlayImgRef.current) return;

    const imgEl = underlayImgRef.current;
    const canvas = fabricRef.current;

    const applyLayout = () => {
      const nw = imgEl.naturalWidth;
      const nh = imgEl.naturalHeight;
      if (!nw || !nh) return;

      const scale = Math.min(width / nw, height / nh);
      const dw = nw * scale;
      const dh = nh * scale;
      const cw = Math.max(1, Math.round(dw));
      const ch = Math.max(1, Math.round((nh / nw) * cw));

      imgEl.style.left = '0';
      imgEl.style.top = '0';
      imgEl.style.width = `${cw}px`;
      imgEl.style.height = `${ch}px`;
      underlayLayoutRef.current = { left: 0, top: 0, dw: cw, dh: ch, nw, nh };

      canvas.setDimensions({ width: cw, height: ch });
      setViewSize({ w: cw, h: ch });

      canvas.getObjects().forEach((obj) => canvas.remove(obj));
      canvas.renderAll();
      historyRef.current = [cloneFabricJson(canvas.toJSON())];
      historyIndexRef.current = 0;
    };

    const onLoad = () => applyLayout();
    imgEl.onload = onLoad;
    imgEl.crossOrigin = 'anonymous';
    imgEl.src = imageUrl;
    if (imgEl.complete && imgEl.naturalWidth) applyLayout();

    return () => {
      imgEl.onload = null;
    };
  }, [imageUrl, width, height]);

  // History management
  const saveToHistory = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const json = cloneFabricJson(canvas.toJSON());
    historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    historyRef.current.push(json);
    historyIndexRef.current = historyRef.current.length - 1;
  }, []);

  // Track pen / eraser stroke events
  useEffect(() => {
    if (!fabricRef.current) return;
    if (activeTool !== 'pen' && activeTool !== 'eraser') return;

    const canvas = fabricRef.current;

    const handleMouseDown = () => {
      freeDrawToolRef.current = getActiveTool();
      onStrokeStart();
    };

    const handlePathCreated = (e) => {
      if (freeDrawToolRef.current === 'eraser' || getActiveTool() === 'eraser') {
        return;
      }

      const path = e.path;
      let pathLength = 0;
      if (path.path) {
        for (let i = 1; i < path.path.length; i++) {
          const prev = path.path[i - 1];
          const curr = path.path[i];
          if (prev.length >= 3 && curr.length >= 3) {
            const dx = curr[curr.length - 2] - prev[prev.length - 2];
            const dy = curr[curr.length - 1] - prev[prev.length - 1];
            pathLength += Math.sqrt(dx * dx + dy * dy);
          }
        }
      }

      const pointCount = path.path ? path.path.length : 0;
      onStrokeEnd(pathLength, pointCount);
      saveToHistory();
    };

    const handleEraserStrokeEnd = (evt) => {
      const pts = evt.points || [];
      let pathLength = 0;
      for (let i = 1; i < pts.length; i++) {
        pathLength += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      }
      onStrokeEnd(pathLength, pts.length);
      saveToHistory();
    };

    canvas.on('mouse:down', handleMouseDown);
    canvas.on('path:created', handlePathCreated);
    canvas.on('eraser:stroke:end', handleEraserStrokeEnd);

    return () => {
      canvas.off('mouse:down', handleMouseDown);
      canvas.off('path:created', handlePathCreated);
      canvas.off('eraser:stroke:end', handleEraserStrokeEnd);
    };
  }, [activeTool, onStrokeStart, onStrokeEnd, saveToHistory]);


  const undoAction = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas || historyIndexRef.current <= 0) return;

    historyIndexRef.current--;
    const prevState = historyRef.current[historyIndexRef.current];

    canvas.loadFromJSON(cloneFabricJson(prevState), () => {
      canvas.renderAll();
      logUndo();
    });
  }, [logUndo]);

  const redoAction = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas || historyIndexRef.current >= historyRef.current.length - 1) return;

    historyIndexRef.current++;
    const nextState = historyRef.current[historyIndexRef.current];

    canvas.loadFromJSON(cloneFabricJson(nextState), () => {
      canvas.renderAll();
    });
  }, []);

  const clearCanvas = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    canvas.getObjects().forEach((obj) => {
      canvas.remove(obj);
    });
    canvas.renderAll();
    
    logClear();
    saveToHistory();
  }, [logClear, saveToHistory]);

  const exportCanvas = useCallback(() => {
    const canvas = fabricRef.current;
    const imgEl = underlayImgRef.current;
    const layout = underlayLayoutRef.current;
    if (!canvas) return null;

    canvas.renderAll();

    /** Current display size */
    const lw = canvas.getWidth();
    const lh = canvas.getHeight();

    /** Use natural (original) size for export */
    const nw = layout.nw || lw;
    const nh = layout.nh || lh;
    
    const out = document.createElement('canvas');
    out.width = nw;  // Export at original size
    out.height = nh;
    const ctx = out.getContext('2d');

    if (imgEl?.complete && layout.dw > 0 && imgEl.naturalWidth) {
      // Draw chart at original size
      ctx.drawImage(imgEl, 0, 0, nw, nh);
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, out.width, out.height);
    }

    // Scale drawings to match original size
    const scaleX = nw / lw;
    const scaleY = nh / lh;
    
    const lower = canvas.lowerCanvasEl;
    const upper = canvas.upperCanvasEl;
    if (lower) {
      ctx.drawImage(lower, 0, 0, lower.width, lower.height, 0, 0, nw, nh);
    }
    if (upper) {
      ctx.drawImage(upper, 0, 0, upper.width, upper.height, 0, 0, nw, nh);
    }

    const raw = out.toDataURL('image/jpeg', 0.92);
    const imageData = raw.startsWith('data:')
      ? raw
      : `data:image/jpeg;base64,${raw}`;

    return {
      imageData,
    };
  }, []);

  return (
    <div className="chart-canvas-container">
      <div
        className={activeTool === 'eraser' ? 'chart-stack chart-stack--eraser' : 'chart-stack'}
        style={{ width: viewSize.w, height: viewSize.h }}
        onMouseLeave={() => activeTool === 'eraser' && setEraserGuide(null)}
      >
        <img ref={underlayImgRef} alt="" className="chart-underlay" />
        <div className="chart-fabric-layer" style={{ width: viewSize.w, height: viewSize.h }}>
          <canvas ref={canvasRef} />
        </div>
        {activeTool === 'eraser' && eraserGuide && (
          <div
            className="eraser-cursor-guide"
            style={{
              left: eraserGuide.x,
              top: eraserGuide.y,
              width: eraserGuide.d,
              height: eraserGuide.d,
              marginLeft: -eraserGuide.d / 2,
              marginTop: -eraserGuide.d / 2,
            }}
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}
