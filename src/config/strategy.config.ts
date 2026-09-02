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
  secondaryEntryDropPct: 0.0,      // N/A
  atrMultiplierSl: 1.2,            // SL = 1.2 x ATR(14)
  riskRewardRatio: 2.0,            // TP = 2.0 x Risk
  velocityWindowSec: 300,          // 5 minute evaluation window
  velocityMaxPriceMovePct: 0.030,  // Max 3.0% move during velocity window
  tradeTimeoutSec: 3600,           // 60 minutes maximum holding time (12 candles)
  symbolCooldownSec: 3600,         // 60 minutes cooldown per symbol
  maxConcurrentTrades: 3,          // Maximum 3 active concurrent trades
  minAtrPct: 0.0058,               // Minimum 0.58% ATR for entry (top third volatility)
  limitEntryOffsetPct: 0.002,      // 0.2% limit offset below signal close
  btcMaxEmaBufferPct: 0.0035,      // Allow BTC < EMA50 or within 0.35% above it
  entryOrderTimeoutSec: 900,       // 15 minutes limit order timeout
  earlyExitWindowSec: 900,         // Monitor first 15 mins for early exit
  earlyExitDropPct: 0.008          // 0.8% drop triggers early exit
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
