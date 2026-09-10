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
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info')
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
    LOG_LEVEL: process.env.LOG_LEVEL
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
    LOG_LEVEL: 'info'
  };
}

export const config = parsedConfig;
export const isProduction = config.NODE_ENV === 'production';
export const isDevelopment = config.NODE_ENV === 'development';
export const isTest = config.NODE_ENV === 'test';
