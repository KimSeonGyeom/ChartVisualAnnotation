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

// Set definitions (sliding window)
const sets = [
  { id: "set_0", indices: [1, 2, 3, 4, 5] },
  { id: "set_1", indices: [2, 3, 4, 5, 6] },
  { id: "set_2", indices: [3, 4, 5, 6, 7] },
  { id: "set_3", indices: [4, 5, 6, 7, 8] },
  { id: "set_4", indices: [5, 6, 7, 8, 9] },
  { id: "set_5", indices: [6, 7, 8, 9, 10] },
];

async function initSets() {
  console.log("Initializing Firebase sets collection...");

  for (const set of sets) {
    await setDoc(doc(db, "sets", set.id), {
      indices: set.indices,
      status: "none",  // none | collecting | collected
      assignedTo: null,
      assignedAt: null,
      completedAt: null,
    });
    console.log(`  Created: ${set.id}`);
  }

  console.log("\n✅ Done! Sets initialized in Firebase.");
  process.exit(0);
}

initSets().catch(console.error);
