import { useEffect, useRef, useCallback, useState } from 'react';
import { fabric } from 'fabric';
import { useDrawingStore } from '../../stores/useDrawingStore';
import {
  CANVAS_JSON_PROPS,
  applyAnnotationObject,
  analyzeSelectionColors,
  applyActiveSelectToolState,
  cloneFabricJson,
  collectSelectedAnnotations,
  colorToKey,
  configureCanvasSelection,
  createDeleteObjectHandler,
  hexToRgba,
  rehydrateAnnotationObjects,
  setAnnotationColor,
  syncCanvasToolMode,
} from './chartCanvasFabric';

const getActiveTool = () => useDrawingStore.getState().activeTool;

/** `width` / `height` = maximum box; after the chart image loads the canvas shrinks to the fitted size (no empty margin). */
export default function ChartCanvas({
  imageUrl,
  onCanvasReady,
  width = 700,
  height = 500,
}) {
  const canvasRef = useRef(null);
  const fabricRef = useRef(null);
  const underlayImgRef = useRef(null);
  const underlayLayoutRef = useRef({ dw: 0, nw: 0, nh: 0 });
  const historyRef = useRef([]);
  const historyIndexRef = useRef(-1);
  const saveToHistoryRef = useRef(() => {});
  const moveHistoryTimerRef = useRef(null);

  const [viewSize, setViewSize] = useState({ w: width, h: height });

  const {
    config,
    activeTool,
    onStrokeStart,
    onStrokeEnd,
    onUndo: logUndo,
    onClear: logClear,
    onDelete: logDelete,
    setSelectionColorSummary,
    registerSelectionColorApplier,
  } = useDrawingStore();

  const refreshSelectionColorSummary = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas || getActiveTool() !== 'select') {
      setSelectionColorSummary({ hasSelection: false, uniformColor: null });
      return;
    }
    setSelectionColorSummary(analyzeSelectionColors(canvas.getActiveObject()));
  }, [setSelectionColorSummary]);

  const saveToHistory = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const json = cloneFabricJson(canvas.toJSON(CANVAS_JSON_PROPS));
    historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    historyRef.current.push(json);
    historyIndexRef.current = historyRef.current.length - 1;
  }, []);

  saveToHistoryRef.current = saveToHistory;

  const deleteHandlerRef = useRef(
    createDeleteObjectHandler(() => {
      logDelete();
      saveToHistoryRef.current();
    })
  );

  const afterHistoryLoad = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    rehydrateAnnotationObjects(canvas, deleteHandlerRef.current);
    syncCanvasToolMode(canvas, getActiveTool());
    refreshSelectionColorSummary();
    canvas.renderAll();
  }, [refreshSelectionColorSummary]);

  useEffect(() => {
    registerSelectionColorApplier((color) => {
      const canvas = fabricRef.current;
      if (!canvas) return;

      const active = canvas.getActiveObject();
      const targets = collectSelectedAnnotations(active);
      if (!targets.length) return;

      targets.forEach((obj) => setAnnotationColor(obj, color));
      canvas.requestRenderAll();
      saveToHistoryRef.current();
      setSelectionColorSummary({
        hasSelection: true,
        uniformColor: colorToKey(color),
      });
    });

    return () => registerSelectionColorApplier(null);
  }, [registerSelectionColorApplier, setSelectionColorSummary]);

  // Initialize Fabric canvas
  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = new fabric.Canvas(canvasRef.current, {
      isDrawingMode: activeTool === 'pen',
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
    canvas.freeDrawingBrush = pencilBrush;
    canvas.freeDrawingBrush.color = config.color;
    canvas.freeDrawingBrush.width = config.width;

    fabricRef.current = canvas;
    syncCanvasToolMode(canvas, getActiveTool());

    return () => {
      canvas.dispose();
    };
  }, [width, height]);

  useEffect(() => {
    if (!fabricRef.current) return;
    const canvas = fabricRef.current;

    syncCanvasToolMode(canvas, activeTool);

    if (activeTool === 'select') {
      applyActiveSelectToolState(canvas, deleteHandlerRef.current);
    }

    refreshSelectionColorSummary();
  }, [activeTool, refreshSelectionColorSummary]);

  useEffect(() => {
    if (!fabricRef.current) return;
    const brush = fabricRef.current.freeDrawingBrush;
    if (!brush) return;
    brush.width = config.width;
    brush.color = config.color;
  }, [config.color, config.width]);

  // Chart as HTML underlay (not a Fabric object)
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
      const cw = Math.max(1, Math.round(dw));
      const ch = Math.max(1, Math.round((nh / nw) * cw));

      imgEl.style.left = '0';
      imgEl.style.top = '0';
      imgEl.style.width = `${cw}px`;
      imgEl.style.height = `${ch}px`;
      underlayLayoutRef.current = { dw: cw, nw, nh };

      canvas.setDimensions({ width: cw, height: ch });
      setViewSize({ w: cw, h: ch });

      canvas.getObjects().forEach((obj) => canvas.remove(obj));
      canvas.discardActiveObject();
      canvas.renderAll();
      historyRef.current = [cloneFabricJson(canvas.toJSON(CANVAS_JSON_PROPS))];
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

  // Shift-click / marquee ActiveSelection: replace default scale/rotate handles
  useEffect(() => {
    if (!fabricRef.current) return;
    const canvas = fabricRef.current;

    const onSelectionChange = () => {
      if (getActiveTool() !== 'select') return;

      applyActiveSelectToolState(canvas, deleteHandlerRef.current);
      refreshSelectionColorSummary();
      canvas.requestRenderAll();
    };

    const onSelectionCleared = () => {
      if (getActiveTool() !== 'select') return;
      refreshSelectionColorSummary();
    };

    canvas.on('selection:created', onSelectionChange);
    canvas.on('selection:updated', onSelectionChange);
    canvas.on('selection:cleared', onSelectionCleared);

    return () => {
      canvas.off('selection:created', onSelectionChange);
      canvas.off('selection:updated', onSelectionChange);
      canvas.off('selection:cleared', onSelectionCleared);
    };
  }, [width, height, imageUrl, refreshSelectionColorSummary]);

  // Debounced history entry after moving a selection
  useEffect(() => {
    if (!fabricRef.current) return;
    const canvas = fabricRef.current;

    const onModified = () => {
      if (getActiveTool() !== 'select') return;
      if (moveHistoryTimerRef.current) clearTimeout(moveHistoryTimerRef.current);
      moveHistoryTimerRef.current = setTimeout(() => {
        saveToHistoryRef.current();
        moveHistoryTimerRef.current = null;
      }, 300);
    };

    canvas.on('object:modified', onModified);
    return () => {
      canvas.off('object:modified', onModified);
      if (moveHistoryTimerRef.current) clearTimeout(moveHistoryTimerRef.current);
    };
  }, [width, height, imageUrl]);

  // Rectangle highlight: drag to create axis-aligned rect (30% fill)
  useEffect(() => {
    if (!fabricRef.current || activeTool !== 'rect') return undefined;

    const canvas = fabricRef.current;
    const state = { preview: null, origin: null };

    const paintStyle = () => {
      const color = useDrawingStore.getState().config.color;
      return { fill: hexToRgba(color, 0.3) };
    };

    const removePreview = () => {
      if (state.preview) {
        canvas.remove(state.preview);
        state.preview = null;
      }
      state.origin = null;
    };

    const onDown = (opt) => {
      if (getActiveTool() !== 'rect') return;
      removePreview();
      const p = canvas.getPointer(opt.e);
      state.origin = { x: p.x, y: p.y };
      const { fill } = paintStyle();
      state.preview = new fabric.Rect({
        left: p.x,
        top: p.y,
        width: 0,
        height: 0,
        fill,
        strokeWidth: 0,
        stroke: null,
        selectable: false,
        evented: false,
        objectCaching: false,
        cvaRect: true,
      });
      canvas.add(state.preview);
      canvas.requestRenderAll();
    };

    const onMove = (opt) => {
      if (getActiveTool() !== 'rect' || !state.preview || !state.origin) return;
      const p = canvas.getPointer(opt.e);
      const ox = state.origin.x;
      const oy = state.origin.y;
      const x = Math.min(ox, p.x);
      const y = Math.min(oy, p.y);
      const w = Math.abs(p.x - ox);
      const h = Math.abs(p.y - oy);
      const { fill } = paintStyle();
      state.preview.set({ left: x, top: y, width: w, height: h, fill, stroke: null, strokeWidth: 0 });
      canvas.requestRenderAll();
    };

    const finalize = () => {
      const rect = state.preview;
      const origin = state.origin;
      if (!rect || !origin) return;
      state.preview = null;
      state.origin = null;

      const rw = Math.abs(rect.width * (rect.scaleX || 1));
      const rh = Math.abs(rect.height * (rect.scaleY || 1));

      if (rw < 3 || rh < 3) {
        canvas.remove(rect);
        canvas.requestRenderAll();
        return;
      }

      applyAnnotationObject(rect, deleteHandlerRef.current);
      syncCanvasToolMode(canvas, getActiveTool());

      onStrokeStart();
      onStrokeEnd(Math.hypot(rw, rh), 4);
      saveToHistory();
      canvas.requestRenderAll();
    };

    const onUp = () => finalize();

    canvas.on('mouse:down', onDown);
    canvas.on('mouse:move', onMove);
    canvas.on('mouse:up', onUp);
    document.addEventListener('mouseup', onUp);

    return () => {
      document.removeEventListener('mouseup', onUp);
      canvas.off('mouse:down', onDown);
      canvas.off('mouse:move', onMove);
      canvas.off('mouse:up', onUp);
      if (state.preview) {
        canvas.remove(state.preview);
        state.preview = null;
      }
      state.origin = null;
      canvas.requestRenderAll();
    };
  }, [activeTool, onStrokeStart, onStrokeEnd, saveToHistory, width, height]);

  // Pen stroke events
  useEffect(() => {
    if (!fabricRef.current) return;
    if (activeTool !== 'pen') return;

    const canvas = fabricRef.current;

    const handleMouseDown = () => {
      onStrokeStart();
    };

    const handlePathCreated = (e) => {
      const path = e.path;
      const { penLineStyle, penDashPattern } = useDrawingStore.getState();
      if (penLineStyle === 'dashed' && Array.isArray(penDashPattern) && penDashPattern.length >= 2) {
        path.set({ strokeDashArray: [...penDashPattern] });
      }

      applyAnnotationObject(path, deleteHandlerRef.current);
      syncCanvasToolMode(canvas, getActiveTool());

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
      path.setCoords();
      canvas.requestRenderAll();
      onStrokeEnd(pathLength, pointCount);
      saveToHistory();
    };

    canvas.on('mouse:down', handleMouseDown);
    canvas.on('path:created', handlePathCreated);

    return () => {
      canvas.off('mouse:down', handleMouseDown);
      canvas.off('path:created', handlePathCreated);
    };
  }, [activeTool, onStrokeStart, onStrokeEnd, saveToHistory, width, height]);

  const undoAction = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas || historyIndexRef.current <= 0) return;

    historyIndexRef.current--;
    const prevState = historyRef.current[historyIndexRef.current];

    canvas.loadFromJSON(cloneFabricJson(prevState), () => {
      afterHistoryLoad();
      logUndo();
    });
  }, [logUndo, afterHistoryLoad]);

  const redoAction = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas || historyIndexRef.current >= historyRef.current.length - 1) return;

    historyIndexRef.current++;
    const nextState = historyRef.current[historyIndexRef.current];

    canvas.loadFromJSON(cloneFabricJson(nextState), () => {
      afterHistoryLoad();
    });
  }, [afterHistoryLoad]);

  const clearCanvas = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    canvas.getObjects().forEach((obj) => canvas.remove(obj));
    canvas.discardActiveObject();
    canvas.renderAll();

    logClear();
    saveToHistory();
  }, [logClear, saveToHistory]);

  const exportCanvas = useCallback(() => {
    const canvas = fabricRef.current;
    const imgEl = underlayImgRef.current;
    const layout = underlayLayoutRef.current;
    if (!canvas) return null;

    canvas.discardActiveObject();
    canvas.renderAll();

    const nw = layout.nw || canvas.getWidth();
    const nh = layout.nh || canvas.getHeight();

    const out = document.createElement('canvas');
    out.width = nw;
    out.height = nh;
    const ctx = out.getContext('2d');

    if (imgEl?.complete && layout.dw > 0 && imgEl.naturalWidth) {
      ctx.drawImage(imgEl, 0, 0, nw, nh);
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, out.width, out.height);
    }

    const lower = canvas.lowerCanvasEl;
    const upper = canvas.upperCanvasEl;
    if (lower) {
      ctx.drawImage(lower, 0, 0, lower.width, lower.height, 0, 0, nw, nh);
    }
    if (upper) {
      ctx.drawImage(upper, 0, 0, upper.width, upper.height, 0, 0, nw, nh);
    }

    const raw = out.toDataURL('image/jpeg', 0.92);
    const imageData = raw.startsWith('data:') ? raw : `data:image/jpeg;base64,${raw}`;

    return { imageData };
  }, []);

  useEffect(() => {
    if (!fabricRef.current || !onCanvasReady) return;
    const canvas = fabricRef.current;
    onCanvasReady({
      export: () => exportCanvas(),
      clear: () => clearCanvas(),
      undo: () => undoAction(),
      redo: () => redoAction(),
      getCanvas: () => canvas,
    });
  }, [onCanvasReady, exportCanvas, clearCanvas, undoAction, redoAction]);

  const stackClass =
    activeTool === 'rect'
      ? 'chart-stack chart-stack--rect'
      : activeTool === 'select'
        ? 'chart-stack chart-stack--select'
        : 'chart-stack';

  return (
    <div className="chart-canvas-container">
      <div className={stackClass} style={{ width: viewSize.w, height: viewSize.h }}>
        <img ref={underlayImgRef} alt="" className="chart-underlay" />
        <div className="chart-fabric-layer" style={{ width: viewSize.w, height: viewSize.h }}>
          <canvas ref={canvasRef} />
        </div>
      </div>
    </div>
  );
}
