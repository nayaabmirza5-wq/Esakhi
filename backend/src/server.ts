import { createServer } from 'node:http';
import { app } from './app.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { releaseExpiredReservations } from './modules/orders/reservation.worker.js';
import { processOrderNotificationQueue } from './modules/notifications/notification.worker.js';
import { firebaseMessaging, isFirebaseAdminConfigured } from './modules/notifications/firebaseAdmin.js';

const server = createServer(app);
let reservationTimer: NodeJS.Timeout | undefined;

async function start(): Promise<void> {
  if (isFirebaseAdminConfigured()) firebaseMessaging();
  await connectDatabase();
  await releaseExpiredReservations();
  await processOrderNotificationQueue();
  reservationTimer = setInterval(() => {
    void releaseExpiredReservations().catch((error: unknown) => {
      logger.error('Reservation cleanup failed', {
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    });
    void processOrderNotificationQueue().catch((error: unknown) => {
      logger.error('Order notification processing failed', {
        name: error instanceof Error ? error.name : 'Unknown error',
      });
    });
  }, 60_000);
  server.listen(env.PORT, () => logger.info('eSakhi API listening', { port: env.PORT }));
}

async function shutdown(signal: string): Promise<void> {
  logger.info('Shutdown requested', { signal });
  if (reservationTimer) clearInterval(reservationTimer);
  server.close(async (error) => {
    if (error) {
      logger.error('HTTP server failed to close cleanly', { name: error.name });
      process.exitCode = 1;
    }
    await disconnectDatabase();
  });
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

start().catch(async (error: unknown) => {
  logger.error('Backend startup failed', {
    name: error instanceof Error ? error.name : 'Unknown startup error',
    message: error instanceof Error ? error.message : 'Unknown startup error',
  });
  await disconnectDatabase();
  process.exitCode = 1;
});
