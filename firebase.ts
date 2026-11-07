import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, get, onValue, push, update, remove, child, onDisconnect, serverTimestamp } from 'firebase/database';

export const firebaseConfig = {
  apiKey: "AIzaSyB0rkzLs_JwqT8rQbVFDPOY07TrwxROlJ4",
  authDomain: "yapperv2.firebaseapp.com",
  projectId: "yapperv2",
  storageBucket: "yapperv2.firebasestorage.app",
  messagingSenderId: "615210362139",
  appId: "1:615210362139:web:d1c415c30b34896e36dfbe",
  measurementId: "G-BZ5H0BHZC8",
  databaseURL: "https://yapperv2-default-rtdb.firebaseio.com"
};

export const app = initializeApp(firebaseConfig);
export const rtdb = getDatabase(app);
export { ref, set, get, onValue, push, update, remove, child, onDisconnect, serverTimestamp };
