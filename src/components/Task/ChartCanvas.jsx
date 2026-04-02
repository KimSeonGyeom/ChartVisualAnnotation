import { useEffect, useRef, useCallback, useState } from 'react';
import { fabric } from 'fabric';
import { useDrawingStore } from '../../stores/useDrawingStore';

export default function ChartCanvas({ 
  imageUrl, 
  onCanvasReady,
  width = 700,
  height = 500 
}) {
  const canvasRef = useRef(null);
  const fabricRef = useRef(null);
  const historyRef = useRef([]);
  const historyIndexRef = useRef(-1);
  
  // Shape drawing state
  const [isDrawingShape, setIsDrawingShape] = useState(false);
  const startPointRef = useRef(null);
  const activeShapeRef = useRef(null);
  const controlPointRef = useRef(null);

  const { 
    config, 
    activeTool,
    toolOptions,
    onStrokeStart, 
    onStrokeEnd, 
    onShapeCreated,
    onUndo: logUndo, 
    onClear: logClear 
  } = useDrawingStore();

  // Initialize Fabric canvas
  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = new fabric.Canvas(canvasRef.current, {
      isDrawingMode: activeTool === 'pen',
      width,
      height,
      backgroundColor: '#ffffff',
      selection: false,
      skipTargetFind: true,
    });

    canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
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

  // Toggle drawing mode and selection based on active tool
  useEffect(() => {
    if (!fabricRef.current) return;
    const canvas = fabricRef.current;
    canvas.isDrawingMode = activeTool === 'pen';
    // Enable object selection/movement only for text tool
    canvas.skipTargetFind = activeTool !== 'text';
    canvas.selection = activeTool === 'text';
  }, [activeTool]);

  // Update brush settings when config changes
  useEffect(() => {
    if (fabricRef.current) {
      fabricRef.current.freeDrawingBrush.color = config.color;
      fabricRef.current.freeDrawingBrush.width = config.width;
    }
  }, [config.color, config.width]);

  // Load background image
  useEffect(() => {
    if (!fabricRef.current || !imageUrl) return;

    const canvas = fabricRef.current;

    fabric.Image.fromURL(imageUrl, (img) => {
      const scale = Math.min(
        canvas.width / img.width,
        canvas.height / img.height
      );

      canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas), {
        scaleX: scale,
        scaleY: scale,
        originX: 'left',
        originY: 'top',
        left: (canvas.width - img.width * scale) / 2,
        top: (canvas.height - img.height * scale) / 2,
      });

      historyRef.current = [canvas.toJSON()];
      historyIndexRef.current = 0;
    }, { crossOrigin: 'anonymous' });
  }, [imageUrl]);

  // Create arrow head
  const createArrowHead = useCallback((x, y, angle, color) => {
    const headLength = 12;
    const headWidth = 8;
    
    return new fabric.Triangle({
      left: x,
      top: y,
      width: headWidth,
      height: headLength,
      fill: color,
      angle: angle + 90,
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
    });
  }, []);

  // Create arrow
  const createArrow = useCallback((startX, startY, endX, endY, options = {}) => {
    const { 
      color = config.color, 
      lineStyle = toolOptions.lineStyle,
      direction = toolOptions.arrowDirection,
      isCurved = toolOptions.arrowShape === 'curved',
      controlX,
      controlY,
    } = options;

    const strokeWidth = 2;
    const strokeDashArray = lineStyle === 'dashed' ? [8, 4] : null;
    const objects = [];
    
    if (isCurved && controlX !== undefined && controlY !== undefined) {
      const pathData = `M ${startX} ${startY} Q ${controlX} ${controlY} ${endX} ${endY}`;
      const path = new fabric.Path(pathData, {
        fill: '',
        stroke: color,
        strokeWidth,
        strokeDashArray,
        selectable: false,
        evented: false,
      });
      objects.push(path);
      
      const t = 0.99;
      const angle = Math.atan2(
        endY - (2 * (1 - t) * controlY + 2 * t * endY - 2 * (1 - t) * startY - 2 * t * controlY),
        endX - (2 * (1 - t) * controlX + 2 * t * endX - 2 * (1 - t) * startX - 2 * t * controlX)
      ) * 180 / Math.PI;
      
      objects.push(createArrowHead(endX, endY, angle, color));
      
      if (direction === 'double') {
        const startAngle = Math.atan2(controlY - startY, controlX - startX) * 180 / Math.PI + 180;
        objects.push(createArrowHead(startX, startY, startAngle, color));
      }
    } else {
      const line = new fabric.Line([startX, startY, endX, endY], {
        stroke: color,
        strokeWidth,
        strokeDashArray,
        selectable: false,
        evented: false,
      });
      objects.push(line);

      const angle = Math.atan2(endY - startY, endX - startX) * 180 / Math.PI;
      objects.push(createArrowHead(endX, endY, angle, color));

      if (direction === 'double') {
        objects.push(createArrowHead(startX, startY, angle + 180, color));
      }
    }

    return new fabric.Group(objects, { selectable: false, evented: false });
  }, [config.color, toolOptions, createArrowHead]);

  // Create line
  const createLine = useCallback((startX, startY, endX, endY, isHorizontal = true) => {
    const { color } = config;
    const { lineStyle } = toolOptions;
    const strokeDashArray = lineStyle === 'dashed' ? [8, 4] : null;
    
    const finalEndX = isHorizontal ? endX : startX;
    const finalEndY = isHorizontal ? startY : endY;
    
    return new fabric.Line([startX, startY, finalEndX, finalEndY], {
      stroke: color,
      strokeWidth: 2,
      strokeDashArray,
      selectable: false,
      evented: false,
    });
  }, [config.color, toolOptions.lineStyle]);

  // Create bounding box
  const createBBox = useCallback((startX, startY, endX, endY) => {
    return new fabric.Rect({
      left: Math.min(startX, endX),
      top: Math.min(startY, endY),
      width: Math.abs(endX - startX),
      height: Math.abs(endY - startY),
      fill: 'transparent',
      stroke: config.color,
      strokeWidth: 2,
      selectable: false,
      evented: false,
    });
  }, [config.color]);

  // Create highlight
  const createHighlight = useCallback((startX, startY, endX, endY) => {
    return new fabric.Rect({
      left: Math.min(startX, endX),
      top: Math.min(startY, endY),
      width: Math.abs(endX - startX),
      height: Math.abs(endY - startY),
      fill: config.color,
      opacity: 0.3,
      stroke: 'transparent',
      selectable: false,
      evented: false,
    });
  }, [config.color]);

  // Create bracket
  const createBracket = useCallback((startX, startY, endX, endY) => {
    const bracketDepth = 15;
    const isHorizontal = Math.abs(endX - startX) > Math.abs(endY - startY);
    
    let pathData;
    if (isHorizontal) {
      const midX = (startX + endX) / 2;
      pathData = `M ${startX} ${startY} 
                  L ${startX} ${startY + bracketDepth} 
                  L ${midX} ${startY + bracketDepth}
                  L ${midX} ${startY + bracketDepth + 8}
                  M ${midX} ${startY + bracketDepth}
                  L ${endX} ${startY + bracketDepth}
                  L ${endX} ${startY}`;
    } else {
      const midY = (startY + endY) / 2;
      pathData = `M ${startX} ${startY} 
                  L ${startX + bracketDepth} ${startY} 
                  L ${startX + bracketDepth} ${midY}
                  L ${startX + bracketDepth + 8} ${midY}
                  M ${startX + bracketDepth} ${midY}
                  L ${startX + bracketDepth} ${endY}
                  L ${startX} ${endY}`;
    }
    
    return new fabric.Path(pathData, {
      fill: 'transparent',
      stroke: config.color,
      strokeWidth: 2,
      selectable: false,
      evented: false,
    });
  }, [config.color]);

  // History management
  const saveToHistory = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const json = canvas.toJSON();
    historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    historyRef.current.push(json);
    historyIndexRef.current = historyRef.current.length - 1;
  }, []);

  // Handle text tool
  useEffect(() => {
    if (!fabricRef.current) return;
    if (activeTool !== 'text') return;

    const canvas = fabricRef.current;

    const handleMouseDown = (e) => {
      // If clicking on an existing object, let Fabric handle it (move/select)
      if (canvas.findTarget(e.e)) return;

      const pointer = canvas.getPointer(e.e);
      const textObj = new fabric.IText('', {
        left: pointer.x,
        top: pointer.y,
        fontFamily: 'sans-serif',
        fontSize: toolOptions.fontSize,
        fill: config.color,
        selectable: true,
        evented: true,
        hasControls: true,
        hasBorders: true,
      });

      canvas.add(textObj);
      canvas.setActiveObject(textObj);
      textObj.enterEditing();
      canvas.renderAll();
    };

    const handleTextEditingExited = (e) => {
      const textObj = e.target;
      if (!textObj.text || textObj.text.trim() === '') {
        canvas.remove(textObj);
      } else {
        onShapeCreated('text', { text: textObj.text });
        saveToHistory();
      }
      canvas.renderAll();
    };

    canvas.on('mouse:down', handleMouseDown);
    canvas.on('text:editing:exited', handleTextEditingExited);

    return () => {
      canvas.off('mouse:down', handleMouseDown);
      canvas.off('text:editing:exited', handleTextEditingExited);
    };
  }, [activeTool, config.color, toolOptions.fontSize, onShapeCreated, saveToHistory]);

  // Handle shape drawing (non-pen tools)
  useEffect(() => {
    if (!fabricRef.current) return;
    if (activeTool === 'pen') return;
    if (activeTool === 'text') return;

    const canvas = fabricRef.current;
    
    const handleMouseDown = (e) => {
      const pointer = canvas.getPointer(e.e);
      startPointRef.current = { x: pointer.x, y: pointer.y };
      setIsDrawingShape(true);
      
      if (activeTool === 'arrow' && toolOptions.arrowShape === 'curved') {
        controlPointRef.current = { x: pointer.x, y: pointer.y };
      }
    };

    const handleMouseMove = (e) => {
      if (!isDrawingShape || !startPointRef.current) return;
      
      const pointer = canvas.getPointer(e.e);
      const { x: startX, y: startY } = startPointRef.current;
      
      if (activeShapeRef.current) {
        canvas.remove(activeShapeRef.current);
      }
      
      let shape;
      switch (activeTool) {
        case 'arrow':
          if (toolOptions.arrowShape === 'curved') {
            const midX = (startX + pointer.x) / 2;
            const midY = (startY + pointer.y) / 2;
            const dx = pointer.x - startX;
            const dy = pointer.y - startY;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            const offset = len * 0.3;
            controlPointRef.current = {
              x: midX - (dy / len) * offset,
              y: midY + (dx / len) * offset,
            };
            shape = createArrow(startX, startY, pointer.x, pointer.y, {
              isCurved: true,
              controlX: controlPointRef.current.x,
              controlY: controlPointRef.current.y,
            });
          } else {
            shape = createArrow(startX, startY, pointer.x, pointer.y);
          }
          break;
        case 'hline':
          shape = createLine(startX, startY, pointer.x, pointer.y, true);
          break;
        case 'vline':
          shape = createLine(startX, startY, pointer.x, pointer.y, false);
          break;
        case 'bbox':
          shape = createBBox(startX, startY, pointer.x, pointer.y);
          break;
        case 'highlight':
          shape = createHighlight(startX, startY, pointer.x, pointer.y);
          break;
        case 'bracket':
          shape = createBracket(startX, startY, pointer.x, pointer.y);
          break;
      }
      
      if (shape) {
        activeShapeRef.current = shape;
        canvas.add(shape);
        canvas.renderAll();
      }
    };

    const handleMouseUp = () => {
      if (!isDrawingShape || !startPointRef.current) return;
      
      setIsDrawingShape(false);
      
      if (activeShapeRef.current) {
        onShapeCreated(activeTool, {
          startPoint: startPointRef.current,
          options: { ...toolOptions },
        });
        saveToHistory();
      }
      
      startPointRef.current = null;
      activeShapeRef.current = null;
      controlPointRef.current = null;
    };

    canvas.on('mouse:down', handleMouseDown);
    canvas.on('mouse:move', handleMouseMove);
    canvas.on('mouse:up', handleMouseUp);

    return () => {
      canvas.off('mouse:down', handleMouseDown);
      canvas.off('mouse:move', handleMouseMove);
      canvas.off('mouse:up', handleMouseUp);
    };
  }, [activeTool, toolOptions, isDrawingShape, createArrow, createLine, createBBox, createHighlight, createBracket, onShapeCreated]);

  // Track pen stroke events
  useEffect(() => {
    if (!fabricRef.current) return;
    if (activeTool !== 'pen') return;

    const canvas = fabricRef.current;

    const handleMouseDown = () => {
      onStrokeStart();
    };

    const handlePathCreated = (e) => {
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

    canvas.on('mouse:down', handleMouseDown);
    canvas.on('path:created', handlePathCreated);

    return () => {
      canvas.off('mouse:down', handleMouseDown);
      canvas.off('path:created', handlePathCreated);
    };
  }, [activeTool, onStrokeStart, onStrokeEnd]);


  const undoAction = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas || historyIndexRef.current <= 0) return;

    historyIndexRef.current--;
    const prevState = historyRef.current[historyIndexRef.current];
    
    canvas.loadFromJSON(prevState, () => {
      canvas.renderAll();
      logUndo();
    });
  }, [logUndo]);

  const redoAction = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas || historyIndexRef.current >= historyRef.current.length - 1) return;

    historyIndexRef.current++;
    const nextState = historyRef.current[historyIndexRef.current];
    
    canvas.loadFromJSON(nextState, () => {
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
    if (!canvas) return null;

    const raw = canvas.toDataURL({ format: 'jpeg', quality: 1, multiplier: 1 });
    const imageData = raw.startsWith('data:')
      ? raw
      : `data:image/jpeg;base64,${raw}`;

    return {
      svg: canvas.toSVG(),
      imageData,
    };
  }, []);

  return (
    <div className="chart-canvas-container">
      <canvas ref={canvasRef} />
    </div>
  );
}
