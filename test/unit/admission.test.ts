import { describe, it, expect } from 'vitest';
import { StrategyEngine } from '../../src/strategy/strategy_engine.js';
import { CooldownTracker } from '../../src/strategy/cooldown_tracker.js';
import { SymbolMetadata } from '../../src/types/execution.types.js';
import { NormalizedAlert } from '../../src/types/alert.types.js';
import * as fs from 'fs';
import * as path from 'path';

describe('Phase 3: Strategy Engine & Admission Barrier Unit Tests', () => {
  const testCooldownPath = path.resolve(process.cwd(), '.test_cooldown_admission.json');

  const btcMeta: SymbolMetadata = {
    symbol: 'BTCUSDT',
    pricePrecision: 1,
    quantityPrecision: 4,
    contractVal: 0.0001,
    minOrderSize: 0.0001,
    maxOrderSize: 1200,
    maxPositionSize: 10000,
    minLeverage: 1,
    maxLeverage: 100
  };

  const sampleAlert: NormalizedAlert = {
    alertId: 'alert-adm-001',
    symbol: 'BTCUSDT',
    timestamp: Date.now(),
    source: 'TELEGRAM',
    rawText: '$BTC'
  };

  it('should admit trade intent when margin and limits are adequate', () => {
    const cooldown = new CooldownTracker(testCooldownPath);
    const engine = new StrategyEngine(undefined, cooldown);

    const decision = engine.evaluateAlert(
      sampleAlert,
      77000.0,
      100.0, // $100 available margin (required is ~$14)
      0,     // 0 active trades
      btcMeta
    );

    expect(decision.admitted).toBe(true);
    expect(decision.primarySizing?.valid).toBe(true);
    expect(decision.configSnapshot.version).toBe('1.1.0');
    expect(Object.isFrozen(decision.configSnapshot)).toBe(true);
  });

  it('should reject trade intent when available margin is insufficient', () => {
    const cooldown = new CooldownTracker(testCooldownPath);
    const engine = new StrategyEngine(undefined, cooldown);

    const decision = engine.evaluateAlert(
      sampleAlert,
      77000.0,
      5.0, // Only $5 available margin (needs ~$14)
      0,
      btcMeta
    );

    expect(decision.admitted).toBe(false);
    expect(decision.rejectionReason).toContain('INSUFFICIENT_MARGIN');
  });

  it('should reject trade intent when concurrent trade limit is reached', () => {
    const cooldown = new CooldownTracker(testCooldownPath);
    const engine = new StrategyEngine(undefined, cooldown);

    const decision = engine.evaluateAlert(
      sampleAlert,
      77000.0,
      100.0,
      3, // 3 active trades (max is 3)
      btcMeta
    );

    expect(decision.admitted).toBe(false);
    expect(decision.rejectionReason).toContain('MAX_CONCURRENT_TRADES_REACHED');
  });

  it('should reject trade intent when symbol is in active cooldown', () => {
    const cooldown = new CooldownTracker(testCooldownPath);
    cooldown.setCooldown('BTCUSDT', 3600, 'TEST_COOLDOWN');
    const engine = new StrategyEngine(undefined, cooldown);

    const decision = engine.evaluateAlert(
      sampleAlert,
      77000.0,
      100.0,
      0,
      btcMeta
    );

    expect(decision.admitted).toBe(false);
    expect(decision.rejectionReason).toContain('COOLDOWN_ACTIVE');

    if (fs.existsSync(testCooldownPath)) {
      fs.unlinkSync(testCooldownPath);
    }
  });
});
