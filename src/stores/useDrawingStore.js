import { create } from 'zustand';

export const useDrawingStore = create((set, get) => ({
  // ==================== TOOL STATE ====================
  // 'pen' | 'rect' | 'eraser'
  activeTool: 'pen',

  // ==================== CONFIG ====================
  config: {
    color: '#000000',
    width: 3,
  },
  /** 'solid' | 'dashed' — freehand pen only */
  penLineStyle: 'solid',
  /** Dash gap pattern [dash, gap, ...] for fabric.Path.strokeDashArray */
  penDashPattern: [8, 5],
  allowCustomization: true,

  // ==================== ACTIVITY LOG STATE ====================
  activities: [],
  trialStartTime: null,

  // ==================== ACTIONS: TOOL ====================

  setActiveTool: (tool) => {
    get().logActivity('tool_change', { newTool: tool });
    set({ activeTool: tool });
  },

  // ==================== ACTIONS: CONFIG ====================

  initializeFromConfig: (studyConfig) => {
    const { features } = studyConfig;
    const dash = features?.penDashPattern;
    const penDashPattern =
      Array.isArray(dash) && dash.length >= 2 && dash.every((n) => typeof n === 'number' && n > 0)
        ? dash
        : [8, 5];
    const lineStyle = features?.penDefaults?.lineStyle;
    const penLineStyle = lineStyle === 'dashed' ? 'dashed' : 'solid';

    set({
      allowCustomization: features?.allowPenCustomization ?? true,
      penDashPattern,
      penLineStyle,
      config: {
        color: features?.penDefaults?.color || '#000000',
        width: features?.penDefaults?.width || 3,
      },
    });
  },

  setPenLineStyle: (style) => {
    if (style !== 'solid' && style !== 'dashed') return;
    const prev = get().penLineStyle;
    if (prev === style) return;
    get().logActivity('pen_line_style_change', { previous: prev, next: style });
    set({ penLineStyle: style });
  },

  setColor: (color) => {
    const { config, allowCustomization } = get();
    if (!allowCustomization) return;

    get().logActivity('color_change', {
      previousColor: config.color,
      newColor: color,
    });
    set({ config: { ...config, color } });
  },

  setWidth: (width) => {
    const { config, allowCustomization } = get();
    if (!allowCustomization) return;

    get().logActivity('width_change', {
      previousWidth: config.width,
      newWidth: width,
    });
    set({ config: { ...config, width } });
  },

  // ==================== ACTIONS: TRIAL ====================

  startNewTrial: () => {
    set({
      activities: [],
      trialStartTime: Date.now(),
      activeTool: 'pen',
    });
  },

  // ==================== ACTIONS: ACTIVITY LOGGING ====================

  logActivity: (type, data = {}) => {
    const { trialStartTime, config, activeTool, penLineStyle } = get();
    const now = Date.now();

    const activity = {
      type,
      timestamp: now,
      relativeTime: trialStartTime ? now - trialStartTime : 0,
      data: {
        ...data,
        color: config.color,
        width: config.width,
        activeTool,
        penLineStyle,
      },
    };

    set((state) => ({
      activities: [...state.activities, activity],
    }));
  },

  onStrokeStart: () => {
    get().logActivity('stroke_start');
  },

  onStrokeEnd: (pathLength = 0, pointCount = 0) => {
    get().logActivity('stroke_end', { pathLength, pointCount });
  },

  onUndo: () => {
    get().logActivity('undo');
  },

  onClear: () => {
    get().logActivity('clear');
  },

  // ==================== GETTERS ====================

  getActivities: () => {
    const { activities } = get();
    const stack = [];
    for (const activity of activities) {
      if (activity.type === 'clear') {
        stack.length = 0;
      } else if (activity.type === 'undo') {
        for (let i = stack.length - 1; i >= 0; i--) {
          if (
            stack[i].type === 'stroke_end' ||
            stack[i].type === 'stroke_start'
          ) {
            stack.splice(i, 1);
            break;
          }
        }
      } else {
        stack.push(activity);
      }
    }
    return stack;
  },

  getStats: () => {
    const { trialStartTime, activities } = get();

    let strokeCount = 0;
    let totalPathLength = 0;

    for (const activity of activities) {
      if (activity.type === 'stroke_end') {
        strokeCount++;
        totalPathLength += activity.data?.pathLength || 0;
      } else if (activity.type === 'undo' && strokeCount > 0) {
        strokeCount--;
      } else if (activity.type === 'clear') {
        strokeCount = 0;
        totalPathLength = 0;
      }
    }

    return {
      strokeCount,
      totalPathLength,
      trialDurationMs: trialStartTime ? Date.now() - trialStartTime : 0,
    };
  },

  reset: () => {
    set({
      activeTool: 'pen',
      penLineStyle: 'solid',
      penDashPattern: [8, 5],
      config: { color: '#000000', width: 3 },
      allowCustomization: true,
      activities: [],
      trialStartTime: null,
    });
  },
}));
