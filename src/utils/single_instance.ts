import * as fs from 'fs';
import * as path from 'path';
import { SYSTEM_CONFIG } from '../config/system.config.js';
import { logger } from './logger.js';

/**
 * Ensures only one instance of the trading bot process runs at any time.
 */
export class SingleInstanceManager {
  private lockFilePath: string;
  private hasLock: boolean = false;

  constructor(lockFileName: string = SYSTEM_CONFIG.lockFilePath) {
    this.lockFilePath = path.resolve(process.cwd(), lockFileName);
  }

  acquireLock(): void {
    if (fs.existsSync(this.lockFilePath)) {
      try {
        const pidStr = fs.readFileSync(this.lockFilePath, 'utf8').trim();
        const existingPid = parseInt(pidStr, 10);

        // Check if process with this PID is still alive
        if (!isNaN(existingPid)) {
          try {
            process.kill(existingPid, 0); // throws error if process does not exist
            logger.fatal({ existingPid }, "Another instance of the bot is already running. Exiting to prevent concurrent execution conflicts.");
            process.exit(1);
          } catch {
            logger.warn({ stalePid: existingPid }, "Found stale lockfile from dead process. Overwriting lockfile.");
          }
        }
      } catch {
        // Corrupt lock file, overwrite
      }
    }

    fs.writeFileSync(this.lockFilePath, process.pid.toString(), 'utf8');
    this.hasLock = true;
    logger.info({ pid: process.pid, lockFile: this.lockFilePath }, "Single instance process lock acquired.");

    // Clean up lockfile on normal exit
    process.on('exit', () => this.releaseLock());
  }

  releaseLock(): void {
    if (this.hasLock && fs.existsSync(this.lockFilePath)) {
      try {
        fs.unlinkSync(this.lockFilePath);
        this.hasLock = false;
      } catch (err: any) {
        logger.error({ err: err.message }, "Failed to remove process lockfile.");
      }
    }
  }
}
