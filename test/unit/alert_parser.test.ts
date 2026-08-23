import { describe, it, expect } from 'vitest';
import { AlertParser } from '../../src/ingestion/alert_parser.js';

describe('Phase 2: Alert Parser Unit Tests', () => {
  it('should parse standard $SYMBOL format', () => {
    const res = AlertParser.parse('$BTC Flagged on 5m chart');
    expect(res.valid).toBe(true);
    expect(res.alert?.symbol).toBe('BTCUSDT');
    expect(res.alert?.alertId).toBeDefined();
  });

  it('should parse FLAGGED: SYMBOL format', () => {
    const res = AlertParser.parse('FLAGGED: SOL momentum spike detected');
    expect(res.valid).toBe(true);
    expect(res.alert?.symbol).toBe('SOLUSDT');
  });

  it('should parse explicit SYMBOLUSDT pair', () => {
    const res = AlertParser.parse('BUY ETHUSDT at market');
    expect(res.valid).toBe(true);
    expect(res.alert?.symbol).toBe('ETHUSDT');
  });

  it('should parse Token: SYMBOL format', () => {
    const res = AlertParser.parse('Token: DOGE\nVolume: 2.5x');
    expect(res.valid).toBe(true);
    expect(res.alert?.symbol).toBe('DOGEUSDT');
  });

  it('should reject empty or invalid alert text', () => {
    const res1 = AlertParser.parse('');
    expect(res1.valid).toBe(false);
    expect(res1.rejectReason).toBe('EMPTY_RAW_TEXT');

    const res2 = AlertParser.parse('No symbols in this message just random chat');
    expect(res2.valid).toBe(false);
  });
});
