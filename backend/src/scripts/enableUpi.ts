import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { Settings } from '../modules/settings/settings.model.js';

try {
  await connectDatabase();
  const upiId = '9399716375@axl';
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(`upi://pay?pa=${upiId}&pn=eSakhi Artisans`)}`;
  const instructions = 'Scan the QR code or pay to 9399716375@axl using Google Pay, PhonePe, Paytm, BHIM, or any UPI app.';

  const result = await Settings.findOneAndUpdate(
    { key: 'global' },
    {
      $set: {
        upiEnabled: true,
        upiId,
        upiQrUrl: qrUrl,
        upiInstructions: instructions,
      },
    },
    { new: true, upsert: true }
  );

  console.info('UPI successfully enabled in settings:');
  console.info({
    upiEnabled: result.upiEnabled,
    upiId: result.upiId,
    upiQrUrl: result.upiQrUrl,
    upiInstructions: result.upiInstructions,
  });
} catch (error) {
  console.error('Failed to enable UPI:', error);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
