import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { AuditLog } from '../modules/audit/auditLog.model.js';
import { User } from '../modules/auth/user.model.js';

const rawPhone = process.argv[2]?.trim() ?? '';
const phone = rawPhone.startsWith('+') ? rawPhone : `+91${rawPhone}`;

if (!/^\+91[6-9]\d{9}$/.test(phone)) {
  throw new Error('Usage: npm run seller:create -- <10-digit-Indian-mobile-or-E.164-number>');
}

try {
  await connectDatabase();
  const session = await mongoose.startSession();
  let provisionedUser;
  try {
    provisionedUser = await session.withTransaction(async () => {
      const existing = await User.findOne({ phoneE164: phone }).session(session);
      if (existing && existing.status !== 'active') {
        throw new Error('The account is disabled. Enable it through the approved account recovery process before assigning a seller role.');
      }
      if (existing && existing.role !== 'customer' && existing.role !== 'seller') {
        throw new Error(`This number already has the "${existing.role}" role. No role was changed.`);
      }

      const user = await User.findOneAndUpdate(
        { phoneE164: phone },
        { $set: { role: 'seller', status: 'active' }, $setOnInsert: { phoneE164: phone } },
        { upsert: true, new: true, session, runValidators: true, setDefaultsOnInsert: true },
      );
      if (!user) throw new Error('The seller account could not be provisioned.');
      await AuditLog.create([{
        actorType: 'system',
        action: existing?.role === 'seller' ? 'user.seller_provisioning_confirmed' : 'user.seller_provisioned',
        resourceType: 'user',
        resourceId: user.id,
        metadata: {
          ...(existing ? { previousRole: existing.role } : {}),
          role: 'seller',
          method: 'trusted_cli',
        },
      }], { session });
      return user;
    });
  } finally {
    await session.endSession();
  }
  if (!provisionedUser) throw new Error('The seller account could not be provisioned.');
  console.info('Seller account provisioned. Sign in through the OTP flow.');
} finally {
  await disconnectDatabase();
}
