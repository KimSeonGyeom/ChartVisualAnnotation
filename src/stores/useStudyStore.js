import { create } from 'zustand';
import {
  doc,
  setDoc,
  updateDoc,
  runTransaction,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../services/firebase';
import studyConfig from '../config/study.json';

const NUM_SETS = 9; // Firestore `sets`: set_0 … set_8, each with 5 chart ids (1–9, sliding window)
const SET_SLOTS_DOC_ID = 'set_slots';
const SLOT_TIMEOUT_MS = 90 * 60 * 1000;

/** Firestore slot status values (UI labels: Not Assigned / In Progress / Done). */
export const SET_SLOT_STATUS = {
  NOT_ASSIGNED: 'not_assigned',
  IN_PROGRESS: 'in_progress',
  DONE: 'done',
};

export const SET_SLOT_STATUS_LABEL = {
  [SET_SLOT_STATUS.NOT_ASSIGNED]: 'Not Assigned',
  [SET_SLOT_STATUS.IN_PROGRESS]: 'In Progress',
  [SET_SLOT_STATUS.DONE]: 'Done',
};

function slotAssignedAtMs(slot) {
  const at = slot?.assignedAt;
  if (!at) return null;
  if (typeof at.toMillis === 'function') return at.toMillis();
  if (typeof at === 'number') return at;
  return null;
}

function isSlotAssignable(slot, nowMs) {
  if (slot.status === SET_SLOT_STATUS.DONE) return false;
  if (slot.status === SET_SLOT_STATUS.NOT_ASSIGNED) return true;
  if (slot.status === SET_SLOT_STATUS.IN_PROGRESS) {
    const assignedMs = slotAssignedAtMs(slot);
    if (assignedMs == null) return true;
    return nowMs - assignedMs >= SLOT_TIMEOUT_MS;
  }
  return false;
}

function normalizeSlotsArray(rawSlots) {
  if (!Array.isArray(rawSlots) || rawSlots.length !== NUM_SETS) {
    throw new Error(
      `config/${SET_SLOTS_DOC_ID} must have a "slots" array of length ${NUM_SETS}. Run onetime_scripts/init_firebase_sets.js.`
    );
  }
  return rawSlots.map((slot, index) => ({
    setId: typeof slot.setId === 'string' ? slot.setId : `set_${index}`,
    status: slot.status || SET_SLOT_STATUS.NOT_ASSIGNED,
    prolificId: slot.prolificId ?? null,
    assignedAt: slot.assignedAt ?? null,
  }));
}

// Required; no fallback — avoids loading charts from the wrong folder.
export function getChartAssetFolder() {
  const raw = studyConfig.chartAssetFolder;
  const folder = typeof raw === 'string' ? raw.trim() : '';
  if (!folder) {
    throw new Error(
      'study.json must set chartAssetFolder to a non-empty string (e.g. pilot_v3). There is no fallback folder.'
    );
  }
  return folder;
}

// Main task trials only (excludes tutorial practice), matches getSetStimuli ids: trial_1, trial_2, …
function isMainTaskTrialId(trialId) {
  return typeof trialId === 'string' && /^trial_\d+$/.test(trialId);
}

/**
 * Firestore `sets` docs: `charts` (int[]). Optional `type`.
 * Legacy docs may use `indices` instead of `charts` — we still accept that.
 */
function normalizeAssignedSetDocument(setId, raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  let charts = [];
  if (Array.isArray(d.charts) && d.charts.length > 0) {
    charts = d.charts.map((n) => Number(n));
  } else if (Array.isArray(d.indices) && d.indices.length > 0) {
    charts = d.indices.map((n) => Number(n));
  }
  if (!charts.length) {
    throw new Error(`Set ${setId} must define a non-empty "charts" array`);
  }
  const out = {
    id: setId,
    charts,
  };
  if (typeof d.type === 'string' && d.type.trim().length > 0) {
    out.type = d.type.trim();
  }
  return out;
}

export const useStudyStore = create((set, get) => ({
  // ─── STATE ───
  participant: null,
  currentTrialIndex: 0,
  trialTimings: [],
  isSubmitting: false,
  consentGiven: false,
  
  // Set assignment
  assignedSet: null,  // { id, charts, type? } — matches Firestore `sets` docs
  chartCaptions: [],  // From public/{chartAssetFolder}/caption.json

  // ─── ACTIONS: SET ASSIGNMENT ───

  // Load caption data from public/{chartAssetFolder}/caption.json
  loadChartCaptions: async () => {
    try {
      const response = await fetch(`/${getChartAssetFolder()}/caption.json`);
      const data = await response.json();
      set({ chartCaptions: data });
      return data;
    } catch (error) {
      console.error('Failed to load chart caption data:', error);
      throw error;
    }
  },

  // Claim first available set slot (not_assigned, or in_progress past 90 min timeout).
  assignSet: async (prolificId) => {
    const pid = typeof prolificId === 'string' ? prolificId.trim() : '';
    if (!pid) {
      throw new Error('Prolific ID is required for set assignment');
    }

    try {
      const slotsRef = doc(db, 'config', SET_SLOTS_DOC_ID);
      let setData;
      let assignedSetIndex = -1;

      await runTransaction(db, async (transaction) => {
        const slotsSnap = await transaction.get(slotsRef);
        if (!slotsSnap.exists()) {
          throw new Error(
            `config/${SET_SLOTS_DOC_ID} not found. Run onetime_scripts/init_firebase_sets.js.`
          );
        }

        const nowMs = Date.now();
        const slots = normalizeSlotsArray(slotsSnap.data().slots);
        let pickIndex = -1;

        for (let i = 0; i < slots.length; i += 1) {
          if (isSlotAssignable(slots[i], nowMs)) {
            pickIndex = i;
            break;
          }
        }

        if (pickIndex < 0) {
          throw new Error('No available sets');
        }

        const setId = slots[pickIndex].setId;
        const setSnap = await transaction.get(doc(db, 'sets', setId));
        if (!setSnap.exists()) {
          throw new Error(`Set ${setId} not found in Firestore`);
        }

        const nextSlots = slots.map((slot, i) => {
          if (i !== pickIndex) return slot;
          return {
            setId: slot.setId,
            status: SET_SLOT_STATUS.IN_PROGRESS,
            prolificId: pid,
            assignedAt: Timestamp.fromMillis(nowMs),
          };
        });

        setData = normalizeAssignedSetDocument(setId, setSnap.data());
        assignedSetIndex = pickIndex;
        transaction.set(slotsRef, { slots: nextSlots, slotTimeoutMinutes: 90 }, { merge: true });
      });

      set({ assignedSet: { ...setData, slotIndex: assignedSetIndex } });
      return setData;
    } catch (error) {
      console.error('Failed to assign set:', error);
      throw error;
    }
  },

  // Get stimuli for current set
  getSetStimuli: () => {
    const { assignedSet, chartCaptions } = get();
    if (!assignedSet || !chartCaptions.length) return [];

    const folder = getChartAssetFolder();

    return assignedSet.charts.map((index, order) => {
      const chart = chartCaptions.find((c) => c.id === index);
      const file = chart?.filename || `${index}.png`;
      const caption =
        chart && typeof chart.captions === 'string' ? chart.captions : '';
      return {
        id: `trial_${order + 1}`,
        imageIndex: index,
        imageUrl: `/${folder}/${file}`,
        caption,
        chartInfo: '',
        order: order + 1,
      };
    });
  },

  /** Mark the participant's set slot as Done (called from finalizeSession). */
  completeSet: async () => {
    const prolificId = get().participant?.prolificId;
    const assignedSetId = get().assignedSet?.id;
    if (!prolificId || !assignedSetId) return;

    const slotsRef = doc(db, 'config', SET_SLOTS_DOC_ID);

    await runTransaction(db, async (transaction) => {
      const slotsSnap = await transaction.get(slotsRef);
      if (!slotsSnap.exists()) return;

      const slots = normalizeSlotsArray(slotsSnap.data().slots);
      const idx = slots.findIndex((s) => s.setId === assignedSetId);
      if (idx < 0) return;

      const nextSlots = slots.map((slot, i) => {
        if (i !== idx) return slot;
        return {
          setId: slot.setId,
          status: SET_SLOT_STATUS.DONE,
          prolificId,
          assignedAt: slot.assignedAt,
        };
      });

      transaction.set(slotsRef, { slots: nextSlots }, { merge: true });
    });
  },

  // ─── ACTIONS: SESSION ───
  
  // `sessions/{prolificId}`; each trial/review stores `prolificId`.
  initializeSession: async (prolificId, studyId, chartExperience = null) => {
    const { assignedSet } = get();

    try {
      await setDoc(doc(db, 'sessions', prolificId), {
        prolificId,
        studyId,
        chartExperience,
        chartAssetFolder: getChartAssetFolder(),
        assignedSetId: assignedSet?.id || null,
        assignedSetIndex:
          typeof assignedSet?.slotIndex === 'number' ? assignedSet.slotIndex : null,
        assignedCharts: assignedSet?.charts || [],
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
          startedAt: Date.now(),
        },
        currentTrialIndex: 0,
        trialTimings: [],
      });

      return prolificId;
    } catch (error) {
      console.error('Failed to initialize session:', error);
      throw error;
    }
  },

  // Set consent status
  setConsent: (given) => {
    set({ consentGiven: given });
  },

  // ─── ACTIONS: TRIAL TIMING ───

  // Start timing for a trial
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

  // Complete timing for a trial
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

  // ─── ACTIONS: SAVE TRIAL DATA ───

  /**
   * Save trial data to Firebase
   */
  saveTrialData: async (trialData) => {
    const prolificId = get().participant?.prolificId;
    if (!prolificId) throw new Error('Session not initialized');

    set({ isSubmitting: true });

    try {
      const timing = get().trialTimings.find(t => t.trialId === trialData.trialId);
      const trialDocId = `${prolificId}_${trialData.trialId}`;
      let annotationImageUrl = null;

      // Store annotation image in Firebase Storage (not Firestore base64)
      if (trialData.annotation?.imageData) {
        const folder = getChartAssetFolder();
        const annotationPath = `${folder}/${prolificId}/${trialData.trialId}_drawing.jpg`;
        const annotationRef = ref(storage, annotationPath);
        await uploadString(annotationRef, trialData.annotation.imageData, 'data_url');
        annotationImageUrl = await getDownloadURL(annotationRef);
      }

      await setDoc(doc(db, 'trials', trialDocId), {
        prolificId,
        trialId: trialData.trialId,
        imageIndex: trialData.imageIndex,
        caption: trialData.caption ?? '',
        
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
    const prolificId = get().participant?.prolificId;
    if (!prolificId) throw new Error('Session not initialized');

    set({ isSubmitting: true });

    try {
      const reviewDocId = `${prolificId}_review`;

      await setDoc(doc(db, 'reviews', reviewDocId), {
        prolificId,
        trials: reviewData.trials || [],
        skippedTrials: reviewData.skippedTrials || [],
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

  // ─── ACTIONS: FINALIZE SESSION ───

  /**
   * Finalize session in Firebase
   */
  finalizeSession: async () => {
    const { trialTimings, participant } = get();
    const prolificId = participant?.prolificId;
    if (!prolificId) return;

    try {
      const mainTrials = trialTimings.filter((t) => isMainTaskTrialId(t.trialId));
      await updateDoc(doc(db, 'sessions', prolificId), {
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
  }
}));
