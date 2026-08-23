import { describe, it, expect } from 'vitest';
import { VelocityFilter } from '../../src/strategy/velocity_filter.js';
import { DEFAULT_STRATEGY_CONFIG } from '../../src/config/strategy.config.js';

describe('Phase 3: Velocity Filter Unit Tests', () => {
  it('should pass normal price movement within allowable threshold', () => {
    const res = VelocityFilter.evaluate(100.0, 101.5, DEFAULT_STRATEGY_CONFIG); // +1.5%
    expect(res.passed).toBe(true);
  });

  it('should reject adverse price drops exceeding velocity threshold', () => {
    const res = VelocityFilter.evaluate(100.0, 96.5, DEFAULT_STRATEGY_CONFIG); // -3.5% drop (max is -3.0%)
    expect(res.passed).toBe(false);
    expect(res.rejectionReason).toContain('ADVERSE_VELOCITY_DROP');
  });

  it('should reject excessive pump moves (chasing protection)', () => {
    const res = VelocityFilter.evaluate(100.0, 106.0, DEFAULT_STRATEGY_CONFIG); // +6.0% pump (max allowed +4.5%)
    expect(res.passed).toBe(false);
    expect(res.rejectionReason).toContain('EXCESSIVE_PUMP_VELOCITY');
  });
});
