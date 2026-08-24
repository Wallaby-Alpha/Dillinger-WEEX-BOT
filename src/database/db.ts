import pg from 'pg';
import { ENV } from '../config/env.js';
import { logger } from '../utils/logger.js';

let pool: pg.Pool | null = null;

export function getDbPool(): pg.Pool | null {
  if (pool) return pool;

  if (!ENV.DATABASE_URL) {
    if (!ENV.DRY_RUN) {
      logger.fatal("DATABASE_URL is not set but DRY_RUN is false. Fail closed.");
      process.exit(1);
    }
    return null;
  }

  pool = new pg.Pool({
    connectionString: ENV.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  // IMPORTANT: Resilient pool error handler.
  // This ensures that unexpected pool errors (e.g. idle client disconnecting)
  // do not crash the Node.js process and take down the live trading bot.
  pool.on('error', (err, client) => {
    logger.error({ err: err.message, stack: err.stack }, "Unexpected error on idle pg client in connection pool.");
  });

  return pool;
}

export async function closeDbPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info("Database connection pool closed.");
  }
}
