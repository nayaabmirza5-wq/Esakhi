import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';
import { OtpChallenge } from './otpChallenge.model.js';
import { User } from './user.model.js';
import { otpProvider } from './otpProvider.js';

const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

export async function requestOtp(phoneE164: string): Promise<void> {
  const now = new Date();
  let challenge;
  try {
    challenge = await OtpChallenge.findOneAndUpdate(
      {
        phoneE164,
        $or: [
          { lastRequestedAt: { $lte: new Date(now.getTime() - 60_000) } },
          { lastRequestedAt: { $exists: false } },
        ],
      },
      {
        $set: {
          lastRequestedAt: now,
          expiresAt: new Date(now.getTime() + OTP_TTL_MS),
          attempts: 0,
        },
        $unset: { providerRequestId: 1, verificationStartedAt: 1 },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError(429, 'RATE_LIMIT_EXCEEDED', 'Request a new verification code after one minute.');
    }
    throw error;
  }
  if (!challenge) {
    throw new AppError(503, 'OTP_PROVIDER_UNAVAILABLE', 'Unable to start verification right now.');
  }

  const providerRequestId = await otpProvider.request(phoneE164);
  const providerUpdate = providerRequestId
    ? { $set: { providerRequestId } }
    : { $unset: { providerRequestId: 1 } };
  await OtpChallenge.updateOne({ _id: challenge._id, lastRequestedAt: now }, providerUpdate);
}

export async function verifyOtp(phoneE164: string, code: string): Promise<{ userId: string; role: string }> {
  const verificationStartedAt = new Date();
  const challenge = await OtpChallenge.findOneAndUpdate(
    {
      phoneE164,
      expiresAt: { $gt: new Date() },
      attempts: { $lt: MAX_OTP_ATTEMPTS },
      verificationStartedAt: { $exists: false },
    },
    { $inc: { attempts: 1 }, $set: { verificationStartedAt } },
    { new: true },
  );
  if (!challenge) {
    throw new AppError(400, 'OTP_INVALID', 'The verification code is invalid or expired.');
  }

  let verified: boolean;
  try {
    verified = await otpProvider.verify(phoneE164, challenge.providerRequestId ?? undefined, code);
  } catch (error) {
    await OtpChallenge.updateOne(
      { _id: challenge._id, verificationStartedAt },
      { $unset: { verificationStartedAt: 1 } },
    );
    throw error;
  }
  if (!verified) {
    await OtpChallenge.updateOne(
      { _id: challenge._id, verificationStartedAt },
      { $unset: { verificationStartedAt: 1 } },
    );
    throw new AppError(400, 'OTP_INVALID', 'The verification code is invalid or expired.');
  }

  const consumed = await OtpChallenge.deleteOne({
    _id: challenge._id,
    verificationStartedAt,
  });
  if (consumed.deletedCount !== 1) {
    throw new AppError(400, 'OTP_INVALID', 'The verification code is invalid or expired.');
  }
  const user = await User.findOneAndUpdate(
    { phoneE164 },
    { $setOnInsert: { phoneE164, role: 'customer', status: 'active' } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  if (!user || user.status !== 'active') {
    throw new AppError(403, 'ACCOUNT_DISABLED', 'This account is unavailable.');
  }

  return { userId: user.id, role: user.role };
}

async function buildSession(userId: string, role: string): Promise<{ accessToken: string; refreshToken: string }> {
  const accessToken = jwt.sign({ role }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    subject: userId,
    expiresIn: 15 * 60,
    issuer: 'esakhi-api',
    audience: 'esakhi-client',
  });
  const refreshToken = jwt.sign({ type: 'refresh', jti: randomUUID() }, env.JWT_REFRESH_SECRET, {
    algorithm: 'HS256',
    subject: userId,
    expiresIn: `${env.JWT_REFRESH_TTL_DAYS}d`,
    issuer: 'esakhi-api',
    audience: 'esakhi-client',
  });
  return { accessToken, refreshToken };
}

export async function issueSession(userId: string, role: string): Promise<{ accessToken: string; refreshToken: string }> {
  const session = await buildSession(userId, role);
  const refreshTokenHash = await bcrypt.hash(session.refreshToken, 12);
  const updated = await User.updateOne({ _id: userId, status: 'active' }, { $set: { refreshTokenHash } });
  if (updated.matchedCount !== 1) {
    throw new AppError(403, 'ACCOUNT_DISABLED', 'This account is unavailable.');
  }
  return session;
}

export async function rotateSession(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
  let payload: jwt.JwtPayload;
  try {
    const decoded = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET, {
      algorithms: ['HS256'],
      issuer: 'esakhi-api',
      audience: 'esakhi-client',
    });
    if (typeof decoded === 'string' || decoded.type !== 'refresh' || !decoded.sub) {
      throw new Error('Invalid refresh token payload');
    }
    payload = decoded;
  } catch {
    throw new AppError(401, 'REFRESH_TOKEN_INVALID', 'The refresh session is invalid or expired.');
  }

  const user = await User.findById(payload.sub).select('+refreshTokenHash');
  if (!user || user.status !== 'active' || !user.refreshTokenHash ||
      !(await bcrypt.compare(refreshToken, user.refreshTokenHash))) {
    throw new AppError(401, 'REFRESH_TOKEN_INVALID', 'The refresh session is invalid or expired.');
  }

  const session = await buildSession(user.id, user.role);
  const newHash = await bcrypt.hash(session.refreshToken, 12);
  const result = await User.updateOne(
    { _id: user._id, refreshTokenHash: user.refreshTokenHash },
    { $set: { refreshTokenHash: newHash } },
  );
  if (result.modifiedCount !== 1) {
    throw new AppError(401, 'REFRESH_TOKEN_INVALID', 'The refresh session has already been rotated.');
  }
  return session;
}

export async function revokeSession(refreshToken: string | undefined): Promise<void> {
  if (!refreshToken) return;
  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET, {
      algorithms: ['HS256'],
      issuer: 'esakhi-api',
      audience: 'esakhi-client',
    });
  } catch {
    return;
  }
  if (typeof payload !== 'string' && payload.sub) {
    await User.updateOne({ _id: payload.sub }, { $unset: { refreshTokenHash: 1 } });
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}
