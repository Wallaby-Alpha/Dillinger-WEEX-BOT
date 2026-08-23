import { describe, it, expect } from 'vitest';
import { SizingCalculator } from '../../src/strategy/sizing_calculator.js';
import { DEFAULT_STRATEGY_CONFIG } from '../../src/config/strategy.config.js';
import { SymbolMetadata } from '../../src/types/execution.types.js';

describe('Phase 3: Sizing & Normalization Unit Tests', () => {
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

  const dogeMeta: SymbolMetadata = {
    symbol: 'DOGEUSDT',
    pricePrecision: 5,
    quantityPrecision: -2, // multiple of 100
    contractVal: 100,
    minOrderSize: 100,
    maxOrderSize: 30000000,
    maxPositionSize: 100000000,
    minLeverage: 1,
    maxLeverage: 50
  };

  it('should floor-quantize BTCUSDT sizing without rounding up', () => {
    const res = SizingCalculator.calculate(35.0, 77000.0, btcMeta, DEFAULT_STRATEGY_CONFIG);
    expect(res.valid).toBe(true);
    expect(res.quantityStr).toBe('0.0004'); // 35 / 77000 = 0.0004545 -> 0.0004
    expect(res.resultingNotional).toBeLessThanOrEqual(35.0);
    expect(res.requiredMargin).toBeCloseTo(res.resultingNotional / 5, 2);
  });

  it('should quantize contract lot multiples for DOGEUSDT (precision = -2)', () => {
    const res = SizingCalculator.calculate(70.0, 0.09115, dogeMeta, DEFAULT_STRATEGY_CONFIG);
    expect(res.valid).toBe(true);
    expect(res.quantityStr).toBe('700'); // 70 / 0.09115 = 767.96 -> multiple of 100 is 700
    expect(res.resultingNotional).toBeLessThanOrEqual(70.0);
  });

  it('should reject orders when quantized size < minOrderSize', () => {
    const res = SizingCalculator.calculate(1.0, 77000.0, btcMeta, DEFAULT_STRATEGY_CONFIG); // $1 notional
    expect(res.valid).toBe(false);
    expect(res.rejectReason).toContain('SIZE_BELOW_MINIMUM');
  });

  it('should strictly never exceed hard maxNotionalCapUsd', () => {
    const res = SizingCalculator.calculate(500.0, 77000.0, btcMeta, DEFAULT_STRATEGY_CONFIG); // Requesting $500
    expect(res.valid).toBe(true);
    expect(res.resultingNotional).toBeLessThanOrEqual(DEFAULT_STRATEGY_CONFIG.maxNotionalCapUsd);
  });
});
