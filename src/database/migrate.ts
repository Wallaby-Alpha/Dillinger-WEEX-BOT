import * as fs from 'fs';
import * as path from 'path';
import pg from 'pg';
import { ENV } from '../config/env.js';
import { logger } from '../utils/logger.js';

async function runMigrations() {
  if (!ENV.DATABASE_URL) {
    logger.fatal("DATABASE_URL is not set. Cannot run migrations.");
    process.exit(1);
  }

  const pool = new pg.Pool({
    connectionString: ENV.DATABASE_URL,
  });

  try {
    const migrationsDir = path.resolve(process.cwd(), 'migrations');
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
    
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      logger.info(`Executing migration: ${file}`);
      await pool.query(sql);
    }
    
    logger.info("Migrations completed successfully.");
    process.exit(0);
  } catch (err: any) {
    logger.error({ err: err.message, stack: err.stack }, "Migration failed.");
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  runMigrations();
}
