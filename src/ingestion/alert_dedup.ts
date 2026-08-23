import { NormalizedAlert } from '../types/alert.types.js';

export interface DedupCheckResult {
  accepted: boolean;
  rejectReason?: 'DUPLICATE_ALERT' | 'ALERT_EXPIRED' | 'ALREADY_PROCESSED';
}

export class AlertDeduplicator {
  private processedAlertIds: Map<string, number> = new Map(); // alertId -> timestamp
  private maxAlertAgeMs: number;
  private memoryRetentionMs: number;

  constructor(maxAlertAgeMs: number = 60 * 1000, memoryRetentionMs: number = 24 * 60 * 60 * 1000) {
    this.maxAlertAgeMs = maxAlertAgeMs;
    this.memoryRetentionMs = memoryRetentionMs;
  }

  /**
   * Verifies that the alert is fresh and has not been seen before.
   * If rejected, the alert is permanently recorded so it cannot be revived.
   */
  checkAndRecord(alert: NormalizedAlert, nowMs: number = Date.now()): DedupCheckResult {
    this.pruneOldEntries(nowMs);

    // 1. Check for duplicate ID
    if (this.processedAlertIds.has(alert.alertId)) {
      return { accepted: false, rejectReason: 'DUPLICATE_ALERT' };
    }

    // 2. Check for stale/expired alert timestamp
    const ageMs = nowMs - alert.timestamp;
    if (ageMs > this.maxAlertAgeMs) {
      // Mark as seen so that late re-transmissions are still blocked
      this.processedAlertIds.set(alert.alertId, nowMs);
      return { accepted: false, rejectReason: 'ALERT_EXPIRED' };
    }

    if (ageMs < -5000) {
      // Clock drift in future by > 5 seconds
      return { accepted: false, rejectReason: 'ALERT_EXPIRED' };
    }

    // 3. Mark as accepted and recorded
    this.processedAlertIds.set(alert.alertId, nowMs);
    return { accepted: true };
  }

  private pruneOldEntries(nowMs: number): void {
    if (this.processedAlertIds.size > 10000) {
      for (const [id, time] of this.processedAlertIds.entries()) {
        if (nowMs - time > this.memoryRetentionMs) {
          this.processedAlertIds.delete(id);
        }
      }
    }
  }
}
