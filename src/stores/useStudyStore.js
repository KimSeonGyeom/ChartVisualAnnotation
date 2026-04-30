import { create } from 'zustand';
import { 
  doc, setDoc, updateDoc, getDoc, runTransaction, serverTimestamp 
} from 'firebase/firestore';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../services/firebase';

const NUM_SETS = 4; // suneung_set_0 ~ suneung_set_3

/** Main task trials only (excludes tutorial practice), matches getSetStimuli ids: trial_1, trial_2, … */
function isMainTaskTrialId(trialId) {
  return typeof trialId === 'string' && /^trial_\d+$/.test(trialId);
}

export const useStudyStore = create((set, get) => ({
  // ==================== STATE ====================
  participant: null,
  currentTrialIndex: 0,
  trialTimings: [],
  isSubmitting: false,
  sessionDocId: null,
  consentGiven: false,
  
  // Set assignment
  assignedSet: null,  // { id: "suneung_set_0", type: "suneung", captionIndex: 0, indices: [...] }
  chartData: [],      // Contents from chartcap_data.json
  suneungData: [],    // Contents from suneung_caption.json

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
   * Load suneung caption data from public/suneung_caption.json
   */
  loadSuneungData: async () => {
    try {
      const response = await fetch('/suneung_caption.json');
      const data = await response.json();
      set({ suneungData: data });
      return data;
    } catch (error) {
      console.error('Failed to load suneung data:', error);
      throw error;
    }
  },

  /**
   * Assign a set using a global counter (cycles through set_0 ~ set_3)
   */
  assignSet: async (prolificId) => {
    try {
      const counterRef = doc(db, 'config', 'assignment_counter');
      let setData;

      // Atomically increment counter and determine which set to assign
      await runTransaction(db, async (transaction) => {
        const counterSnap = await transaction.get(counterRef);
        const currentCount = counterSnap.exists() ? counterSnap.data().count : 0;
        const setIndex = currentCount % NUM_SETS;
        const setId = `suneung_set_${setIndex}`;

        const setSnap = await transaction.get(doc(db, 'sets', setId));
        if (!setSnap.exists()) {
          throw new Error(`Set ${setId} not found in Firestore`);
        }

        setData = { id: setId, ...setSnap.data() };

        transaction.set(counterRef, { count: currentCount + 1 }, { merge: true });
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
    const { assignedSet, suneungData } = get();
    if (!assignedSet || !suneungData.length) return [];

    const captionIdx = assignedSet.captionIndex ?? 0;

    return assignedSet.indices.map((index, order) => {
      const chart = suneungData.find(c => c.id === index);
      return {
        id: `trial_${order + 1}`,
        imageIndex: index,
        imageUrl: `/suneung_images/suneung${index}.png`,
        caption: chart?.captions[captionIdx] || '',
        allCaptions: chart?.captions || [],
        captionIndex: captionIdx,
        chartInfo: '',
        order: order + 1,
      };
    });
  },

  /**
   * No-op: sets are now reusable, completion is tracked via sessions
   */
  completeSet: async () => {},

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
      let annotationImageUrl = null;

      // Store annotation image in Firebase Storage (not Firestore base64)
      if (trialData.annotation?.imageData) {
        const annotationPath = `annotations/${sessionDocId}/${trialData.trialId}.jpg`;
        const annotationRef = ref(storage, annotationPath);
        await uploadString(annotationRef, trialData.annotation.imageData, 'data_url');
        annotationImageUrl = await getDownloadURL(annotationRef);
      }

      await setDoc(doc(db, 'trials', trialDocId), {
        sessionId: sessionDocId,
        trialId: trialData.trialId,
        imageIndex: trialData.imageIndex,
        
        timing: {
          initTime: timing?.initTime || null,
          completionTime: timing?.completionTime || null,
          durationMs: timing?.durationMs || null,
        },
        
        annotation: {
          imageUrl: annotationImageUrl,
        },
        
        responses: trialData.responses || {},
        
        drawingActivitiesJson: trialData.drawingActivities 
          ? JSON.stringify(trialData.drawingActivities) 
          : null,
        
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

  /**
   * Save review data to Firebase
   */
  saveReviewData: async (reviewData) => {
    const { sessionDocId } = get();
    if (!sessionDocId) throw new Error('Session not initialized');

    set({ isSubmitting: true });

    try {
      // Save a single review document for the entire session
      const reviewDocId = `${sessionDocId}_review`;

      await setDoc(doc(db, 'reviews', reviewDocId), {
        sessionId: sessionDocId,
        trials: reviewData.trials || [],
        responses: reviewData.responses || {},
        rowOrder: reviewData.rowOrder || {},
        submittedAt: serverTimestamp(),
      });

      return reviewDocId;
    } catch (error) {
      console.error('Failed to save review data:', error);
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
      const mainTrials = trialTimings.filter((t) => isMainTaskTrialId(t.trialId));
      await updateDoc(doc(db, 'sessions', sessionDocId), {
        status: 'completed',
        completedAt: serverTimestamp(),
        totalTrials: mainTrials.length,
        totalDurationMs: mainTrials.reduce((sum, t) => sum + (t.durationMs || 0), 0),
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
      suneungData: [],
    });
  },
}));
