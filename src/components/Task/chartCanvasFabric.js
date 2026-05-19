import { fabric } from 'fabric';

export const CANVAS_JSON_PROPS = ['cvaRect', 'cvaTextbox', 'cvaBoxHeight'];

export const CVA_TEXTBOX_MAX_CHARS = 16;
export const CVA_TEXTBOX_MIN_W = 48;
export const CVA_TEXTBOX_MIN_H = 28;
/** Default size when placing a textbox with a single click. */
export const CVA_TEXTBOX_DEFAULT_W = 160;
export const CVA_TEXTBOX_DEFAULT_H = 56;

export const CVA_TEXTBOX_STYLE = {
  fontSize: 16,
  fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
  lineHeight: 1.25,
};

/** Editing outline for the text region only (not glyph stroke — Fabric uses `stroke` on text). */
export const CVA_TEXTBOX_EDIT_BORDER = {
  hasBorders: true,
  borderColor: '#2563eb',
};

export const CVA_TEXTBOX_CLEAR_BORDER = {
  hasBorders: false,
  stroke: null,
  strokeWidth: 0,
};

export function applyTextboxEditingBorder(obj) {
  if (!obj?.cvaTextbox) return;
  obj.set({
    ...CVA_TEXTBOX_EDIT_BORDER,
    stroke: null,
    strokeWidth: 0,
  });
  obj.setCoords();
}

export function clearTextboxEditingBorder(obj) {
  if (!obj?.cvaTextbox) return;
  obj.set({ ...CVA_TEXTBOX_CLEAR_BORDER });
  obj.setCoords();
}

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

/** Edge handles resize the text region; scale is baked into width/height on modified. */
const TEXTBOX_SELECT_PROPS = {
  hasControls: true,
  hasBorders: true,
  lockScalingX: false,
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

export function createCvaTextbox({ left, top, width, height, fill }) {
  const boxW = Math.max(CVA_TEXTBOX_MIN_W, Math.round(width));
  const boxH = Math.max(CVA_TEXTBOX_MIN_H, Math.round(height));

  return new fabric.Textbox('', {
    left,
    top,
    width: boxW,
    height: boxH,
    fontSize: CVA_TEXTBOX_STYLE.fontSize,
    fontFamily: CVA_TEXTBOX_STYLE.fontFamily,
    lineHeight: CVA_TEXTBOX_STYLE.lineHeight,
    fill,
    editable: false,
    splitByGrapheme: true,
    lockScalingX: true,
    lockScalingY: true,
    lockRotation: true,
    dynamicMinHeight: false,
    backgroundColor: '',
    cvaTextbox: true,
    cvaBoxHeight: boxH,
  });
}

export function applyTextboxObject(obj) {
  if (!obj) return;

  const boxH = obj.cvaBoxHeight ?? obj.height ?? CVA_TEXTBOX_MIN_H;

  obj.set({
    cvaTextbox: true,
    cvaBoxHeight: boxH,
    selectable: false,
    evented: false,
    editable: false,
    lockRotation: true,
    lockScalingY: true,
    lockScalingX: true,
    hasControls: false,
    hasBorders: false,
    objectCaching: false,
    dynamicMinHeight: false,
    backgroundColor: '',
    fontSize: CVA_TEXTBOX_STYLE.fontSize,
    height: boxH,
  });
  obj.setCoords();
}

/** Bake scale into width/height so font size stays fixed while the text region changes. */
export function normalizeTextboxDimensions(obj) {
  if (!obj?.cvaTextbox) return;

  const sx = obj.scaleX ?? 1;
  const sy = obj.scaleY ?? 1;
  let w = obj.width ?? CVA_TEXTBOX_MIN_W;
  let h = obj.cvaBoxHeight ?? obj.height ?? CVA_TEXTBOX_MIN_H;

  if (Math.abs(sx - 1) > 0.001 || Math.abs(sy - 1) > 0.001) {
    w = Math.max(CVA_TEXTBOX_MIN_W, w * sx);
    h = Math.max(CVA_TEXTBOX_MIN_H, h * sy);
  }

  obj.set({
    width: w,
    height: h,
    scaleX: 1,
    scaleY: 1,
    fontSize: CVA_TEXTBOX_STYLE.fontSize,
    cvaBoxHeight: h,
    dynamicMinHeight: false,
    backgroundColor: '',
  });
  obj.setCoords();
}

export function enforceTextboxCharLimit(obj, maxChars = CVA_TEXTBOX_MAX_CHARS) {
  if (!obj?.cvaTextbox) return false;
  const text = obj.text ?? '';
  if (text.length <= maxChars) return false;

  obj.set({
    text: text.slice(0, maxChars),
    selectionStart: maxChars,
    selectionEnd: maxChars,
  });
  return true;
}

/** Select mode: resize text region (width/height), not font scale. */
export function applyTextboxSelectControls(obj, deleteHandler) {
  if (!obj) return;

  const proto = fabric.Object.prototype.controls;

  obj.set({
    ...TEXTBOX_SELECT_PROPS,
    editable: false,
    dynamicMinHeight: false,
    backgroundColor: '',
  });

  obj.controls = {
    mr: proto.mr,
    deleteControl: buildDeleteControl(deleteHandler),
  };
  obj.setControlsVisibility({
    tl: false,
    tr: false,
    bl: false,
    br: false,
    ml: false,
    mt: false,
    mb: false,
    mtr: false,
  });
  normalizeTextboxDimensions(obj);
}

/** One-time typing right after the box is drawn; lock afterward. */
export function beginTextboxInitialEntry(textbox, canvas) {
  if (!textbox?.cvaTextbox || !canvas) return;
  textbox.set({ editable: true, evented: true });
  applyTextboxEditingBorder(textbox);
  textbox.enterEditing();
  textbox.selectAll?.();
  canvas.setActiveObject(textbox);
  canvas.requestRenderAll();
}

export function lockTextboxContent(textbox, canvas) {
  if (!textbox?.cvaTextbox) return;
  if (textbox.isEditing) {
    textbox.exitEditing();
  }
  textbox.set({ editable: false });
  clearTextboxEditingBorder(textbox);
  canvas?.requestRenderAll();
}

export function configureCanvasSelection(activeObject, deleteHandler) {
  if (!activeObject) return;

  if (activeObject.type === 'activeSelection') {
    configureActiveSelection(activeObject, deleteHandler);
  } else if (activeObject.cvaTextbox) {
    applyTextboxSelectControls(activeObject, deleteHandler);
  } else if (isCvaAnnotation(activeObject)) {
    applyMoveOnlyDeleteControl(activeObject, deleteHandler);
  }
}

export function isCvaTextbox(obj) {
  return !!(obj && obj.cvaTextbox);
}

export function isCvaAnnotation(obj) {
  if (!obj) return false;
  return obj.type === 'path' || (obj.type === 'rect' && obj.cvaRect) || isCvaTextbox(obj);
}

export function rehydrateAnnotationObject(obj, deleteHandler) {
  if (!obj) return;
  if (isCvaTextbox(obj)) {
    applyTextboxObject(obj);
  } else {
    applyAnnotationObject(obj, deleteHandler);
  }
}

export function rehydrateAnnotationObjects(canvas, deleteHandler) {
  if (!canvas) return;
  canvas.getObjects().forEach((obj) => {
    if (isCvaAnnotation(obj)) {
      rehydrateAnnotationObject(obj, deleteHandler);
    }
  });
}

export function syncCanvasToolMode(canvas, activeTool) {
  if (!canvas) return;

  const isSelect = activeTool === 'select';
  const isPen = activeTool === 'pen';
  const isRect = activeTool === 'rect';
  const isText = activeTool === 'text';

  canvas.isDrawingMode = isPen;
  canvas.selection = isSelect;
  canvas.skipTargetFind = !(isSelect || isText);
  canvas.defaultCursor = isSelect ? 'default' : isText ? 'text' : isRect ? 'crosshair' : 'crosshair';
  canvas.hoverCursor = isSelect ? 'move' : isText ? 'text' : 'crosshair';

  canvas.getObjects().forEach((obj) => {
    if (!isCvaAnnotation(obj)) return;
    const isTextbox = isCvaTextbox(obj);
    obj.set({
      selectable: isSelect,
      evented: isSelect || (isText && isTextbox),
    });
    if (isTextbox && !isSelect) {
      obj.set({ hasControls: false, hasBorders: false });
    }
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
  } else if (obj.cvaTextbox) {
    obj.set({ fill: color });
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
