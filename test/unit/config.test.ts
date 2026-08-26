import { describe, it, expect } from 'vitest';
import { DEFAULT_STRATEGY_CONFIG, createStrategyConfigSnapshot } from '../../src/config/strategy.config.js';
import { getGitCommitId } from '../../src/utils/git_info.js';

describe('Phase 1: Architecture & Config Suite', () => {
  it('should load frozen immutable default strategy configuration', () => {
    expect(DEFAULT_STRATEGY_CONFIG.version).toBe('1.1.0');
    expect(DEFAULT_STRATEGY_CONFIG.maxNotionalCapUsd).toBe(70.00);
    expect(DEFAULT_STRATEGY_CONFIG.atrMultiplierSl).toBe(1.2);
    expect(DEFAULT_STRATEGY_CONFIG.riskRewardRatio).toBe(2.0);
    expect(DEFAULT_STRATEGY_CONFIG.symbolCooldownSec).toBe(3600);
    expect(DEFAULT_STRATEGY_CONFIG.tradeTimeoutSec).toBe(3600);

    // Verify immutability
    expect(Object.isFrozen(DEFAULT_STRATEGY_CONFIG)).toBe(true);
  });

  it('should generate an independent snapshot that cannot be mutated by later changes', () => {
    const snapshot = createStrategyConfigSnapshot({ riskRewardRatio: 3.0 });
    expect(snapshot.riskRewardRatio).toBe(3.0);
    expect(snapshot.atrMultiplierSl).toBe(1.2);
    expect(DEFAULT_STRATEGY_CONFIG.riskRewardRatio).toBe(2.0); // Original unchanged
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it('should resolve a valid Git commit hash for build traceability', () => {
    const commitId = getGitCommitId();
    expect(commitId).toBeDefined();
    expect(commitId.length).toBeGreaterThan(6);
  });
});
