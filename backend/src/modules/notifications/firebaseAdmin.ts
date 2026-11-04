import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { z } from 'zod';
import { env } from '../../config/env.js';

const serviceAccountSchema = z.object({
  project_id: z.string().min(1),
  client_email: z.string().email(),
  private_key: z.string().min(1),
});

export function isFirebaseAdminConfigured(): boolean {
  return Boolean(env.FIREBASE_SERVICE_ACCOUNT_JSON);
}

export function getFirebaseAdminApp(): App {
  if (getApps().length > 0) {
    return getApps()[0]!;
  }
  if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    let credentials: unknown;
    try {
      credentials = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } catch {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON must be valid JSON.');
    }
    const serviceAccount = serviceAccountSchema.parse(credentials);
    return initializeApp({
      credential: cert({
        projectId: serviceAccount.project_id,
        clientEmail: serviceAccount.client_email,
        privateKey: serviceAccount.private_key,
      }),
      projectId: serviceAccount.project_id,
    });
  }
  return initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID || 'shg-marketplace',
  });
}

export function firebaseMessaging() {
  const app = getFirebaseAdminApp();
  return getMessaging(app);
}
