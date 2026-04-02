import { create } from 'zustand';

export const useDrawingStore = create((set, get) => ({
  // ==================== TOOL STATE ====================
  activeTool: 'pen', // 'pen' | 'arrow' | 'hline' | 'vline' | 'bbox' | 'highlight' | 'bracket'
  
  // ==================== CONFIG ====================
  config: {
    color: '#000000',
    width: 3,
  },
  allowCustomization: true,
  
  // ==================== TOOL OPTIONS ====================
  toolOptions: {
    lineStyle: 'solid', // 'solid' | 'dashed'
    arrowDirection: 'single', // 'single' | 'double'
    arrowShape: 'straight', // 'straight' | 'curved'
    fontSize: 18, // text tool font size
  },
  
  // ==================== ACTIVITY LOG STATE ====================
  activities: [],
  trialStartTime: null,

  // ==================== ACTIONS: TOOL ====================
  
  setActiveTool: (tool) => {
    get().logActivity('tool_change', { newTool: tool });
    set({ activeTool: tool });
  },
  
  setToolOption: (key, value) => {
    get().logActivity('tool_option_change', { option: key, newValue: value });
    set((state) => ({
      toolOptions: { ...state.toolOptions, [key]: value },
    }));
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
      activeTool: 'pen',
      toolOptions: {
        lineStyle: 'solid',
        arrowDirection: 'single',
        arrowShape: 'straight',
        fontSize: 18,
      },
    });
  },

  // ==================== ACTIONS: ACTIVITY LOGGING ====================

  logActivity: (type, data = {}) => {
    const { trialStartTime, config, activeTool, toolOptions } = get();
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
        toolOptions: activeTool !== 'pen' ? toolOptions : null,
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
  
  onShapeCreated: (shapeType, shapeData = {}) => {
    get().logActivity('shape_created', { shapeType, ...shapeData });
  },

  onUndo: () => {
    get().logActivity('undo');
  },

  onClear: () => {
    get().logActivity('clear');
  },

  // ==================== GETTERS ====================

  getActivities: () => {
    // Replay undo/clear to return only effective (not deleted) activities
    const { activities } = get();
    const stack = [];
    for (const activity of activities) {
      if (activity.type === 'clear') {
        stack.length = 0;
      } else if (activity.type === 'undo') {
        // Remove last stroke_end or shape_created
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i].type === 'stroke_end' || stack[i].type === 'shape_created' || stack[i].type === 'stroke_start') {
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
    let shapeCount = 0;
    
    for (const activity of activities) {
      if (activity.type === 'stroke_end') {
        strokeCount++;
        totalPathLength += activity.data?.pathLength || 0;
      } else if (activity.type === 'shape_created') {
        shapeCount++;
      } else if (activity.type === 'undo' && strokeCount > 0) {
        strokeCount--;
      } else if (activity.type === 'clear') {
        strokeCount = 0;
        totalPathLength = 0;
        shapeCount = 0;
      }
    }

    return {
      strokeCount,
      totalPathLength,
      shapeCount,
      trialDurationMs: trialStartTime ? Date.now() - trialStartTime : 0,
    };
  },

  reset: () => {
    set({
      activeTool: 'pen',
      config: { color: '#000000', width: 3 },
      allowCustomization: true,
      toolOptions: {
        lineStyle: 'solid',
        arrowDirection: 'single',
        arrowShape: 'straight',
        fontSize: 18,
      },
      activities: [],
      trialStartTime: null,
    });
  },
}));
