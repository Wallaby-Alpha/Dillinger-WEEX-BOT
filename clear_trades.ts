import 'dotenv/config';
import pg from 'pg';
import { ENV } from './src/config/env.js';

async function clearTrades() {
  const pool = new pg.Pool({ connectionString: ENV.DATABASE_URL });
  await pool.query('DELETE FROM state_transitions');
  await pool.query('DELETE FROM trades');
  console.log("Cleared trades.");
  process.exit(0);
}

clearTrades();
