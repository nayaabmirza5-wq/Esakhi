import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { AuditLog } from '../modules/audit/auditLog.model.js';
import { Settings } from '../modules/settings/settings.model.js';
import { User } from '../modules/auth/user.model.js';

const args = process.argv.slice(2);
const replaceExistingRole = args.includes('--replace-existing-role');
const rawPhone = args.find((argument) => argument !== '--replace-existing-role')?.trim() ?? '';
const phone = rawPhone.startsWith('+') ? rawPhone : `+91${rawPhone}`;

if (!/^\+91[6-9]\d{9}$/.test(phone)) {
  throw new Error('Usage: npm run city-admin:create -- <10-digit-Indian-mobile-or-E.164-number> [--replace-existing-role]');
}

try {
  await connectDatabase();
  const settings = await Settings.findOne({ key: 'global' }).select('city').lean();
  const assignedCity = settings?.city.trim();
  if (!assignedCity) {
    throw new Error('Configure the launch city in platform settings before provisioning a City Admin.');
  }
  const session = await mongoose.startSession();
  let provisionedUser;
  try {
    provisionedUser = await session.withTransaction(async () => {
      const existing = await User.findOne({ phoneE164: phone }).session(session);
      if (existing && existing.status !== 'active') {
        throw new Error('The account is disabled. Enable it through the approved account recovery process before assigning a City Admin role.');
      }
      const isRoleReassignment = existing !== null
        && existing.role !== 'customer'
        && existing.role !== 'city_admin';
      if (isRoleReassignment && !replaceExistingRole) {
        throw new Error('This number already has a different administrative or operational role. No role was changed.');
      }
      const user = await User.findOneAndUpdate(
        { phoneE164: phone },
        { $set: { role: 'city_admin', assignedCity, status: 'active' }, $setOnInsert: { phoneE164: phone } },
        { upsert: true, new: true, session, runValidators: true, setDefaultsOnInsert: true },
      );
      if (!user) throw new Error('The City Admin account could not be provisioned.');
      await AuditLog.create([{
        actorType: 'system',
        action: isRoleReassignment ? 'user.city_admin_role_reassigned' : 'user.city_admin_provisioned',
        resourceType: 'user',
        resourceId: user.id,
        metadata: {
          ...(existing ? { previousRole: existing.role } : {}),
          role: 'city_admin',
          assignedCity,
          method: 'trusted_cli',
        },
      }], { session });
      return user;
    });
  } finally {
    await session.endSession();
  }
  if (!provisionedUser) throw new Error('The City Admin account could not be provisioned.');
  console.info(`City Admin account provisioned for the configured city "${assignedCity}". Sign in through the OTP flow.`);
} finally {
  await disconnectDatabase();
}
