import { create } from 'zustand';

export const useDrawingStore = create((set, get) => ({
  // ==================== CONFIG STATE ====================
  config: {
    tool: 'pen',
    color: '#e63946',
    width: 3,
  },
  allowCustomization: true,
  
  // ==================== ACTIVITY LOG STATE ====================
  activities: [],
  trialStartTime: null,

  // ==================== ACTIONS: CONFIG ====================

  initializeFromConfig: (studyConfig) => {
    const { features } = studyConfig;
    set({
      allowCustomization: features?.allowPenCustomization ?? true,
      config: {
        tool: 'pen',
        color: features?.penDefaults?.color || '#e63946',
        width: features?.penDefaults?.width || 3,
      },
    });
  },

  setColor: (color) => {
    const { config, allowCustomization } = get();
    if (!allowCustomization) return;
    
    get().logActivity('color_change', { 
      previousColor: config.color, 
      newColor: color 
    });
    set({ config: { ...config, color } });
  },

  setWidth: (width) => {
    const { config, allowCustomization } = get();
    if (!allowCustomization) return;
    
    get().logActivity('width_change', { 
      previousWidth: config.width, 
      newWidth: width 
    });
    set({ config: { ...config, width } });
  },

  // ==================== ACTIONS: TRIAL ====================

  startNewTrial: () => {
    set({
      activities: [],
      trialStartTime: Date.now(),
    });
  },

  // ==================== ACTIONS: ACTIVITY LOGGING ====================

  logActivity: (type, data = {}) => {
    const { trialStartTime, config } = get();
    const now = Date.now();

    const activity = {
      type,
      timestamp: now,
      relativeTime: trialStartTime ? now - trialStartTime : 0,
      data: { ...data, color: config.color, width: config.width },
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

  getActivities: () => get().activities,

  getStats: () => {
    const { trialStartTime, activities } = get();
    
    // Calculate from activities
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
      config: { tool: 'pen', color: '#e63946', width: 3 },
      allowCustomization: true,
      activities: [],
      trialStartTime: null,
    });
  },
}));
