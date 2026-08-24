import { AdmissionDecision, StrategyConfig } from '../types/strategy.types.js';
import { SymbolMetadata } from '../types/execution.types.js';
import { SizingCalculator } from './sizing_calculator.js';
import { CooldownTracker } from './cooldown_tracker.js';

export class AdmissionBarrier {
  private cooldownTracker: CooldownTracker;

  constructor(cooldownTracker: CooldownTracker) {
    this.cooldownTracker = cooldownTracker;
  }

  /**
   * Evaluates admission criteria for an incoming trade intent:
   * 1. Cooldown status
   * 2. Concurrent trade limits
   * 3. Sizing and minimum notional checks
   * 4. Available margin vs required margin
   */
  evaluateAdmission(
    symbol: string,
    markPrice: number,
    availableMarginUsdt: number,
    activeTradesCount: number,
    meta: SymbolMetadata | null,
    config: StrategyConfig
  ): AdmissionDecision {
    // 0. Check symbol validity
    if (!meta) {
      return {
        admitted: false,
        symbol,
        configSnapshot: config,
        rejectionReason: `INVALID_SYMBOL: Symbol ${symbol} is not listed or not supported on WEEX.`
      };
    }
    // 1. Check Cooldown
    const cooldown = this.cooldownTracker.isCoolingDown(symbol);
    if (cooldown.active) {
      return {
        admitted: false,
        symbol,
        configSnapshot: config,
        rejectionReason: `COOLDOWN_ACTIVE: ${symbol} is in cooldown for ${cooldown.remainingSeconds}s (${cooldown.reason})`
      };
    }

    // 2. Check Concurrent Trade Limit
    if (activeTradesCount >= config.maxConcurrentTrades) {
      return {
        admitted: false,
        symbol,
        configSnapshot: config,
        rejectionReason: `MAX_CONCURRENT_TRADES_REACHED: Active trades (${activeTradesCount}) >= max (${config.maxConcurrentTrades})`
      };
    }

    // 3. Sizing Check for Primary Entry
    const primarySizing = SizingCalculator.calculate(
      config.primaryNotionalUsd,
      markPrice,
      meta,
      config
    );

    if (!primarySizing.valid) {
      return {
        admitted: false,
        symbol,
        configSnapshot: config,
        primarySizing,
        rejectionReason: `PRIMARY_SIZING_INVALID: ${primarySizing.rejectReason}`
      };
    }

    // 4. Sizing Check for Secondary Entry
    const secondarySizing = SizingCalculator.calculate(
      config.secondaryNotionalUsd,
      markPrice * (1 - config.secondaryEntryDropPct),
      meta,
      config
    );

    // Total required margin across both planned entries
    const totalRequiredMargin = primarySizing.requiredMargin + (secondarySizing.valid ? secondarySizing.requiredMargin : 0);

    // 5. Margin Adequacy Check
    if (availableMarginUsdt < totalRequiredMargin) {
      return {
        admitted: false,
        symbol,
        configSnapshot: config,
        primarySizing,
        secondarySizing,
        rejectionReason: `INSUFFICIENT_MARGIN: Required $${totalRequiredMargin.toFixed(2)} USDT, Available $${availableMarginUsdt.toFixed(2)} USDT`
      };
    }

    return {
      admitted: true,
      symbol,
      configSnapshot: config,
      primarySizing,
      secondarySizing
    };
  }
}
