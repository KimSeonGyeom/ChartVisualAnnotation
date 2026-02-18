import { useEffect, useRef, useCallback } from 'react';
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

  const { 
    config, 
    onStrokeStart, 
    onStrokeEnd, 
    onUndo: logUndo, 
    onClear: logClear 
  } = useDrawingStore();

  // Initialize Fabric canvas
  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = new fabric.Canvas(canvasRef.current, {
      isDrawingMode: true,
      width,
      height,
      backgroundColor: '#ffffff',
    });

    // Configure pen brush
    canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
    canvas.freeDrawingBrush.color = config.color;
    canvas.freeDrawingBrush.width = config.width;

    fabricRef.current = canvas;

    // Expose canvas methods to parent
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
      // Scale image to fit canvas while maintaining aspect ratio
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

      // Save initial empty state to history
      historyRef.current = [canvas.toJSON()];
      historyIndexRef.current = 0;
    }, { crossOrigin: 'anonymous' });
  }, [imageUrl]);

  // Track stroke events
  useEffect(() => {
    if (!fabricRef.current) return;

    const canvas = fabricRef.current;

    const handleMouseDown = () => {
      onStrokeStart();
    };

    const handlePathCreated = (e) => {
      const path = e.path;
      
      // Calculate path length
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

      // Save to history
      saveToHistory();
    };

    canvas.on('mouse:down', handleMouseDown);
    canvas.on('path:created', handlePathCreated);

    return () => {
      canvas.off('mouse:down', handleMouseDown);
      canvas.off('path:created', handlePathCreated);
    };
  }, [onStrokeStart, onStrokeEnd]);

  // History management
  const saveToHistory = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const json = canvas.toJSON();
    
    // Remove future history if we're not at the end
    historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    historyRef.current.push(json);
    historyIndexRef.current = historyRef.current.length - 1;
  }, []);

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

    // Remove all objects except background
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

    return {
      svg: canvas.toSVG(),
    };
  }, []);

  return (
    <div className="chart-canvas-container">
      <canvas ref={canvasRef} />
    </div>
  );
}

