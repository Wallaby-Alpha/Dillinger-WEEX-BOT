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

  it('should parse exact real production alert format correctly', () => {
    const realText = `🎯 STAGE 1 ACCUMULATION SIGNAL
━━━━━━━━━━━━━━━━━━━━━━━━━
Symbol: #XPLUSDT
Alert Price: $0.08055
Score: 0.80 (Stage 1)
━━━━━━━━━━━━━━━━━━━━━━━━━

⚡ MECHANICAL EXECUTION PLAN:
├─ Entry Strategy: Wait 5m for candle close. Skip if 5m drop <= -1.5%
├─ Limit Buy Entry: $0.07854 (-2.5% below Alert Price)
├─ Take Profit: $0.08129 (+3.5% above fill / +1.0% from Alert)
├─ Stop Loss: $0.07736 (-1.5% below fill / -4.0% from Alert)
├─ Time Exit: Market Close position at t = 60m post-entry
└─ Order Expiration: Cancel limit buy if unfilled after 2 hours`;

    const res = AlertParser.parse(realText);
    expect(res.valid).toBe(true);
    expect(res.alert?.symbol).toBe('XPLUSDT');
    // Ensure no other fields were extracted or leaked into symbol
    expect(res.alert?.symbol).not.toContain('0.08055');
    expect(res.alert?.symbol).not.toContain('60m');
    expect(res.alert?.metadata?.rawSymbolExtracted).toBe('XPL');
  });

  it('should ignore unrelated hashtags before the actual symbol', () => {
    const realTextWithExtraHash = `🎯 #Stage1 ACCUMULATION SIGNAL
━━━━━━━━━━━━━━━━━━━━━━━━━
Symbol: #XPLUSDT
Alert Price: $0.08055
Score: 0.80 (Stage 1)
━━━━━━━━━━━━━━━━━━━━━━━━━

⚡ MECHANICAL EXECUTION PLAN:
├─ Entry Strategy: Wait 5m for candle close. Skip if 5m drop <= -1.5%
├─ Limit Buy Entry: $0.07854 (-2.5% below Alert Price)
├─ Take Profit: $0.08129 (+3.5% above fill / +1.0% from Alert)
├─ Stop Loss: $0.07736 (-1.5% below fill / -4.0% from Alert)
├─ Time Exit: Market Close position at t = 60m post-entry
└─ Order Expiration: Cancel limit buy if unfilled after 2 hours`;

    const res = AlertParser.parse(realTextWithExtraHash);
    expect(res.valid).toBe(true);
    expect(res.alert?.symbol).toBe('XPLUSDT');
  });

  it('should reject empty or invalid alert text', () => {
    const res1 = AlertParser.parse('');
    expect(res1.valid).toBe(false);
    expect(res1.rejectReason).toBe('EMPTY_RAW_TEXT');

    const res2 = AlertParser.parse('No symbols in this message just random chat');
    expect(res2.valid).toBe(false);
  });
});
