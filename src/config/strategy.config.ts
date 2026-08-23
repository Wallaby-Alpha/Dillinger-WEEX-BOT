import { StrategyConfig } from '../types/strategy.types.js';

/**
 * Master Production Strategy Configuration.
 * Changing any of these values modifies trading rules WITHOUT touching exchange adapters.
 */
export const DEFAULT_STRATEGY_CONFIG: Readonly<StrategyConfig> = Object.freeze({
  version: "1.0.0",
  name: "Conservative Momentum Reversal with Native Whole Protection",
  primaryNotionalUsd: 35.00,
  secondaryNotionalUsd: 35.00,
  maxNotionalCapUsd: 70.00,
  leverage: 5,
  secondaryEntryDropPct: 0.010,    // 1.0% drop for secondary limit entry
  takeProfitPct: 0.025,            // +2.5% TP
  stopLossPct: 0.015,              // -1.5% SL
  velocityWindowSec: 300,          // 5 minute evaluation window
  velocityMaxPriceMovePct: 0.030,  // Max 3.0% move during velocity window
  tradeTimeoutSec: 14400,          // 4 hours maximum holding time
  symbolCooldownSec: 14400,        // 4 hours cooldown per symbol
  maxConcurrentTrades: 3           // Maximum 3 active concurrent trades
});

/**
 * Creates an immutable, deep-frozen snapshot of the active strategy configuration
 * to attach to an individual trade lifecycle record.
 */
export function createStrategyConfigSnapshot(override?: Partial<StrategyConfig>): Readonly<StrategyConfig> {
  const merged: StrategyConfig = {
    ...DEFAULT_STRATEGY_CONFIG,
    ...override
  };
  return Object.freeze(merged);
}
