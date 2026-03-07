/**
 * Firebase sets collection initialization script
 * 
 * Usage:
 *   node scripts/init_firebase_sets.js
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
  appId: process.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Set definitions
const sets = [
  { id: "suneung_set_0", type: "suneung", captionIndex: 0, indices: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
  { id: "suneung_set_1", type: "suneung", captionIndex: 1, indices: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
  { id: "suneung_set_2", type: "suneung", captionIndex: 2, indices: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
  { id: "suneung_set_3", type: "suneung", captionIndex: 3, indices: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
];

async function initSets() {
  console.log("Initializing Firebase sets collection...");

  for (const set of sets) {
    await setDoc(doc(db, "sets", set.id), {
      type: set.type,
      captionIndex: set.captionIndex,
      indices: set.indices,
    });
    console.log(`  Created: ${set.id}`);
  }

  // Initialize assignment counter (set to 0 only if it doesn't exist)
  await setDoc(doc(db, "config", "assignment_counter"), { count: 0 }, { merge: false });
  console.log("  Created: config/assignment_counter (count: 0)");

  console.log("\n✅ Done! Sets initialized in Firebase.");
  process.exit(0);
}

initSets().catch(console.error);
