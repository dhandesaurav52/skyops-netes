import dotenv from 'dotenv';
import { z } from 'zod';
import fallbackConfig from '../firebase-applet-config.json';

dotenv.config();

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  SKYOPS_SERVER_URL: z.string().optional(),
  SKYOPS_API_URL: z.string().optional(),
  APP_URL: z.string().optional(),
  SKYOPS_DATA_DIR: z.string().optional(),
  PERSISTENCE_PROVIDER: z.enum(['firestore', 'memory']).default('firestore'),
  SKYOPS_FIRESTORE_PROJECT_ID: z.string().optional(),
  SKYOPS_FIRESTORE_DATABASE_ID: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_TRUSTED_PROJECT_IDS: z.string().optional(),
  CORS_ORIGINS: z.string().optional(),
  ENABLE_DEV_SIMULATION: z
    .string()
    .optional()
    .transform((val) => val === 'true' || val === '1'),
  SKYOPS_ALLOW_DEMO_AUTH: z
    .string()
    .optional()
    .transform((val) => {
      if (process.env.NODE_ENV !== 'production') return true;
      return val === 'true' || val === '1';
    }),
  AGENT_MIN_COMPATIBLE_VERSION: z.string().default('1.0.0'),
  AGENT_RECOMMENDED_VERSION: z.string().default('1.5.1'),
  DEFAULT_PAGE_SIZE: z.coerce.number().default(20),
  MAX_PAGE_SIZE: z.coerce.number().default(100),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  SKYOPS_NOTIFICATION_SENDER_EMAIL: z.string().default('skyopsnetes2000@gmail.com'),
  SKYOPS_NOTIFICATION_SENDER_NAME: z.string().default('SkyOps'),
  SKYOPS_SMTP_HOST: z.string().optional(),
  SKYOPS_SMTP_PORT: z.coerce.number().optional(),
  SKYOPS_SMTP_SECURE: z
    .string()
    .optional()
    .transform((val) => val === 'true' || val === '1'),
  SKYOPS_SMTP_USER: z.string().optional(),
  SKYOPS_SMTP_PASS: z.string().optional(),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  SKYOPS_STORAGE_BUCKET: z.string().optional(),
  FIREBASE_STORAGE_BUCKET: z.string().optional()
}).superRefine((values, ctx) => {
  if (values.NODE_ENV === 'production') {
    if (!values.FIREBASE_PROJECT_ID && !values.FIREBASE_TRUSTED_PROJECT_IDS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['FIREBASE_PROJECT_ID'], message: 'FIREBASE_PROJECT_ID or FIREBASE_TRUSTED_PROJECT_IDS is required in production' });
    }
    if (!values.APP_URL || !/^https:\/\//.test(values.APP_URL)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['APP_URL'], message: 'APP_URL must be an HTTPS URL in production' });
    }
    if (!values.CORS_ORIGINS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['CORS_ORIGINS'], message: 'CORS_ORIGINS is required in production' });
    }
    if (values.PERSISTENCE_PROVIDER !== 'firestore') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PERSISTENCE_PROVIDER'],
        message: 'PERSISTENCE_PROVIDER must be firestore in production'
      });
    }
    if (!values.SKYOPS_FIRESTORE_PROJECT_ID && !values.FIREBASE_PROJECT_ID && !values.FIREBASE_TRUSTED_PROJECT_IDS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SKYOPS_FIRESTORE_PROJECT_ID'],
        message: 'A Firestore project must be configured in production'
      });
    }
    if (!values.RAZORPAY_KEY_ID || !values.RAZORPAY_KEY_SECRET || !values.RAZORPAY_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RAZORPAY_KEY_ID'],
        message: 'Razorpay live credentials and webhook secret are required in production for real billing'
      });
    }
  }
});

export type SkyOpsConfig = z.infer<typeof ConfigSchema>;

let parsedConfig: SkyOpsConfig;

try {
  parsedConfig = ConfigSchema.parse({
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    SKYOPS_SERVER_URL: process.env.SKYOPS_SERVER_URL,
    SKYOPS_API_URL: process.env.SKYOPS_API_URL,
    APP_URL: process.env.APP_URL,
    SKYOPS_DATA_DIR: process.env.SKYOPS_DATA_DIR,
    PERSISTENCE_PROVIDER: process.env.PERSISTENCE_PROVIDER,
    SKYOPS_FIRESTORE_PROJECT_ID: process.env.SKYOPS_FIRESTORE_PROJECT_ID,
    SKYOPS_FIRESTORE_DATABASE_ID: process.env.SKYOPS_FIRESTORE_DATABASE_ID,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    FIREBASE_PROJECT_ID:
      process.env.FIREBASE_PROJECT_ID ||
      process.env.VITE_FIREBASE_PROJECT_ID ||
      fallbackConfig.projectId ||
      'skyops-a1143',
    FIREBASE_TRUSTED_PROJECT_IDS:
      process.env.FIREBASE_TRUSTED_PROJECT_IDS ||
      fallbackConfig.projectId ||
      'skyops-a1143',
    CORS_ORIGINS: process.env.CORS_ORIGINS,
    ENABLE_DEV_SIMULATION: process.env.ENABLE_DEV_SIMULATION,
    SKYOPS_ALLOW_DEMO_AUTH: process.env.SKYOPS_ALLOW_DEMO_AUTH,
    AGENT_MIN_COMPATIBLE_VERSION: process.env.AGENT_MIN_COMPATIBLE_VERSION,
    AGENT_RECOMMENDED_VERSION: process.env.AGENT_RECOMMENDED_VERSION,
    DEFAULT_PAGE_SIZE: process.env.DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE: process.env.MAX_PAGE_SIZE,
    LOG_LEVEL: process.env.LOG_LEVEL,
    SKYOPS_NOTIFICATION_SENDER_EMAIL: process.env.SKYOPS_NOTIFICATION_SENDER_EMAIL,
    SKYOPS_NOTIFICATION_SENDER_NAME: process.env.SKYOPS_NOTIFICATION_SENDER_NAME,
    SKYOPS_SMTP_HOST: process.env.SKYOPS_SMTP_HOST,
    SKYOPS_SMTP_PORT: process.env.SKYOPS_SMTP_PORT,
    SKYOPS_SMTP_SECURE: process.env.SKYOPS_SMTP_SECURE,
    SKYOPS_SMTP_USER: process.env.SKYOPS_SMTP_USER,
    SKYOPS_SMTP_PASS: process.env.SKYOPS_SMTP_PASS,
    SKYOPS_STORAGE_BUCKET:
      process.env.SKYOPS_STORAGE_BUCKET ||
      process.env.FIREBASE_STORAGE_BUCKET ||
      process.env.VITE_FIREBASE_STORAGE_BUCKET ||
      fallbackConfig.storageBucket ||
      'skyops-a1143.firebasestorage.app',
    FIREBASE_STORAGE_BUCKET:
      process.env.FIREBASE_STORAGE_BUCKET ||
      process.env.SKYOPS_STORAGE_BUCKET ||
      process.env.VITE_FIREBASE_STORAGE_BUCKET ||
      fallbackConfig.storageBucket ||
      'skyops-a1143.firebasestorage.app'
  });
} catch (err) {
  console.error('[SkyOps Configuration] Fatal Configuration Validation Error:', err);
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SkyOps production configuration is invalid; refusing to start');
  }
  parsedConfig = {
    NODE_ENV: 'development',
    PORT: 3000,
    SKYOPS_DATA_DIR: process.env.SKYOPS_DATA_DIR,
    PERSISTENCE_PROVIDER: 'firestore',
    SKYOPS_FIRESTORE_PROJECT_ID: process.env.SKYOPS_FIRESTORE_PROJECT_ID,
    SKYOPS_FIRESTORE_DATABASE_ID: process.env.SKYOPS_FIRESTORE_DATABASE_ID,
    ENABLE_DEV_SIMULATION: process.env.NODE_ENV !== 'production',
    SKYOPS_ALLOW_DEMO_AUTH: process.env.NODE_ENV !== 'production',
    AGENT_MIN_COMPATIBLE_VERSION: '1.0.0',
    AGENT_RECOMMENDED_VERSION: '1.5.1',
    DEFAULT_PAGE_SIZE: 20,
    MAX_PAGE_SIZE: 100,
    LOG_LEVEL: 'info',
    SKYOPS_NOTIFICATION_SENDER_EMAIL: 'skyopsnetes2000@gmail.com',
    SKYOPS_NOTIFICATION_SENDER_NAME: 'SkyOps',
    CORS_ORIGINS: undefined
  };
}

export const config = parsedConfig;
export const isProduction = config.NODE_ENV === 'production';
export const isDevelopment = config.NODE_ENV === 'development';
export const isTest = config.NODE_ENV === 'test';

/**
 * Resolves canonical Firebase Cloud Storage bucket name.
 * Priority:
 * 1. SKYOPS_STORAGE_BUCKET / FIREBASE_STORAGE_BUCKET env vars
 * 2. VITE_FIREBASE_STORAGE_BUCKET
 * 3. Canonical verified project bucket: skyops-a1143.firebasestorage.app
 * Always strips any leading 'gs://' protocol scheme.
 */
export function resolveStorageBucket(): string {
  const raw =
    process.env.SKYOPS_STORAGE_BUCKET ||
    process.env.FIREBASE_STORAGE_BUCKET ||
    process.env.VITE_FIREBASE_STORAGE_BUCKET ||
    'skyops-a1143.firebasestorage.app';
  return raw.replace(/^gs:\/\//, '').trim();
}
