/**
 * Firebase sets collection initialization script
 *
 * Usage (from project root):
 *   node onetime_scripts/init_firebase_sets.js
 *
 * Note: Requires .env file in project root with Firebase config
 */

import 'dotenv/config';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const CHART_COUNT = 9;
const CHARTS_PER_SET = 5;
const NUM_SETS = 9;
const SLOT_TIMEOUT_MINUTES = 90;

const SET_SLOT_STATUS = {
  NOT_ASSIGNED: 'not_assigned',
  IN_PROGRESS: 'in_progress',
  DONE: 'done',
};

/** Sliding windows of 5 chart ids on 1..9 (wrap): [1..5], [2..6], …, [9,1..4]. */
function buildSetDefinitions() {
  return Array.from({ length: NUM_SETS }, (_, setIndex) => ({
    id: `set_${setIndex}`,
    charts: Array.from({ length: CHARTS_PER_SET }, (_, offset) => {
      return ((setIndex + offset) % CHART_COUNT) + 1;
    }),
  }));
}

function buildInitialSlots() {
  return Array.from({ length: NUM_SETS }, (_, setIndex) => ({
    setId: `set_${setIndex}`,
    status: SET_SLOT_STATUS.NOT_ASSIGNED,
    prolificId: null,
    assignedAt: null,
  }));
}

const sets = buildSetDefinitions();

async function initSets() {
  console.log(`Initializing ${NUM_SETS} sets (${CHARTS_PER_SET} charts each, ids 1–${CHART_COUNT})…`);

  for (const set of sets) {
    await setDoc(doc(db, 'sets', set.id), {
      charts: set.charts,
    });
    console.log(`  ${set.id}: [${set.charts.join(', ')}]`);
  }

  await setDoc(
    doc(db, 'config', 'set_slots'),
    {
      slots: buildInitialSlots(),
      slotTimeoutMinutes: SLOT_TIMEOUT_MINUTES,
    },
    { merge: false }
  );
  console.log(`  config/set_slots (${NUM_SETS} slots, all Not Assigned)`);

  console.log('\n✅ Done! Sets and set_slots initialized in Firebase.');
  process.exit(0);
}

initSets().catch(console.error);
