import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { AuditLog } from '../modules/audit/auditLog.model.js';
import { User } from '../modules/auth/user.model.js';

const rawPhone = process.argv[2]?.trim() ?? '';
const phone = rawPhone.startsWith('+') ? rawPhone : `+91${rawPhone}`;

if (!/^\+91[6-9]\d{9}$/.test(phone)) {
  throw new Error('Usage: npm run super-admin:create -- <10-digit-Indian-mobile-or-E.164-number>');
}

try {
  await connectDatabase();
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const user = await User.findOneAndUpdate(
        { phoneE164: phone },
        { $set: { role: 'super_admin', status: 'active' }, $setOnInsert: { phoneE164: phone } },
        { upsert: true, new: true, setDefaultsOnInsert: true, session },
      );
      if (!user) throw new Error('The Super Admin account could not be provisioned.');
      await AuditLog.create([{
        actorType: 'system',
        action: 'user.super_admin_provisioned',
        resourceType: 'user',
        resourceId: user.id,
        metadata: { role: 'super_admin', method: 'trusted_cli' },
      }], { session });
    });
  } finally {
    await session.endSession();
  }
  console.info('Super Admin account provisioned. Sign in through the OTP flow.');
} finally {
  await disconnectDatabase();
}
