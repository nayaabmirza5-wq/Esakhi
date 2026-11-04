import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';

const rawApiKey = import.meta.env.VITE_FIREBASE_API_KEY || '';

export const firebaseConfig = {
  apiKey: rawApiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || '',
};

export const app: FirebaseApp | null = (firebaseConfig.apiKey && firebaseConfig.projectId)
  ? (getApps().length > 0 ? getApp() : initializeApp(firebaseConfig))
  : null;

export default app;
