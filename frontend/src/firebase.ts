import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, RecaptchaVerifier, signInWithPhoneNumber, type ConfirmationResult } from 'firebase/auth';

const VALID_API_KEY = 'AIzaSyA5wXayHYIW9SO0bFhekLVWo6E18Hz88nY';
const rawApiKey = import.meta.env.VITE_FIREBASE_API_KEY;

// Sanitize if empty or if set to the typo variant (lowercase x, double-zero 00, lowercase f)
const apiKey = (!rawApiKey || rawApiKey === 'AIzaSyA5wxayHYIW9S00bfhekLVWo6E18Hz88nY')
  ? VALID_API_KEY
  : rawApiKey;

export const firebaseConfig = {
  apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'shg-marketplace.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'shg-marketplace',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'shg-marketplace.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '983602794777',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:983602794777:web:69a479d42c8b89d33ef588',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || '',
};

export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export { RecaptchaVerifier, signInWithPhoneNumber };
export type { ConfirmationResult };
export default app;
