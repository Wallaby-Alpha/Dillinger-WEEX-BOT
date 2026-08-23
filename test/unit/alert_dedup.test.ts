import { describe, it, expect } from 'vitest';
import { AlertDeduplicator } from '../../src/ingestion/alert_dedup.js';
import { NormalizedAlert } from '../../src/types/alert.types.js';

describe('Phase 2: Alert Deduplication & Expiry Invariants', () => {
  it('should accept a fresh unique alert', () => {
    const dedup = new AlertDeduplicator(60000);
    const alert: NormalizedAlert = {
      alertId: 'alert-001',
      symbol: 'BTCUSDT',
      timestamp: Date.now(),
      source: 'TELEGRAM',
      rawText: '$BTC'
    };

    const res = dedup.checkAndRecord(alert);
    expect(res.accepted).toBe(true);
  });

  it('should reject a duplicate alert with the same ID', () => {
    const dedup = new AlertDeduplicator(60000);
    const alert: NormalizedAlert = {
      alertId: 'alert-dup-001',
      symbol: 'BTCUSDT',
      timestamp: Date.now(),
      source: 'TELEGRAM',
      rawText: '$BTC'
    };

    const res1 = dedup.checkAndRecord(alert);
    expect(res1.accepted).toBe(true);

    const res2 = dedup.checkAndRecord(alert);
    expect(res2.accepted).toBe(false);
    expect(res2.rejectReason).toBe('DUPLICATE_ALERT');
  });

  it('should reject stale/expired alerts (>60s old) and never revive them', () => {
    const dedup = new AlertDeduplicator(60000); // 60s max age
    const now = Date.now();
    const staleAlert: NormalizedAlert = {
      alertId: 'alert-stale-001',
      symbol: 'BTCUSDT',
      timestamp: now - 90000, // 90 seconds old
      source: 'TELEGRAM',
      rawText: '$BTC'
    };

    const res1 = dedup.checkAndRecord(staleAlert, now);
    expect(res1.accepted).toBe(false);
    expect(res1.rejectReason).toBe('ALERT_EXPIRED');

    // Attempting to submit again should still be blocked (never revived)
    const res2 = dedup.checkAndRecord(staleAlert, now + 1000);
    expect(res2.accepted).toBe(false);
  });
});
