import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, get, onValue, push, update, remove, child, onDisconnect, serverTimestamp } from 'firebase/database';

export const firebaseConfig = {
  apiKey: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FIREBASE_API_KEY) || "AIzaSyB0rkzLs_JwqT8rQbVFDPOY07TrwxROlJ4",
  authDomain: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FIREBASE_AUTH_DOMAIN) || "yapperv2.firebaseapp.com",
  projectId: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FIREBASE_PROJECT_ID) || "yapperv2",
  storageBucket: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FIREBASE_STORAGE_BUCKET) || "yapperv2.firebasestorage.app",
  messagingSenderId: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FIREBASE_MESSAGING_SENDER_ID) || "615210362139",
  appId: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FIREBASE_APP_ID) || "1:615210362139:web:d1c415c30b34896e36dfbe",
  measurementId: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FIREBASE_MEASUREMENT_ID) || "G-BZ5H0BHZC8",
  databaseURL: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FIREBASE_DATABASE_URL) || "https://yapperv2-default-rtdb.firebaseio.com"
};

export const app = initializeApp(firebaseConfig);
export const rtdb = getDatabase(app);
export { ref, set, get, onValue, push, update, remove, child, onDisconnect, serverTimestamp };
