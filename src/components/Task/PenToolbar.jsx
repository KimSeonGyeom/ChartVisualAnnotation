import { useDrawingStore } from '../../stores/useDrawingStore';
import studyConfig from '../../config/study.json';

export default function PenToolbar({ onUndo, onRedo, onClear }) {
  const { 
    config, 
    setColor, 
    allowCustomization,
    activeTool,
    setActiveTool,
    penLineStyle,
    setPenLineStyle,
  } = useDrawingStore();
  
  const { penOptions } = studyConfig.features;

  return (
    <div className="pen-toolbar-wrapper">
      {/* Row 1: Actions */}
      <div className="toolbar-row toolbar-row-main">
        <div className="toolbar-section">
          <div className="tool-options toolbar-mode-select">
            <button
              type="button"
              className={`tool-btn ${activeTool === 'pen' ? 'active' : ''}`}
              onClick={() => setActiveTool('pen')}
              title="Pen"
              aria-label="Pen"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
              </svg>
            </button>
            <div
              className={`pen-line-style-group${activeTool === 'pen' ? '' : ' pen-line-style-group--idle'}`}
              role="group"
              aria-label="Pen line style"
            >
              <button
                type="button"
                className={`tool-btn pen-line-style-btn ${penLineStyle === 'solid' ? 'active' : ''}`}
                onClick={() => setPenLineStyle('solid')}
                disabled={activeTool !== 'pen'}
                title="Solid pen stroke"
                aria-label="Solid line"
                aria-pressed={penLineStyle === 'solid'}
              >
                <svg viewBox="0 0 24 8" width="22" height="10" fill="currentColor" aria-hidden>
                  <rect x="1" y="3" width="22" height="2" rx="0.5" />
                </svg>
              </button>
              <button
                type="button"
                className={`tool-btn pen-line-style-btn ${penLineStyle === 'dashed' ? 'active' : ''}`}
                onClick={() => setPenLineStyle('dashed')}
                disabled={activeTool !== 'pen'}
                title="Dashed pen stroke"
                aria-label="Dashed line"
                aria-pressed={penLineStyle === 'dashed'}
              >
                <svg viewBox="0 0 24 8" width="22" height="10" fill="currentColor" aria-hidden>
                  <rect x="1" y="3" width="4" height="2" rx="0.5" />
                  <rect x="8" y="3" width="4" height="2" rx="0.5" />
                  <rect x="15" y="3" width="4" height="2" rx="0.5" />
                </svg>
              </button>
            </div>
            <button
              type="button"
              className={`tool-btn ${activeTool === 'rect' ? 'active' : ''}`}
              onClick={() => setActiveTool('rect')}
              title="Rectangle highlight"
              aria-label="Rectangle highlight"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
                {/* Outer frame + inner fill (like the filled body on the eraser icon, not the eraser shape). */}
                <rect
                  x="4"
                  y="2"
                  width="16"
                  height="20"
                  rx="1"
                  fill="currentColor"
                  opacity="0.38"
                />
                <rect
                  x="4"
                  y="2"
                  width="16"
                  height="20"
                  rx="1"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              </svg>
            </button>
            <button
              type="button"
              className={`tool-btn ${activeTool === 'eraser' ? 'active' : ''}`}
              onClick={() => setActiveTool('eraser')}
              title="Eraser"
              aria-label="Eraser"
            >
              <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden>
                <path d="M8.086 2.386a.752.752 0 0 0-1.063 0l-5.25 5.25a.75.75 0 0 0 0 1.063l6.25 6.25a.75.75 0 0 0 1.063 0l5.25-5.25a.75.75 0 0 0 0-1.063l-6.25-6.25zM15.25 9.75l-5.25 5.25-5.25-5.25L10 4.5l5.25 5.25z" />
              </svg>
            </button>
          </div>
          <button className="toolbar-btn" onClick={onUndo} title="Undo">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/>
            </svg>
          </button>
          <button className="toolbar-btn" onClick={onRedo} title="Redo">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z"/>
            </svg>
          </button>
          <button className="toolbar-btn toolbar-btn-danger" onClick={onClear} title="Clear all">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </div>

        {/* Color: always reserve width when customizable so pen ↔ eraser doesn’t reflow the row */}
        {allowCustomization && (
          <div
            className={`toolbar-section toolbar-section-colors${
              activeTool === 'pen' || activeTool === 'rect' ? '' : ' toolbar-section-colors--idle'
            }`}
            aria-hidden={activeTool !== 'pen' && activeTool !== 'rect'}
          >
            <span className="toolbar-label">Color:</span>
            <div className="color-options">
              {penOptions.colors.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`color-btn ${config.color === color ? 'active' : ''}`}
                  style={{ backgroundColor: color }}
                  onClick={() => setColor(color)}
                  title={color}
                  disabled={activeTool !== 'pen' && activeTool !== 'rect'}
                  tabIndex={activeTool === 'pen' || activeTool === 'rect' ? undefined : -1}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Instruction copy for these drawing tools + ChartCanvas; same module as PenToolbar. */
export function DrawingToolInstructions() {
  return (
    <div className="canvas-instruction">
      <ul className="canvas-instruction-list">
        <li>
          <strong>Pen:</strong> Drag to draw a line. Hold the <strong>Shift</strong> key to make straight lines.
          Line can be either <strong>Solid</strong> or <strong>Dashed</strong>
        </li>
        <li>
          <strong>Rectangle:</strong> Drag on the chart to add a semi-transparent highlight over an area.
        </li>
        <li>
          <strong>Eraser:</strong> Drag over pen strokes or rectangle highlights; overlapping marks are removed.
        </li>
        <li>
          <strong>Color:</strong> Change the pen and rectangle color.
        </li>
        <li>
          <strong>Undo / Clear:</strong> Undo or redo the last action. Click the X to clear all drawings.
        </li>
      </ul>
    </div>
  );
}
