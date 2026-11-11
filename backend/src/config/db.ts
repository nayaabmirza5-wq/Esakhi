import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';
import { NotificationEvent } from '../modules/notifications/notificationEvent.model.js';
import { PushToken } from '../modules/notifications/pushToken.model.js';

const FALLBACK_ATLAS_URI =
  'mongodb+srv://mnayaab141_db_user:2sWHcnAvTTgSckxD@cluster0.sc3agyn.mongodb.net/Esakhi?retryWrites=true&w=majority';

let connectionPromise: Promise<void> | null = null;

function sanitizeMongoUri(raw: string): string {
  let uri = raw.trim().replace(/^["']+|["']+$/g, '').replace(/\s+/g, '');
  if (uri.includes('/esakhi')) {
    uri = uri.replace('/esakhi', '/Esakhi');
  }
  return uri;
}

export async function connectDatabase(): Promise<void> {
  if (mongoose.connection.readyState === 1) {
    return;
  }
  if (!connectionPromise) {
    let mongoUri = sanitizeMongoUri(process.env.MONGODB_URI || env.MONGODB_URI || FALLBACK_ATLAS_URI);
    if (
      env.NODE_ENV !== 'test' &&
      (!mongoUri || !mongoUri.includes('cluster0.sc3agyn.mongodb.net'))
    ) {
      mongoUri = FALLBACK_ATLAS_URI;
    }

    const connectWithUri = async (uri: string): Promise<void> => {
      await mongoose.connect(uri, {
        dbName: 'Esakhi',
        serverSelectionTimeoutMS: 5_000,
        maxPoolSize: 10,
      });
      void Promise.all([NotificationEvent.init(), PushToken.init()]).catch((err) => {
        logger.warn('Index init warning', { error: String(err) });
      });
      console.log('Connected to MongoDB database: Esakhi');
      logger.info('Connected to MongoDB database: Esakhi');
    };

    connectionPromise = connectWithUri(mongoUri)
      .catch(async (primaryError) => {
        if (env.NODE_ENV !== 'test' && mongoUri !== FALLBACK_ATLAS_URI) {
          logger.warn('Primary MONGODB_URI connection failed; retrying with fallback Atlas URI', {
            error: primaryError instanceof Error ? primaryError.message : String(primaryError),
          });
          await connectWithUri(FALLBACK_ATLAS_URI);
          return;
        }
        throw primaryError;
      })
      .catch((err) => {
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
