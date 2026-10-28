import type { RequestHandler } from 'express';
import { env } from '../../config/env.js';
import { sendData } from '../../utils/apiResponse.js';
import { requestOtpSchema, verifyOtpSchema } from './auth.schemas.js';
import { replaceSavedAddressesSchema, updateProfileSchema } from './auth.schemas.js';
import { issueSession, requestOtp, revokeSession, rotateSession, verifyOtp } from './auth.service.js';
import { User } from './user.model.js';
import { authenticatedUserId } from '../../utils/authenticatedUser.js';

const refreshCookieName = 'esakhi_refresh';
const refreshCookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/api/v1/auth',
  maxAge: env.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
};

export const requestOtpController: RequestHandler = async (req, res) => {
  const { phone } = requestOtpSchema.parse(req.body);
  await requestOtp(phone);
  sendData(res, { message: 'If the number can receive a code, one has been sent.' }, 202);
};

export const verifyOtpController: RequestHandler = async (req, res) => {
  const { phone, code } = verifyOtpSchema.parse(req.body);
  const identity = await verifyOtp(phone, code);
  const tokens = await issueSession(identity.userId, identity.role);
  res.cookie(refreshCookieName, tokens.refreshToken, refreshCookieOptions);
  sendData(res, {
    accessToken: tokens.accessToken,
    user: { id: identity.userId, phone, role: identity.role },
  });
};

export const refreshController: RequestHandler = async (req, res) => {
  const token: unknown = req.cookies?.[refreshCookieName];
  if (typeof token !== 'string') {
    res.clearCookie(refreshCookieName, refreshCookieOptions);
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'A refresh session is required.' } });
    return;
  }
  const tokens = await rotateSession(token);
  res.cookie(refreshCookieName, tokens.refreshToken, refreshCookieOptions);
  sendData(res, { accessToken: tokens.accessToken });
};

export const logoutController: RequestHandler = async (req, res) => {
  const token: unknown = req.cookies?.[refreshCookieName];
  const refreshToken = typeof token === 'string' ? token : undefined;
  await revokeSession(refreshToken);
  res.clearCookie(refreshCookieName, refreshCookieOptions);
  sendData(res, { message: 'Signed out.' });
};

export const meController: RequestHandler = async (req, res) => {
  const user = await User.findById(req.user?.id).select('phoneE164 name email role status assignedCity savedAddresses createdAt').lean();
  if (!user) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found.' } });
    return;
  }
  sendData(res, {
    id: user._id.toString(),
    phone: user.phoneE164,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    ...(user.assignedCity ? { assignedCity: user.assignedCity } : {}),
    savedAddresses: user.savedAddresses.map((address) => ({
      id: address._id.toString(),
      label: address.label,
      name: address.name,
      phone: address.phoneE164,
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2,
      locality: address.locality,
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
    })),
  });
};

export const updateProfileController: RequestHandler = async (req, res) => {
  const { name } = updateProfileSchema.parse(req.body);
  const user = await User.findByIdAndUpdate(
    authenticatedUserId(req),
    { $set: { name } },
    { new: true, runValidators: true },
  ).select('phoneE164 name email role status assignedCity savedAddresses');
  if (!user) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found.' } });
    return;
  }
  sendData(res, {
    id: user.id,
    phone: user.phoneE164,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    ...(user.assignedCity ? { assignedCity: user.assignedCity } : {}),
    savedAddresses: user.savedAddresses.map((address) => ({
      id: address._id.toString(),
      label: address.label,
      name: address.name,
      phone: address.phoneE164,
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2,
      locality: address.locality,
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
    })),
  });
};

export const replaceSavedAddressesController: RequestHandler = async (req, res) => {
  const { addresses } = replaceSavedAddressesSchema.parse(req.body);
  const user = await User.findByIdAndUpdate(
    authenticatedUserId(req),
    {
      $set: {
        savedAddresses: addresses.map(({ id, phone, ...address }) => ({
          ...(id ? { _id: id } : {}),
          ...address,
          phoneE164: phone,
        })),
      },
    },
    { new: true, runValidators: true },
  ).select('savedAddresses');
  if (!user) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found.' } });
    return;
  }
  sendData(res, user.savedAddresses.map((address) => ({
    id: address._id.toString(),
    label: address.label,
    name: address.name,
    phone: address.phoneE164,
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2,
    locality: address.locality,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
  })));
};
