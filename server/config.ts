import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  SKYOPS_SERVER_URL: z.string().optional(),
  SKYOPS_API_URL: z.string().optional(),
  APP_URL: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  ENABLE_DEV_SIMULATION: z
    .string()
    .optional()
    .transform((val) => val === 'true' || val === '1'),
  SKYOPS_ALLOW_DEMO_AUTH: z
    .string()
    .optional()
    .transform((val) => val === 'true' || val === '1'),
  AGENT_MIN_COMPATIBLE_VERSION: z.string().default('1.0.0'),
  AGENT_RECOMMENDED_VERSION: z.string().default('1.5.0'),
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
  SKYOPS_SMTP_PASS: z.string().optional()
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
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
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
    SKYOPS_SMTP_PASS: process.env.SKYOPS_SMTP_PASS
  });
} catch (err) {
  console.error('[SkyOps Configuration] Fatal Configuration Validation Error:', err);
  // Safe defaults if parsing fails
  parsedConfig = {
    NODE_ENV: 'development',
    PORT: 3000,
    ENABLE_DEV_SIMULATION: process.env.NODE_ENV !== 'production',
    SKYOPS_ALLOW_DEMO_AUTH: process.env.NODE_ENV !== 'production',
    AGENT_MIN_COMPATIBLE_VERSION: '1.0.0',
    AGENT_RECOMMENDED_VERSION: '1.5.0',
    DEFAULT_PAGE_SIZE: 20,
    MAX_PAGE_SIZE: 100,
    LOG_LEVEL: 'info',
    SKYOPS_NOTIFICATION_SENDER_EMAIL: 'skyopsnetes2000@gmail.com',
    SKYOPS_NOTIFICATION_SENDER_NAME: 'SkyOps'
  };
}

export const config = parsedConfig;
export const isProduction = config.NODE_ENV === 'production';
export const isDevelopment = config.NODE_ENV === 'development';
export const isTest = config.NODE_ENV === 'test';
