import { NormalizedAlert } from '../types/alert.types.js';
import { AdmissionDecision, StrategyConfig } from '../types/strategy.types.js';
import { SymbolMetadata } from '../types/execution.types.js';
import { createStrategyConfigSnapshot, DEFAULT_STRATEGY_CONFIG } from '../config/strategy.config.js';
import { VelocityFilter } from './velocity_filter.js';
import { AdmissionBarrier } from './admission_barrier.js';
import { CooldownTracker } from './cooldown_tracker.js';
import { logger } from '../utils/logger.js';

export class StrategyEngine {
  private activeConfig: StrategyConfig;
  private cooldownTracker: CooldownTracker;
  private admissionBarrier: AdmissionBarrier;

  constructor(customConfig?: StrategyConfig, cooldownTracker?: CooldownTracker) {
    this.activeConfig = customConfig || DEFAULT_STRATEGY_CONFIG;
    this.cooldownTracker = cooldownTracker || new CooldownTracker();
    this.admissionBarrier = new AdmissionBarrier(this.cooldownTracker);
  }

  /**
   * Updates runtime strategy parameters without touching exchange adapters.
   */
  updateConfig(newConfig: Partial<StrategyConfig>): void {
    this.activeConfig = {
      ...this.activeConfig,
      ...newConfig
    };
    logger.info({ newConfig: this.activeConfig }, "Strategy configuration updated.");
  }

  getConfig(): StrategyConfig {
    return this.activeConfig;
  }

  getCooldownTracker(): CooldownTracker {
    return this.cooldownTracker;
  }

  /**
   * Evaluates an incoming NormalizedAlert against the strategy rules:
   * 1. Generates an immutable snapshot of current strategy parameters.
   * 2. Runs velocity checks if historical price reference is supplied.
   * 3. Evaluates admission criteria (margin, limits, sizing).
   */
  evaluateAlert(
    alert: NormalizedAlert,
    currentMarkPrice: number,
    availableMarginUsdt: number,
    activeTradesCount: number,
    meta: SymbolMetadata | null,
    initialAlertPrice?: number
  ): AdmissionDecision {
    // 1. Create frozen strategy snapshot for this trade
    const snapshot = createStrategyConfigSnapshot(this.activeConfig);

    // 2. Velocity Check (if alert baseline price exists)
    if (initialAlertPrice && initialAlertPrice > 0) {
      const velocity = VelocityFilter.evaluate(initialAlertPrice, currentMarkPrice, snapshot);
      if (!velocity.passed) {
        logger.warn({ symbol: alert.symbol, reason: velocity.rejectionReason }, "Alert rejected by velocity filter.");
        return {
          admitted: false,
          symbol: alert.symbol,
          configSnapshot: snapshot,
          rejectionReason: velocity.rejectionReason
        };
      }
    }

    // 3. Admission Barrier
    const decision = this.admissionBarrier.evaluateAdmission(
      alert.symbol,
      currentMarkPrice,
      availableMarginUsdt,
      activeTradesCount,
      meta,
      snapshot
    );

    if (decision.admitted) {
      logger.info({ symbol: alert.symbol, primarySizing: decision.primarySizing }, "Trade intent admitted by strategy engine.");
    } else {
      logger.warn({ symbol: alert.symbol, reason: decision.rejectionReason }, "Trade intent rejected at admission barrier.");
    }

    return decision;
  }
}
