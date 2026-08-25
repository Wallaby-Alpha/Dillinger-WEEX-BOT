import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';

export interface CooldownStatus {
  active: boolean;
  remainingSeconds: number;
  reason?: string;
}

export class CooldownTracker {
  private storePath: string;
  private memoryCache: Map<string, { expiresAt: number; reason: string }> = new Map();

  constructor(customPath?: string) {
    this.storePath = customPath || path.resolve(process.cwd(), '.cooldown_store.json');
    this.loadFromDisk();
  }

  setCooldown(symbol: string, durationSeconds: number, reason: string = 'STANDARD_TRADE_COOLDOWN'): void {
    const expiresAt = Date.now() + (durationSeconds * 1000);
    this.memoryCache.set(symbol, { expiresAt, reason });
    this.persistToDisk();
    logger.info({ symbol, durationSeconds, expiresAt: new Date(expiresAt).toISOString(), reason }, "Symbol cooldown registered.");
  }

  clearCooldown(symbol: string): void {
    if (this.memoryCache.has(symbol)) {
      this.memoryCache.delete(symbol);
      this.persistToDisk();
      logger.info({ symbol }, "Symbol cooldown cleared.");
    }
  }

  isCoolingDown(symbol: string, nowMs: number = Date.now()): CooldownStatus {
    const record = this.memoryCache.get(symbol);
    if (!record) {
      return { active: false, remainingSeconds: 0 };
    }

    const remainingMs = record.expiresAt - nowMs;
    if (remainingMs > 0) {
      return {
        active: true,
        remainingSeconds: Math.ceil(remainingMs / 1000),
        reason: record.reason
      };
    }

    // Cooldown expired, clean up memory
    this.memoryCache.delete(symbol);
    this.persistToDisk();
    return { active: false, remainingSeconds: 0 };
  }

  private loadFromDisk(): void {
    if (fs.existsSync(this.storePath)) {
      try {
        const raw = fs.readFileSync(this.storePath, 'utf8');
        const data = JSON.parse(raw);
        const now = Date.now();
        for (const [symbol, rec] of Object.entries(data as Record<string, { expiresAt: number; reason: string }>)) {
          if (rec.expiresAt > now) {
            this.memoryCache.set(symbol, rec);
          }
        }
      } catch (err: any) {
        logger.error({ err: err.message }, "Failed to load cooldown cache from disk.");
      }
    }
  }

  private persistToDisk(): void {
    try {
      const obj: Record<string, { expiresAt: number; reason: string }> = {};
      for (const [k, v] of this.memoryCache.entries()) {
        obj[k] = v;
      }
      fs.writeFileSync(this.storePath, JSON.stringify(obj, null, 2), 'utf8');
    } catch (err: any) {
      logger.error({ err: err.message }, "Failed to persist cooldown cache to disk.");
    }
  }
}
