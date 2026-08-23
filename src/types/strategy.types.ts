/**
 * Pure strategy layer interfaces and types.
 * 100% Exchange-Agnostic.
 */

export interface StrategyConfig {
  /** Strategy version identifier (e.g. "v1.0.0") */
  version: string;
  /** Human-readable strategy name */
  name: string;
  /** Primary entry target notional in USDT (e.g. 35.00) */
  primaryNotionalUsd: number;
  /** Secondary entry target notional in USDT (e.g. 35.00) */
  secondaryNotionalUsd: number;
  /** Absolute hard notional cap in USDT across total position (e.g. 70.00) */
  maxNotionalCapUsd: number;
  /** Leverage multiplier (e.g. 5x) */
  leverage: number;
  /** Secondary limit order price drop percentage (e.g. 0.01 = 1.0% drop) */
  secondaryEntryDropPct: number;
  /** Take Profit percentage above entry (e.g. 0.025 = +2.5%) */
  takeProfitPct: number;
  /** Stop Loss percentage below entry (e.g. 0.015 = -1.5%) */
  stopLossPct: number;
  /** Velocity check evaluation window in seconds (e.g. 300 = 5 minutes) */
  velocityWindowSec: number;
  /** Maximum allowable adverse price move before rejection (e.g. 0.03 = 3.0%) */
  velocityMaxPriceMovePct: number;
  /** Trade maximum lifetime before force closing in seconds (e.g. 14400 = 4 hours) */
  tradeTimeoutSec: number;
  /** Cooldown window in seconds before allowing same symbol again (e.g. 14400 = 4 hours) */
  symbolCooldownSec: number;
  /** Maximum number of concurrent open trades allowed simultaneously */
  maxConcurrentTrades: number;
}

export interface SizingResult {
  symbol: string;
  markPrice: number;
  contractVal: number;
  minOrderSize: number;
  quantityPrecision: number;
  pricePrecision: number;
  rawQuantity: number;
  quantizedQuantity: number;
  quantityStr: string;
  resultingNotional: number;
  requiredMargin: number;
  valid: boolean;
  rejectReason?: string;
}

export interface VelocityCheckResult {
  passed: boolean;
  initialPrice: number;
  currentPrice: number;
  priceChangePct: number;
  rejectionReason?: string;
}

export interface AdmissionDecision {
  admitted: boolean;
  symbol: string;
  configSnapshot: StrategyConfig;
  primarySizing?: SizingResult;
  secondarySizing?: SizingResult;
  rejectionReason?: string;
}
