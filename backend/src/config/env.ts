import 'dotenv/config';
import { z } from 'zod';

const DEFAULT_ATLAS_URI = 'mongodb+srv://mnayaab141_db_user:2sWHcnAvTTgSckxD@cluster0.sc3agyn.mongodb.net/Esakhi?retryWrites=true&w=majority';
const DEFAULT_ACCESS_SECRET = '2eaeab1688efbfea01d62caf8d086800f502dc966864ae878463089b059a0b36a73eb1c7e2725df82920bad09fc6a9f94473aa16134fa8c2260aef54402f4bfd';
const DEFAULT_REFRESH_SECRET = 'c35f055cd9bc7233f96d60d4e27bba06d12f5f58e97afba6605ef901ee0065bb6158e677058f542323d40826d085813fbff056a32671865992fbc3b3c6cb391a';

function cleanEnvString(val: unknown): string | undefined {
  if (typeof val !== 'string') return undefined;
  const trimmed = val.trim().replace(/^["']+|["']+$/g, '').trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const sanitizedEnv: Record<string, string | undefined> = {
  ...process.env,
  NODE_ENV: cleanEnvString(process.env.NODE_ENV),
  MONGODB_URI: cleanEnvString(process.env.MONGODB_URI),
  CLIENT_ORIGINS: cleanEnvString(process.env.CLIENT_ORIGINS),
  GEOCODER_BASE_URL: cleanEnvString(process.env.GEOCODER_BASE_URL),
  JWT_ACCESS_SECRET: cleanEnvString(process.env.JWT_ACCESS_SECRET),
  JWT_REFRESH_SECRET: cleanEnvString(process.env.JWT_REFRESH_SECRET),
  OTP_PROVIDER: cleanEnvString(process.env.OTP_PROVIDER),
  DEV_OTP_CODE: cleanEnvString(process.env.DEV_OTP_CODE),
  MSG91_AUTH_KEY: cleanEnvString(process.env.MSG91_AUTH_KEY),
  MSG91_OTP_TEMPLATE_ID: cleanEnvString(process.env.MSG91_OTP_TEMPLATE_ID),
  LOG_LEVEL: cleanEnvString(process.env.LOG_LEVEL),
};

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).catch('development').default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).catch(5000).default(5000),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).catch(1).default(1),
  MONGODB_URI: z.string().regex(/^mongodb(?:\+srv)?:\/\//).catch(DEFAULT_ATLAS_URI).default(DEFAULT_ATLAS_URI),
  CLIENT_ORIGINS: z.string().default('http://localhost:5173,https://esakhi-six.vercel.app'),
  GEOCODER_BASE_URL: z.string().url().catch('https://photon.komoot.io').default('https://photon.komoot.io'),
  JWT_ACCESS_SECRET: z.string().regex(/^[a-fA-F0-9]{128}$/, 'Use 64 random bytes encoded as 128 hex characters.').catch(DEFAULT_ACCESS_SECRET).default(DEFAULT_ACCESS_SECRET),
  JWT_REFRESH_SECRET: z.string().regex(/^[a-fA-F0-9]{128}$/, 'Use a different 64 random bytes encoded as 128 hex characters.').catch(DEFAULT_REFRESH_SECRET).default(DEFAULT_REFRESH_SECRET),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(30).catch(7).default(7),
  OTP_PROVIDER: z.string().optional(),
  DEV_OTP_CODE: z.string().regex(/^\d{6}$/).catch('246810').default('246810'),
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_OTP_TEMPLATE_ID: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly']).catch('info').default('info'),
});

const parsed = envSchema.safeParse(sanitizedEnv);

if (!parsed.success) {
  const issues = parsed.error.issues.map(({ path, message }) => `${path.join('.')}: ${message}`);
  throw new Error(`Invalid backend environment configuration:\n${issues.join('\n')}`);
}

const config = parsed.data;
const configuredCorsOrigins = config.CLIENT_ORIGINS
  .split(',')
  .map((origin) => origin.trim().replace(/^["']+|["']+$/g, '').trim())
  .filter((origin) => Boolean(origin) && origin !== '*');

const corsOrigins: string[] = [];
for (const origin of configuredCorsOrigins) {
  try {
    const parsedOrigin = new URL(origin);
    corsOrigins.push(parsedOrigin.origin);
  } catch {
    // Ignore malformed origin entry rather than crashing serverless startup
  }
}
if (corsOrigins.length === 0) {
  corsOrigins.push('https://esakhi-six.vercel.app', 'http://localhost:5173');
}

// Never fail startup on OTP settings: fall back to the development provider unless MSG91 is fully configured.
const otpProvider: 'development' | 'msg91' =
  config.OTP_PROVIDER === 'msg91' && config.MSG91_AUTH_KEY && config.MSG91_OTP_TEMPLATE_ID ? 'msg91' : 'development';
if (config.NODE_ENV === 'production' && otpProvider !== 'msg91') {
  console.warn('WARNING: using the development OTP provider (fixed DEV_OTP_CODE) in production. Configure MSG91 for real users.');
}

export const env = {
  ...config,
  OTP_PROVIDER: otpProvider,
  corsOrigins,
};
