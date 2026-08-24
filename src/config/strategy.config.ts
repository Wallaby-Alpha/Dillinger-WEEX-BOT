import { StrategyConfig } from '../types/strategy.types.js';

/**
 * Master Production Strategy Configuration.
 * Changing any of these values modifies trading rules WITHOUT touching exchange adapters.
 */
export const DEFAULT_STRATEGY_CONFIG: Readonly<StrategyConfig> = Object.freeze({
  version: "1.1.0",
  name: "100% Market Entry with 3.5% TP and 1.5% SL",
  primaryNotionalUsd: 70.00,
  secondaryNotionalUsd: 0.00, // Disable secondary limit order
  maxNotionalCapUsd: 70.00,
  leverage: 10,
  secondaryEntryDropPct: 0.0, // N/A
  takeProfitPct: 0.035,            // +3.5% TP
  stopLossPct: 0.015,              // -1.5% SL
  velocityWindowSec: 300,          // 5 minute evaluation window
  velocityMaxPriceMovePct: 0.030,  // Max 3.0% move during velocity window
  tradeTimeoutSec: 14400,          // 4 hours maximum holding time
  symbolCooldownSec: 7200,         // 120 minutes cooldown per symbol
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
