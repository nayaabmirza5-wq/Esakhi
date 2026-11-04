import type { RequestHandler } from 'express';
import { env } from '../../config/env.js';
import { sendData } from '../../utils/apiResponse.js';
import { requestOtpSchema, verifyOtpSchema, firebaseLoginSchema } from './auth.schemas.js';
import { replaceSavedAddressesSchema, updateProfileSchema } from './auth.schemas.js';
import { issueSession, requestOtp, revokeSession, rotateSession, verifyOtp, firebaseLogin } from './auth.service.js';
import { User } from './user.model.js';
import type { SavedAddressRecord } from './user.model.js';
import { authenticatedUserId } from '../../utils/authenticatedUser.js';
import { AppError } from '../../utils/AppError.js';
import {
  addressIdParamsSchema,
  addressReverseQuerySchema,
  addressSearchQuerySchema,
  savedAddressSchema,
} from './auth.schemas.js';
import { searchAddress, reverseAddress } from './geocoding.service.js';

function formattedAddress(address: {
  houseNumber?: string | null | undefined;
  street?: string | null | undefined;
  area?: string | null | undefined;
  landmark?: string | null | undefined;
  villageOrCity?: string | null | undefined;
  district?: string | null | undefined;
  state?: string | null | undefined;
  postalCode?: string | null | undefined;
}): string {
  return [
    address.houseNumber,
    address.street,
    address.area,
    address.landmark ? `Near ${address.landmark}` : undefined,
    address.villageOrCity,
    address.district,
    address.state,
    address.postalCode,
  ].filter(Boolean).join(', ');
}

function addressResponse(address: SavedAddressRecord & { _id: { toString(): string } }) {
  return {
    id: address._id.toString(),
    label: address.label,
    name: address.name,
    phone: address.phoneE164,
    addressLine1: address.addressLine1,
    ...(address.addressLine2 ? { addressLine2: address.addressLine2 } : {}),
    locality: address.locality,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
    ...(address.houseNumber ? { houseNumber: address.houseNumber } : {}),
    ...(address.street ? { street: address.street } : {}),
    ...(address.area ? { area: address.area } : {}),
    ...(address.landmark ? { landmark: address.landmark } : {}),
    ...(address.villageOrCity ? { villageOrCity: address.villageOrCity } : {}),
    ...(address.district ? { district: address.district } : {}),
    ...(address.formattedAddress ? { formattedAddress: address.formattedAddress } : {}),
    ...(address.latitude !== undefined && address.latitude !== null ? { latitude: address.latitude } : {}),
    ...(address.longitude !== undefined && address.longitude !== null ? { longitude: address.longitude } : {}),
    ...(address.locationAccuracyMeters !== undefined && address.locationAccuracyMeters !== null ? { locationAccuracyMeters: address.locationAccuracyMeters } : {}),
    ...(address.deliveryInstructions ? { deliveryInstructions: address.deliveryInstructions } : {}),
    isDefault: address.isDefault,
  };
}

const refreshCookieName = 'esakhi_refresh';
const refreshCookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/api/v1/auth',
  maxAge: env.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
};

export const requestOtpController: RequestHandler = async (req, res, next) => {
  try {
    const { phone } = requestOtpSchema.parse(req.body);
    await requestOtp(phone);
    sendData(res, { message: 'If the number can receive a code, one has been sent.' }, 202);
  } catch (error) {
    console.error("[OTP_REQUEST_FAILURE]:", error);
    next(error);
  }
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
    savedAddresses: user.savedAddresses.map(addressResponse),
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
    savedAddresses: user.savedAddresses.map(addressResponse),
  });
};

export const replaceSavedAddressesController: RequestHandler = async (req, res) => {
  const { addresses } = replaceSavedAddressesSchema.parse(req.body);
  for (const address of addresses) {
    if ((address.latitude === undefined) !== (address.longitude === undefined)
        || (address.locationAccuracyMeters !== undefined && address.latitude === undefined)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'A map pin requires both coordinates, and accuracy requires a confirmed pin.');
    }
  }
  const defaultAddressIndex = addresses.findIndex((address) => address.isDefault);
  const user = await User.findById(authenticatedUserId(req)).select('savedAddresses');
  if (!user) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found.' } });
    return;
  }
  const locationFields = [
    'addressLine1', 'addressLine2', 'locality', 'city', 'state', 'postalCode',
    'houseNumber', 'street', 'area', 'landmark', 'villageOrCity', 'district',
  ] as const;
  const nextAddresses = addresses.map(({ id, phone, ...address }, index) => {
    const existing = id ? user.savedAddresses.id(id) : undefined;
    if (id && !existing) throw new AppError(404, 'NOT_FOUND', 'Saved address not found.');
    const locationChanged = existing
      ? locationFields.some((key) => address[key] !== existing.get(key))
      : false;
    const coordinatesMatch = existing
      && address.latitude === existing.latitude
      && address.longitude === existing.longitude;
    const hasConfirmedInputPin = address.latitude !== undefined && address.longitude !== undefined
      && !(locationChanged && coordinatesMatch);
    const reuseExistingPin = Boolean(existing && !locationChanged && address.latitude === undefined
      && existing.latitude !== undefined && existing.longitude !== undefined);
    const keepPin = hasConfirmedInputPin || reuseExistingPin;
    const resolved = {
      ...address,
      addressLine1: address.addressLine1 || [address.houseNumber, address.street, address.area].filter(Boolean).join(', '),
      phoneE164: phone,
      isDefault: defaultAddressIndex < 0 ? index === 0 : index === defaultAddressIndex,
      formattedAddress: formattedAddress(address),
      ...(hasConfirmedInputPin ? {} : reuseExistingPin ? {
        latitude: existing?.latitude,
        longitude: existing?.longitude,
        locationAccuracyMeters: existing?.locationAccuracyMeters,
      } : {}),
      ...(keepPin ? {} : { latitude: undefined, longitude: undefined, locationAccuracyMeters: undefined }),
    };
    if (!resolved.addressLine1) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Enter a house, street, or area for the delivery address.');
    }
    return { ...(id ? { _id: id } : {}), ...resolved };
  });
  user.set('savedAddresses', nextAddresses);
  await user.save();
  sendData(res, user.savedAddresses.map(addressResponse));
};

export const listSavedAddressesController: RequestHandler = async (req, res) => {
  const user = await User.findById(authenticatedUserId(req)).select('savedAddresses');
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found.');
  sendData(res, user.savedAddresses.map(addressResponse));
};

export const createSavedAddressController: RequestHandler = async (req, res) => {
  const input = savedAddressSchema.omit({ id: true }).parse(req.body);
  const user = await User.findById(authenticatedUserId(req)).select('savedAddresses');
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found.');
  if (user.savedAddresses.length >= 10) {
    throw new AppError(400, 'ADDRESS_LIMIT_REACHED', 'You can save up to 10 addresses.');
  }
  const { phone, ...addressInput } = input;
  const address = {
    ...addressInput,
    phoneE164: phone,
    addressLine1: input.addressLine1 || [input.houseNumber, input.street, input.area].filter(Boolean).join(', '),
    formattedAddress: formattedAddress(input),
    ...(user.savedAddresses.length === 0 || input.isDefault ? { isDefault: true } : {}),
  };
  if ((input.latitude === undefined) !== (input.longitude === undefined)
      || (input.locationAccuracyMeters !== undefined && input.latitude === undefined)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'A map pin requires both coordinates, and accuracy requires a confirmed pin.');
  }
  if (!address.addressLine1) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Enter a house, street, or area for the delivery address.');
  }
  if (address.isDefault) user.savedAddresses.forEach((existing) => { existing.isDefault = false; });
  const createdAddress = user.savedAddresses.create(address);
  user.savedAddresses.push(createdAddress);
  await user.save();
  sendData(res, addressResponse(createdAddress), 201);
};

export const updateSavedAddressController: RequestHandler = async (req, res) => {
  const { addressId } = addressIdParamsSchema.parse(req.params);
  const input = savedAddressSchema.omit({ id: true }).partial().parse(req.body);
  const user = await User.findById(authenticatedUserId(req)).select('savedAddresses');
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found.');
  const address = user.savedAddresses.id(addressId);
  if (!address) throw new AppError(404, 'NOT_FOUND', 'Saved address not found.');

  const locationFields: (keyof typeof input)[] = [
    'addressLine1', 'addressLine2', 'locality', 'city', 'state', 'postalCode',
    'houseNumber', 'street', 'area', 'landmark', 'villageOrCity', 'district',
  ];
  const addressChanged = locationFields.some((key) => input[key] !== undefined && input[key] !== address.get(key));
  const coordinatesChanged = input.latitude !== undefined || input.longitude !== undefined;
  if ((input.latitude === undefined) !== (input.longitude === undefined)
      || (input.locationAccuracyMeters !== undefined && input.latitude === undefined)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'A map pin requires both coordinates, and accuracy requires a confirmed pin.');
  }
  const { phone, ...addressUpdates } = input;
  Object.assign(address, addressUpdates);
  if (phone !== undefined) address.phoneE164 = phone;
  if (addressChanged && (!coordinatesChanged || (input.latitude === address.latitude && input.longitude === address.longitude))) {
    address.set({
      latitude: undefined,
      longitude: undefined,
      locationAccuracyMeters: undefined,
      formattedAddress: undefined,
    });
  } else if (coordinatesChanged) {
    address.formattedAddress = formattedAddress(address);
  }
  address.addressLine1 = [address.houseNumber, address.street, address.area].filter(Boolean).join(', ')
    || input.addressLine1
    || address.addressLine1;
  if (!address.addressLine1) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Enter a house, street, or area for the delivery address.');
  }
  if (input.isDefault) user.savedAddresses.forEach((existing) => { existing.isDefault = existing._id.equals(address._id); });
  await user.save();
  sendData(res, addressResponse(address));
};

export const deleteSavedAddressController: RequestHandler = async (req, res) => {
  const { addressId } = addressIdParamsSchema.parse(req.params);
  const user = await User.findById(authenticatedUserId(req)).select('savedAddresses');
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found.');
  const address = user.savedAddresses.id(addressId);
  if (!address) throw new AppError(404, 'NOT_FOUND', 'Saved address not found.');
  const wasDefault = address.isDefault;
  address.deleteOne();
  if (wasDefault && user.savedAddresses.length > 0) {
    const newDefault = user.savedAddresses[0];
    if (newDefault) newDefault.isDefault = true;
  }
  await user.save();
  sendData(res, { deleted: true });
};

export const setDefaultSavedAddressController: RequestHandler = async (req, res) => {
  const { addressId } = addressIdParamsSchema.parse(req.params);
  const user = await User.findById(authenticatedUserId(req)).select('savedAddresses');
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found.');
  const address = user.savedAddresses.id(addressId);
  if (!address) throw new AppError(404, 'NOT_FOUND', 'Saved address not found.');
  user.savedAddresses.forEach((existing) => { existing.isDefault = existing._id.equals(address._id); });
  await user.save();
  sendData(res, addressResponse(address));
};

export const searchAddressController: RequestHandler = async (req, res) => {
  const { q } = addressSearchQuerySchema.parse(req.query);
  sendData(res, await searchAddress(q));
};

export const reverseAddressController: RequestHandler = async (req, res) => {
  const coordinates = addressReverseQuerySchema.parse(req.query);
  sendData(res, await reverseAddress(coordinates.latitude, coordinates.longitude));
};
export const firebaseLoginController: RequestHandler = async (req, res, next) => {
  try {
    const { idToken, role } = firebaseLoginSchema.parse(req.body);
    const result = await firebaseLogin(idToken, role);
    res.cookie(refreshCookieName, result.refreshToken, refreshCookieOptions);
    res.status(200).json({
      success: true,
      user: result.user,
      token: result.accessToken,
      accessToken: result.accessToken,
      data: {
        accessToken: result.accessToken,
        token: result.accessToken,
        user: result.user,
      },
    });
  } catch (error) {
    console.error('[FIREBASE_LOGIN_FAILURE]:', error);
    next(error);
  }
};
