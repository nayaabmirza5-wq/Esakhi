import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(5000),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  MONGODB_URI: z.string().regex(/^mongodb(?:\+srv)?:\/\//),
  CLIENT_ORIGINS: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().regex(/^[a-fA-F0-9]{128}$/, 'Use 64 random bytes encoded as 128 hex characters.'),
  JWT_REFRESH_SECRET: z.string().regex(/^[a-fA-F0-9]{128}$/, 'Use a different 64 random bytes encoded as 128 hex characters.'),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  OTP_PROVIDER: z.enum(['development', 'msg91']).default('development'),
  DEV_OTP_CODE: z.string().regex(/^\d{6}$/).optional(),
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_OTP_TEMPLATE_ID: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly']).default('info'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map(({ path, message }) => `${path.join('.')}: ${message}`);
  throw new Error(`Invalid backend environment configuration:\n${issues.join('\n')}`);
}

const config = parsed.data;
const configuredCorsOrigins = config.CLIENT_ORIGINS
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

if (configuredCorsOrigins.length === 0 || configuredCorsOrigins.some((origin) => origin === '*')) {
  throw new Error('CLIENT_ORIGINS must contain one or more explicit origins.');
}

const corsOrigins = configuredCorsOrigins.map((origin) => {
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    throw new Error('CLIENT_ORIGINS must contain valid absolute origins.');
  }

  if (parsedOrigin.origin !== origin && `${parsedOrigin.origin}/` !== origin) {
    throw new Error('CLIENT_ORIGINS must be exact origins without a path.');
  }
  if (config.NODE_ENV === 'production' && parsedOrigin.protocol !== 'https:') {
    throw new Error('CLIENT_ORIGINS must use HTTPS in production.');
  }

  return parsedOrigin.origin;
});

if (config.JWT_ACCESS_SECRET === config.JWT_REFRESH_SECRET) {
  throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different.');
}
if (config.NODE_ENV === 'production' && config.OTP_PROVIDER !== 'msg91') {
  throw new Error('Production requires OTP_PROVIDER=msg91.');
}
if (config.OTP_PROVIDER === 'development' && config.NODE_ENV === 'production') {
  throw new Error('The development OTP provider cannot run in production.');
}
if (config.OTP_PROVIDER === 'development' && config.NODE_ENV !== 'test' && !config.DEV_OTP_CODE) {
  throw new Error('DEV_OTP_CODE is required when OTP_PROVIDER=development.');
}
if (config.OTP_PROVIDER === 'msg91' && (!config.MSG91_AUTH_KEY || !config.MSG91_OTP_TEMPLATE_ID)) {
  throw new Error('MSG91_AUTH_KEY and MSG91_OTP_TEMPLATE_ID are required for MSG91 OTP.');
}

export const env = {
  ...config,
  corsOrigins,
};
