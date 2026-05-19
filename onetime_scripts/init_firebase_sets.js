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
  { id: "set_0", charts: [1, 2, 3] },
  { id: "set_1", charts: [2, 3, 4] },
];

async function initSets() {
  console.log("Initializing Firebase sets collection...");

  for (const set of sets) {
    await setDoc(doc(db, "sets", set.id), {
      charts: set.charts,
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
