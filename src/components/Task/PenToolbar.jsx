import { useDrawingStore } from '../../stores/useDrawingStore';
import studyConfig from '../../config/study.json';

export default function PenToolbar({ onUndo, onRedo, onClear }) {
  const { 
    config, 
    setColor, 
    allowCustomization,
  } = useDrawingStore();
  
  const { penOptions } = studyConfig.features;

  return (
    <div className="pen-toolbar-wrapper">
      {/* Row 1: Actions */}
      <div className="toolbar-row toolbar-row-main">
        <div className="toolbar-section">
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

        {/* Color Selection */}
        {allowCustomization && (
          <div className="toolbar-section">
            <span className="toolbar-label">Color:</span>
            <div className="color-options">
              {penOptions.colors.map((color) => (
                <button
                  key={color}
                  className={`color-btn ${config.color === color ? 'active' : ''}`}
                  style={{ backgroundColor: color }}
                  onClick={() => setColor(color)}
                  title={color}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
