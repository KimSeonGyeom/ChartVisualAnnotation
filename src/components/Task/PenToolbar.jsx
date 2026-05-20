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
    selectionColorSummary,
  } = useDrawingStore();

  const { penOptions } = studyConfig.features;
  const colorTools = ['pen', 'rect', 'text', 'select'];
  const showColors = colorTools.includes(activeTool);

  const isChipActive = (paletteColor) => {
    if (activeTool === 'select') {
      return (
        selectionColorSummary.hasSelection &&
        selectionColorSummary.uniformColor === paletteColor
      );
    }
    return config.color === paletteColor;
  };

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
                  <rect x="3" y="3" width="4" height="2" rx="0.5" />
                  <rect x="10" y="3" width="4" height="2" rx="0.5" />
                  <rect x="17" y="3" width="4" height="2" rx="0.5" />
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
              className={`tool-btn ${activeTool === 'text' ? 'active' : ''}`}
              onClick={() => setActiveTool('text')}
              title="Text box"
              aria-label="Text box"
            >
              <span className="tool-btn-letter" aria-hidden>
                T
              </span>
            </button>
            <button
              type="button"
              className={`tool-btn ${activeTool === 'select' ? 'active' : ''}`}
              onClick={() => setActiveTool('select')}
              title="Select and move"
              aria-label="Select"
            >
              <svg
                className="tool-btn-icon"
                viewBox="0 0 16 16"
                width="18"
                height="18"
                fill="currentColor"
                aria-hidden
              >
                <path
                  d="M4.7 2.7L11.7 9.2L8.4 9.6L10.2 13.3L8.8 14L7 10.3L4.9 12.3L4.7 2.7Z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Color: always reserve width when customizable so pen ↔ select doesn't reflow the row */}
        {allowCustomization && (
          <div
            className={`toolbar-section toolbar-section-colors${
              showColors ? '' : ' toolbar-section-colors--idle'
            }`}
            aria-hidden={!showColors}
          >
            <span className="toolbar-label">Color:</span>
            <div className="color-options">
              {penOptions.colors.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`color-btn ${isChipActive(color) ? 'active' : ''}`}
                  style={{ backgroundColor: color }}
                  onClick={() => setColor(color)}
                  title={color}
                  disabled={!showColors}
                  tabIndex={showColors ? undefined : -1}
                />
              ))}
            </div>
          </div>
        )}

        <div className="toolbar-section toolbar-section-actions">
          <button className="toolbar-btn" onClick={onUndo} title="Undo">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z" />
            </svg>
          </button>
          <button className="toolbar-btn" onClick={onRedo} title="Redo">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z" />
            </svg>
          </button>
          <button className="toolbar-btn toolbar-btn-danger" onClick={onClear} title="Clear all">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>
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
          <strong>Pen:</strong> Drag to draw a line. Line can be either <strong>Solid</strong> or <strong>Dashed</strong>
        </li>
        <li>
          <strong>Straight Line:</strong> Hold the <strong>Shift</strong> key to draw a straight line.
        </li>
        <li>
          <strong>Rectangle:</strong> Drag on the chart to add a semi-transparent highlight over an area.
        </li>
        <li>
          <strong>Text:</strong> Click on the chart to place a text box (max <strong>16</strong> characters).
        </li>
        <li>
          <strong>Select:</strong> Click to select items (hold <strong>Shift</strong> to select multiple). Drag to move. Click the <strong>×</strong> at the top-right corner to remove.
        </li>
        <li>
          <strong>Color:</strong> Set color for pen, rectangle, and text. In <strong>Select</strong>, pick a color to recolor the selected item(s).
        </li>
        <li>
          <strong>Undo / Redo / Clear All</strong>
        </li>
      </ul>
    </div>
  );
}
