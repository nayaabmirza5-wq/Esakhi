import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';
import { NotificationEvent } from '../modules/notifications/notificationEvent.model.js';
import { PushToken } from '../modules/notifications/pushToken.model.js';

let connectionPromise: Promise<void> | null = null;

export async function connectDatabase(): Promise<void> {
  if (mongoose.connection.readyState === 1) {
    return;
  }
  if (!connectionPromise) {
    connectionPromise = mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10_000,
    }).then(async () => {
      await Promise.all([NotificationEvent.init(), PushToken.init()]).catch((err) => {
        logger.warn('Index init warning', { error: String(err) });
      });
      logger.info('MongoDB connected');
    }).catch((err) => {
      connectionPromise = null;
      throw err;
    });
  }
  await connectionPromise;
}

export async function disconnectDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    connectionPromise = null;
  }
}
