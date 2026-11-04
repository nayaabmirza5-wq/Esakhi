import { getApp, getApps, initializeApp } from 'firebase/app';
import { deleteToken, getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};
const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;

export const pushNotificationsConfigured = Boolean(
  firebaseConfig.apiKey
  && firebaseConfig.authDomain
  && firebaseConfig.projectId
  && firebaseConfig.messagingSenderId
  && firebaseConfig.appId
  && vapidKey,
);

let stopListening: (() => void) | undefined;

function configuredFirebaseApp() {
  if (!pushNotificationsConfigured) throw new Error('Order notifications are not configured for this app.');
  return getApps().length ? getApp() : initializeApp(firebaseConfig);
}

export interface ForegroundPushMessage {
  title: string;
  body: string;
}

export async function enableOrderPushNotifications(
  registerToken: (token: string) => Promise<unknown>,
  onForegroundMessage?: (message: ForegroundPushMessage) => void,
): Promise<void> {
  if (!(await isSupported())) throw new Error('This browser does not support push notifications.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Allow notifications in your browser to receive order updates.');

  const config = encodeURIComponent(JSON.stringify(firebaseConfig));
  const serviceWorkerRegistration = await navigator.serviceWorker.register(
    `/firebase-messaging-sw.js?config=${config}`,
  );
  const messaging = getMessaging(configuredFirebaseApp());
  const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration });
  if (!token) throw new Error('The browser did not provide a push notification token.');
  await registerToken(token);

  stopListening?.();
  stopListening = onMessage(messaging, async (payload) => {
    const title = payload.notification?.title ?? 'eSakhi order update';
    const options: NotificationOptions = {
      body: payload.notification?.body ?? 'Your order has a new update.',
      data: payload.data,
    };
    onForegroundMessage?.({ title, body: options.body ?? '' });
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification(title, options);
  });
}

/**
 * Best-effort registration used right after login. Never throws: unsupported browsers,
 * denied permission or a missing config simply leave notifications off.
 */
export async function autoRegisterPushNotifications(
  registerToken: (token: string) => Promise<unknown>,
  onForegroundMessage?: (message: ForegroundPushMessage) => void,
): Promise<void> {
  try {
    if (!pushNotificationsConfigured || typeof Notification === 'undefined' || Notification.permission === 'denied') return;
    await enableOrderPushNotifications(registerToken, onForegroundMessage);
  } catch (error) {
    console.warn('Push notification setup skipped:', error);
  }
}

export async function disableOrderPushNotifications(
  removeToken: (token: string) => Promise<unknown>,
): Promise<void> {
  if (!(await isSupported())) return;
  const registration = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js');
  if (!registration) return;
  const messaging = getMessaging(configuredFirebaseApp());
  const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
  if (token) await removeToken(token);
  await deleteToken(messaging);
  stopListening?.();
  stopListening = undefined;
}
