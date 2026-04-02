import { create } from 'zustand';

export const useDrawingStore = create((set, get) => ({
  // ==================== TOOL STATE ====================
  // 'pen' | 'eraser'
  activeTool: 'pen',

  // ==================== CONFIG ====================
  config: {
    color: '#000000',
    width: 3,
  },
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
    set({
      allowCustomization: features?.allowPenCustomization ?? true,
      config: {
        color: features?.penDefaults?.color || '#000000',
        width: features?.penDefaults?.width || 3,
      },
    });
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
    const { trialStartTime, config, activeTool } = get();
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
      config: { color: '#000000', width: 3 },
      allowCustomization: true,
      activities: [],
      trialStartTime: null,
    });
  },
}));
