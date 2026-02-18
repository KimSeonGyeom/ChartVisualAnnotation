import { create } from 'zustand';
import { 
  collection, doc, setDoc, updateDoc, getDocs, query, where, orderBy, limit, serverTimestamp 
} from 'firebase/firestore';
import { db } from '../services/firebase';

export const useStudyStore = create((set, get) => ({
  // ==================== STATE ====================
  participant: null,
  currentTrialIndex: 0,
  trialTimings: [],
  isSubmitting: false,
  sessionDocId: null,
  consentGiven: false,
  
  // Set assignment
  assignedSet: null,  // { id: "set_0", indices: [1,2,3,4,5] }
  chartData: [],      // Contents from chartcap_data.json

  // ==================== ACTIONS: SET ASSIGNMENT ====================

  /**
   * Load chart data from public/chartcap_data.json
   */
  loadChartData: async () => {
    try {
      const response = await fetch('/chartcap_data.json');
      const data = await response.json();
      set({ chartData: data });
      return data;
    } catch (error) {
      console.error('Failed to load chart data:', error);
      throw error;
    }
  },

  /**
   * Find and assign an available set (status="none")
   */
  assignSet: async (prolificId) => {
    try {
      // Query for first available set
      const setsRef = collection(db, 'sets');
      const q = query(
        setsRef,
        where('status', '==', 'none'),
        orderBy('__name__'),
        limit(1)
      );
      
      const snapshot = await getDocs(q);
      
      if (snapshot.empty) {
        throw new Error('No available sets');
      }

      const setDoc = snapshot.docs[0];
      const setData = { id: setDoc.id, ...setDoc.data() };

      // Mark as collecting
      await updateDoc(doc(db, 'sets', setDoc.id), {
        status: 'collecting',
        assignedTo: prolificId,
        assignedAt: serverTimestamp(),
      });

      set({ assignedSet: setData });
      return setData;
    } catch (error) {
      console.error('Failed to assign set:', error);
      throw error;
    }
  },

  /**
   * Get stimuli for current set
   */
  getSetStimuli: () => {
    const { assignedSet, chartData } = get();
    if (!assignedSet || !chartData.length) return [];

    return assignedSet.indices.map((index, order) => {
      const chart = chartData.find(c => c.index === index);
      return {
        id: `trial_${order + 1}`,
        imageIndex: index,
        imageUrl: `/images/chart_${index}.png`,
        caption: chart?.caption || '',
        chartInfo: chart?.chart_info || '',
        order: order + 1,
      };
    });
  },

  /**
   * Mark set as completed
   */
  completeSet: async () => {
    const { assignedSet } = get();
    if (!assignedSet) return;

    try {
      await updateDoc(doc(db, 'sets', assignedSet.id), {
        status: 'collected',
        completedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('Failed to complete set:', error);
    }
  },

  // ==================== ACTIONS: SESSION ====================
  
  /**
   * Initialize a new session in Firebase
   */
  initializeSession: async (prolificId, studyId, sessionId, chartExperience = null) => {
    const { assignedSet } = get();
    const sessionDocId = `${prolificId}_${Date.now()}`;
    
    try {
      await setDoc(doc(db, 'sessions', sessionDocId), {
        prolificId,
        studyId,
        sessionId,
        chartExperience,
        assignedSetId: assignedSet?.id || null,
        assignedIndices: assignedSet?.indices || [],
        startedAt: serverTimestamp(),
        status: 'in_progress',
        userAgent: navigator.userAgent,
        screenSize: { 
          width: window.innerWidth, 
          height: window.innerHeight 
        },
      });

      set({
        participant: {
          prolificId,
          studyId,
          sessionId,
          startedAt: Date.now(),
        },
        sessionDocId,
        currentTrialIndex: 0,
        trialTimings: [],
      });

      return sessionDocId;
    } catch (error) {
      console.error('Failed to initialize session:', error);
      throw error;
    }
  },

  /**
   * Set consent status
   */
  setConsent: (given) => {
    set({ consentGiven: given });
  },

  // ==================== ACTIONS: TRIAL TIMING ====================

  /**
   * Start timing for a trial
   */
  startTrial: (trialId) => {
    const timing = {
      trialId,
      initTime: Date.now(),
      completionTime: null,
      durationMs: null,
    };

    set((state) => ({
      trialTimings: [...state.trialTimings, timing],
    }));
  },

  /**
   * Complete timing for a trial
   */
  completeTrial: (trialId) => {
    const now = Date.now();
    
    set((state) => ({
      trialTimings: state.trialTimings.map((t) =>
        t.trialId === trialId
          ? {
              ...t,
              completionTime: now,
              durationMs: now - t.initTime,
            }
          : t
      ),
    }));
  },

  /**
   * Move to next trial
   */
  nextTrial: () => {
    set((state) => ({
      currentTrialIndex: state.currentTrialIndex + 1,
    }));
  },

  // ==================== ACTIONS: SAVE TRIAL DATA ====================

  /**
   * Save trial data to Firebase
   */
  saveTrialData: async (trialData) => {
    const { sessionDocId } = get();
    if (!sessionDocId) throw new Error('Session not initialized');

    set({ isSubmitting: true });

    try {
      const timing = get().trialTimings.find(t => t.trialId === trialData.trialId);
      const trialDocId = `${sessionDocId}_${trialData.trialId}`;

      // Save trial document to Firestore
      await setDoc(doc(db, 'trials', trialDocId), {
        sessionId: sessionDocId,
        trialId: trialData.trialId,
        imageIndex: trialData.imageIndex,
        
        // Timing data
        timing: {
          initTime: timing?.initTime || null,
          completionTime: timing?.completionTime || null,
          durationMs: timing?.durationMs || null,
        },
        
        // Annotation data (SVG only)
        annotation: {
          svg: trialData.annotation?.svg || null,
        },
        
        // Survey responses
        responses: trialData.responses || {},
        
        // Drawing activity log (as JSON string to avoid nested arrays)
        drawingActivitiesJson: trialData.drawingActivities 
          ? JSON.stringify(trialData.drawingActivities) 
          : null,
        
        // Metadata
        strokeCount: trialData.strokeCount || 0,
        totalPathLength: trialData.totalPathLength || 0,
        
        submittedAt: serverTimestamp(),
      });

      return trialDocId;
    } catch (error) {
      console.error('Failed to save trial data:', error);
      throw error;
    } finally {
      set({ isSubmitting: false });
    }
  },

  // ==================== ACTIONS: FINALIZE SESSION ====================

  /**
   * Finalize session in Firebase
   */
  finalizeSession: async () => {
    const { sessionDocId, trialTimings } = get();
    if (!sessionDocId) return;

    try {
      await updateDoc(doc(db, 'sessions', sessionDocId), {
        status: 'completed',
        completedAt: serverTimestamp(),
        totalTrials: trialTimings.length,
        totalDurationMs: trialTimings.reduce((sum, t) => sum + (t.durationMs || 0), 0),
      });

      // Mark set as completed
      await get().completeSet();
    } catch (error) {
      console.error('Failed to finalize session:', error);
      throw error;
    }
  },

  // ==================== HELPERS ====================

  /**
   * Reset store (for testing)
   */
  reset: () => {
    set({
      participant: null,
      currentTrialIndex: 0,
      trialTimings: [],
      isSubmitting: false,
      sessionDocId: null,
      consentGiven: false,
      assignedSet: null,
      chartData: [],
    });
  },
}));
