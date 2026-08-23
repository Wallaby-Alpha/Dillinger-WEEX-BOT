import { VelocityCheckResult, StrategyConfig } from '../types/strategy.types.js';

export class VelocityFilter {
  /**
   * Evaluates price velocity over the specified evaluation window.
   * Rejects if price moved adversely beyond allowable threshold.
   */
  static evaluate(
    initialPrice: number,
    currentPrice: number,
    config: StrategyConfig
  ): VelocityCheckResult {
    if (initialPrice <= 0 || currentPrice <= 0) {
      return {
        passed: false,
        initialPrice,
        currentPrice,
        priceChangePct: 0,
        rejectionReason: 'INVALID_PRICES_FOR_VELOCITY'
      };
    }

    const priceChangePct = (currentPrice - initialPrice) / initialPrice;

    // For LONG momentum trades: if price dumped adversely > threshold, reject
    if (priceChangePct < -config.velocityMaxPriceMovePct) {
      return {
        passed: false,
        initialPrice,
        currentPrice,
        priceChangePct,
        rejectionReason: `ADVERSE_VELOCITY_DROP: Price moved ${(priceChangePct * 100).toFixed(2)}% below alert level (max allowed: -${(config.velocityMaxPriceMovePct * 100).toFixed(1)}%)`
      };
    }

    // If price pumped excessively beyond threshold, reject chasing
    if (priceChangePct > config.velocityMaxPriceMovePct * 1.5) {
      return {
        passed: false,
        initialPrice,
        currentPrice,
        priceChangePct,
        rejectionReason: `EXCESSIVE_PUMP_VELOCITY: Price moved +${(priceChangePct * 100).toFixed(2)}% above alert level (chasing rejected)`
      };
    }

    return {
      passed: true,
      initialPrice,
      currentPrice,
      priceChangePct
    };
  }
}
