import { z } from 'zod';
import * as dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  // WEEX API Credentials
  WEEX_API_KEY: z.string().min(1, "WEEX_API_KEY is required"),
  WEEX_API_SECRET: z.string().min(1, "WEEX_API_SECRET is required"),
  WEEX_PASSPHRASE: z.string().min(1, "WEEX_PASSPHRASE is required"),
  WEEX_BASE_URL: z.string().default("https://api-contract.weex.com"),
  WEEX_WS_URL: z.string().default("wss://ws-contract.weex.com/v3/public"),

  // Persistence (Optional in local probe mode, required for production)
  DATABASE_URL: z.string().optional(),

  // Telegram Ingestion
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHANNEL_ID: z.string().optional(),

  // Runtime Environment
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  PORT: z.coerce.number().default(3000),
  DRY_RUN: z.string().optional().transform((val) => {
    // Must default to dry-run/blocked if unset or set to anything other than "false"
    return val === 'false' ? false : true;
  }),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function loadEnv(): EnvConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const errorDetails = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(`Environment Validation Error: ${errorDetails}`);
  }
  return parsed.data;
}

export const ENV = loadEnv();
