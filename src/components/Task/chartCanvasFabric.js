import { fabric } from 'fabric';

export const CANVAS_JSON_PROPS = ['cvaRect'];

const DELETE_CONTROL_SIZE = 20;

const MOVE_ONLY_PROPS = {
  hasControls: true,
  hasBorders: true,
  lockScalingX: true,
  lockScalingY: true,
  lockRotation: true,
  transparentCorners: false,
  borderColor: '#2563eb',
  cornerColor: '#2563eb',
  cornerStyle: 'circle',
  padding: 4,
};

/** Draw a compact × on a white disc (top-right of selection). */
function renderDeleteIcon(ctx, left, top, _styleOverride, fabricObject) {
  const size = this.cornerSize || DELETE_CONTROL_SIZE;
  const radius = size / 2 - 1;

  ctx.save();
  ctx.translate(left, top);
  ctx.rotate(fabric.util.degreesToRadians(fabricObject.angle || 0));

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#b91c1c';
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  const arm = size * 0.18;
  ctx.strokeStyle = '#b91c1c';
  ctx.lineWidth = 1.75;
  ctx.beginPath();
  ctx.moveTo(-arm, -arm);
  ctx.lineTo(arm, arm);
  ctx.moveTo(arm, -arm);
  ctx.lineTo(-arm, arm);
  ctx.stroke();

  ctx.restore();
}

function buildDeleteControl(deleteHandler) {
  return new fabric.Control({
    x: 0.5,
    y: -0.5,
    offsetY: -8,
    offsetX: 8,
    cursorStyle: 'pointer',
    mouseUpHandler: deleteHandler,
    render: renderDeleteIcon,
    cornerSize: DELETE_CONTROL_SIZE,
  });
}

export function createDeleteObjectHandler(onDeleted) {
  return function deleteObject(_eventData, transform) {
    const target = transform?.target;
    const canvas = target?.canvas;
    if (!canvas || !target) return true;

    if (target.type === 'activeSelection') {
      target
        .getObjects()
        .slice()
        .forEach((obj) => canvas.remove(obj));
    } else {
      canvas.remove(target);
    }

    canvas.discardActiveObject();
    canvas.requestRenderAll();
    onDeleted?.();
    return true;
  };
}

/** Top-right × only; no scale / rotate handles (single object or ActiveSelection). */
export function applyMoveOnlyDeleteControl(obj, deleteHandler) {
  if (!obj) return;

  obj.set({ ...MOVE_ONLY_PROPS });
  obj.controls = {
    deleteControl: buildDeleteControl(deleteHandler),
  };
  obj.setCoords();
}

/** Move-only annotations with a single top-right delete control. */
export function applyAnnotationObject(obj, deleteHandler) {
  if (!obj) return;

  obj.set({
    selectable: false,
    evented: false,
    ...MOVE_ONLY_PROPS,
  });

  applyMoveOnlyDeleteControl(obj, deleteHandler);
}

/** Shift-click / marquee groups use Fabric ActiveSelection defaults unless we override. */
export function configureActiveSelection(activeObject, deleteHandler) {
  if (!activeObject || activeObject.type !== 'activeSelection') return;

  applyMoveOnlyDeleteControl(activeObject, deleteHandler);

  activeObject.getObjects().forEach((child) => {
    if (!isCvaAnnotation(child)) return;
    child.set({
      lockScalingX: true,
      lockScalingY: true,
      lockRotation: true,
    });
  });
}

export function configureCanvasSelection(activeObject, deleteHandler) {
  if (!activeObject) return;

  if (activeObject.type === 'activeSelection') {
    configureActiveSelection(activeObject, deleteHandler);
  } else if (isCvaAnnotation(activeObject)) {
    applyMoveOnlyDeleteControl(activeObject, deleteHandler);
  }
}

export function applyActiveSelectToolState(canvas, deleteHandler) {
  if (!canvas) return;

  const active = canvas.getActiveObject();
  if (!active) return;

  configureCanvasSelection(active, deleteHandler);
}

export function isLegacyTextboxObject(obj) {
  return !!(obj && (obj.cvaTextbox || obj.type === 'textbox'));
}

export function isCvaAnnotation(obj) {
  if (!obj) return false;
  return obj.type === 'path' || (obj.type === 'rect' && obj.cvaRect);
}

export function rehydrateAnnotationObject(obj, deleteHandler) {
  if (!obj) return;
  applyAnnotationObject(obj, deleteHandler);
}

export function rehydrateAnnotationObjects(canvas, deleteHandler) {
  if (!canvas) return;

  const legacyTextboxes = [];
  canvas.getObjects().forEach((obj) => {
    if (isLegacyTextboxObject(obj)) {
      legacyTextboxes.push(obj);
      return;
    }
    if (isCvaAnnotation(obj)) {
      rehydrateAnnotationObject(obj, deleteHandler);
    }
  });
  legacyTextboxes.forEach((obj) => canvas.remove(obj));
}

export function syncCanvasToolMode(canvas, activeTool) {
  if (!canvas) return;

  const isSelect = activeTool === 'select';
  const isPen = activeTool === 'pen';
  const isRect = activeTool === 'rect';

  canvas.isDrawingMode = isPen;
  canvas.selection = isSelect;
  canvas.skipTargetFind = !isSelect;
  canvas.defaultCursor = isSelect ? 'default' : isRect ? 'crosshair' : 'crosshair';
  canvas.hoverCursor = isSelect ? 'move' : 'crosshair';

  canvas.getObjects().forEach((obj) => {
    if (!isCvaAnnotation(obj)) return;
    obj.set({
      selectable: isSelect,
      evented: isSelect,
    });
    obj.setCoords();
  });

  if (!isSelect) {
    canvas.discardActiveObject();
  }

  canvas.requestRenderAll();
}

/** Normalize #rgb / #rrggbb / rgb(a) for comparison with palette chips. */
export function colorToKey(color) {
  if (!color || typeof color !== 'string') return '';
  const c = color.trim().toLowerCase();
  if (c.startsWith('#')) {
    let h = c.slice(1);
    if (h.length === 3) {
      h = h
        .split('')
        .map((ch) => ch + ch)
        .join('');
    }
    return `#${h}`;
  }
  const m = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) {
    const r = Number(m[1]);
    const g = Number(m[2]);
    const b = Number(m[3]);
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).padStart(6, '0')}`;
  }
  return c;
}

export function getAnnotationColor(obj) {
  if (!obj) return '';
  if (obj.type === 'path') return obj.stroke || '';
  return obj.fill || '';
}

export function setAnnotationColor(obj, color) {
  if (!obj || !color) return;
  if (obj.type === 'path') {
    obj.set({ stroke: color, fill: '' });
  } else if (obj.cvaRect) {
    obj.set({ fill: hexToRgba(color, 0.3) });
  }
  obj.setCoords();
}

export function collectSelectedAnnotations(activeObject) {
  if (!activeObject) return [];
  if (activeObject.type === 'activeSelection') {
    return activeObject.getObjects().filter(isCvaAnnotation);
  }
  return isCvaAnnotation(activeObject) ? [activeObject] : [];
}

export function analyzeSelectionColors(activeObject) {
  const objs = collectSelectedAnnotations(activeObject);
  if (!objs.length) {
    return { hasSelection: false, uniformColor: null };
  }
  const keys = objs.map((o) => colorToKey(getAnnotationColor(o)));
  const first = keys[0];
  const uniform = keys.every((k) => k === first);
  return {
    hasSelection: true,
    uniformColor: uniform ? first : null,
  };
}

export function cloneFabricJson(json) {
  return JSON.parse(JSON.stringify(json));
}

export function hexToRgba(hex, alpha) {
  if (!hex || typeof hex !== 'string') return `rgba(0,0,0,${alpha})`;
  let h = hex.replace('#', '');
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return `rgba(0,0,0,${alpha})`;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}
