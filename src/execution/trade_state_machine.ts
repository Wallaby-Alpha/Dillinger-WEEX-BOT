import { TradeRecord, TradeState, StateTransitionEvent } from '../types/trade.types.js';
import { AdmissionDecision } from '../types/strategy.types.js';
import { NormalizedAlert } from '../types/alert.types.js';
import { IExecutionAdapter } from '../types/execution.types.js';
import { ITradeRepository } from '../database/trade_repository.js';
import { CooldownTracker } from '../strategy/cooldown_tracker.js';
import { getGitCommitId } from '../utils/git_info.js';
import { logger } from '../utils/logger.js';

export class TradeStateMachine {
  private adapter: IExecutionAdapter;
  private repository: ITradeRepository;
  private cooldownTracker: CooldownTracker;

  constructor(
    adapter: IExecutionAdapter,
    repository: ITradeRepository,
    cooldownTracker: CooldownTracker
  ) {
    this.adapter = adapter;
    this.repository = repository;
    this.cooldownTracker = cooldownTracker;
  }

  private async transition(trade: TradeRecord, toState: TradeState, reason: string, metadata?: Record<string, any>): Promise<void> {
    const fromState = trade.state;
    trade.state = toState;
    trade.updatedAt = Date.now();

    const event: StateTransitionEvent = {
      tradeId: trade.id,
      fromState,
      toState,
      timestamp: Date.now(),
      triggerReason: reason,
      metadata
    };

    await this.repository.recordTransition(event);
    await this.repository.saveTrade(trade);
  }

  /**
   * Initializes and executes a full trade lifecycle from an admitted alert.
   */
  async startTrade(decision: AdmissionDecision, alert: NormalizedAlert): Promise<TradeRecord> {
    const tradeId = `trade_${decision.symbol}_${Date.now()}`;
    const gitCommit = getGitCommitId();

    const trade: TradeRecord = {
      id: tradeId,
      alertId: alert.alertId,
      symbol: decision.symbol,
      state: TradeState.ADMISSION_PENDING,
      gitCommitId: gitCommit,
      strategyConfigSnapshot: decision.configSnapshot,
      currentPositionSize: '0',
      weightedAverageEntryPrice: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    await this.repository.saveTrade(trade);
    await this.transition(trade, TradeState.ENTRY_SUBMITTED, "Submitting primary market entry");

    // 1. Enforce Configured Leverage (e.g. 10x)
    try {
      await this.adapter.setLeverage(trade.symbol, trade.strategyConfigSnapshot.leverage);
    } catch (err: any) {
      logger.warn({ symbol: trade.symbol, err: err.message }, "Leverage set warning (may already be set on exchange)");
    }

    // 2. Submit Primary Market Entry with Native Preset TP/SL
    const primarySizing = decision.primarySizing!;
    const primaryClientOrderId = `b-${trade.id}-p1`;
    const meta = await this.adapter.getSymbolMetadata(trade.symbol);
    const estMarkPrice = primarySizing.markPrice || (await this.adapter.getMarkPrice(trade.symbol));
    const config = trade.strategyConfigSnapshot;
    
    const direction = alert.metadata?.direction === 'SHORT' ? 'SHORT' : 'LONG';
    const side = direction === 'LONG' ? 'BUY' : 'SELL';
    const atr14 = alert.metadata?.atr14 || 0;
    const pricePrecision = meta ? meta.pricePrecision : 4;

    // Calculate Dynamic TP/SL using ATR and R:R
    const slDistance = atr14 * config.atrMultiplierSl;
    const tpDistance = slDistance * config.riskRewardRatio;
    
    const presetSlNum = direction === 'LONG' ? estMarkPrice - slDistance : estMarkPrice + slDistance;
    const presetTpNum = direction === 'LONG' ? estMarkPrice + tpDistance : estMarkPrice - tpDistance;

    const presetTp = presetTpNum.toFixed(pricePrecision);
    const presetSl = presetSlNum.toFixed(pricePrecision);

    const entryRes = await this.adapter.submitEntryOrder({
      symbol: trade.symbol,
      side: side,
      type: 'MARKET',
      positionSide: direction,
      quantity: primarySizing.quantityStr,
      clientOrderId: primaryClientOrderId,
      presetTakeProfitPrice: presetTp,
      presetStopLossPrice: presetSl
    });

    if (!entryRes.success) {
      trade.lastError = `Primary entry failed: ${entryRes.errorMessage}`;
      await this.transition(trade, TradeState.TERMINAL_FAILED, "Primary entry rejected by exchange");
      return trade;
    }

    trade.primaryOrderId = entryRes.orderId;
    trade.primaryClientOrderId = primaryClientOrderId;
    trade.primaryQuantity = primarySizing.quantityStr;
    trade.primaryFilledAt = Date.now();

    await this.transition(trade, TradeState.POSITION_ACTIVE_UNPROTECTED, "Primary entry filled");

    // 3. Fetch authoritative position
    const pos = await this.adapter.getActivePosition(trade.symbol);
    if (!pos) {
      trade.lastError = "Position not found after primary fill confirmation";
      await this.transition(trade, TradeState.RECONCILIATION_REQUIRED, "Divergence after entry fill");
      return trade;
    }

    trade.currentPositionSize = pos.size;
    trade.primaryEntryPrice = pos.entryPrice;
    trade.weightedAverageEntryPrice = pos.entryPrice;

    // 4. Establish & Authoritatively Verify Native Protection
    const exactSlNum = direction === 'LONG' ? pos.entryPrice - slDistance : pos.entryPrice + slDistance;
    const exactTpNum = direction === 'LONG' ? pos.entryPrice + tpDistance : pos.entryPrice - tpDistance;
    
    const exactTpPrice = exactTpNum.toFixed(pricePrecision);
    const exactSlPrice = exactSlNum.toFixed(pricePrecision);

    // Attempt to discover active protection orders created by preset TP/SL
    const discoveredAlgos = await this.adapter.listActiveProtectionOrders(trade.symbol, direction);
    let activeTpId: string | undefined;
    let activeSlId: string | undefined;

    if (discoveredAlgos && discoveredAlgos.length > 0) {
      for (const algo of discoveredAlgos) {
        if (algo.status === 'UNTRIGGERED' || algo.status === 'NEW') {
          const verified = await this.adapter.verifyProtectionOrder(trade.symbol, algo.orderId);
          if (verified && (verified.status === 'UNTRIGGERED' || verified.status === 'NEW')) {
            if (!activeTpId) activeTpId = algo.orderId;
            else if (!activeSlId) activeSlId = algo.orderId;
          }
        }
      }
    }

    // Safety fallback: If discrete algo IDs were not discovered, place whole-position protection explicitly
    if (!activeTpId || !activeSlId) {
      logger.info({ symbol: trade.symbol }, "Preset protection IDs not discovered; placing explicit native whole-position protection.");
      const tpRes = await this.adapter.establishWholePositionProtection({
        symbol: trade.symbol,
        positionSide: direction,
        planType: 'TAKE_PROFIT',
        triggerPrice: exactTpPrice,
        clientAlgoId: `b-${trade.id}-tp1`
      });

      const slRes = await this.adapter.establishWholePositionProtection({
        symbol: trade.symbol,
        positionSide: direction,
        planType: 'STOP_LOSS',
        triggerPrice: exactSlPrice,
        clientAlgoId: `b-${trade.id}-sl1`
      });

      if (!tpRes.success || !slRes.success) {
        trade.lastError = `Protection creation failed: TP=${tpRes.errorMessage}, SL=${slRes.errorMessage}`;
        await this.transition(trade, TradeState.RECONCILIATION_REQUIRED, "Failed to establish native protection");
        return trade;
      }

      activeTpId = tpRes.orderId;
      activeSlId = slRes.orderId;
    }

    // Authoritative Independent Verification
    const tpVerify = await this.adapter.verifyProtectionOrder(trade.symbol, activeTpId!);
    const slVerify = await this.adapter.verifyProtectionOrder(trade.symbol, activeSlId!);

    const isTpActive = tpVerify && (tpVerify.status === 'UNTRIGGERED' || tpVerify.status === 'NEW');
    const isSlActive = slVerify && (slVerify.status === 'UNTRIGGERED' || slVerify.status === 'NEW');

    if (!isTpActive || !isSlActive) {
      trade.lastError = `Protection independent verification failed on exchange: TP=${!!isTpActive}, SL=${!!isSlActive}`;
      await this.transition(trade, TradeState.RECONCILIATION_REQUIRED, "Failed independent exchange protection verification");
      return trade;
    }

    trade.activeTpOrderId = activeTpId;
    trade.activeSlOrderId = activeSlId;
    trade.currentTpTriggerPrice = exactTpPrice;
    trade.currentSlTriggerPrice = exactSlPrice;

    await this.transition(trade, TradeState.POSITION_PROTECTED, "Initial native whole-position protection independently verified on exchange");

    // 4. Submit Secondary Limit Entry Order (if configured)
    if (decision.secondarySizing && decision.secondarySizing.valid) {
      const secondaryPrice = (pos.entryPrice * (1 - trade.strategyConfigSnapshot.secondaryEntryDropPct)).toFixed(meta!.pricePrecision);
      const secondaryClientOrderId = `b-${trade.id}-p2`;

      const limitRes = await this.adapter.submitEntryOrder({
        symbol: trade.symbol,
        side: 'BUY',
        type: 'LIMIT',
        positionSide: 'LONG',
        quantity: decision.secondarySizing.quantityStr,
        price: secondaryPrice,
        clientOrderId: secondaryClientOrderId
      });

      if (limitRes.success) {
        trade.secondaryOrderId = limitRes.orderId;
        trade.secondaryClientOrderId = secondaryClientOrderId;
        trade.secondaryQuantity = decision.secondarySizing.quantityStr;
        trade.secondaryLimitPrice = parseFloat(secondaryPrice);
        await this.transition(trade, TradeState.SECONDARY_LIMIT_SUBMITTED, "Secondary limit entry order placed");
      }
    }

    return trade;
  }

  /**
   * Handles secondary fill detection and in-place protection modification.
   */
  async handleSecondaryFill(trade: TradeRecord): Promise<void> {
    await this.transition(trade, TradeState.EXPANDED_POSITION_RECALCULATING, "Secondary entry filled, recalculating protection");

    const pos = await this.adapter.getActivePosition(trade.symbol);
    if (!pos) {
      trade.lastError = "Position disappeared during secondary fill recalculation";
      await this.transition(trade, TradeState.RECONCILIATION_REQUIRED, "Position missing on expansion");
      return;
    }

    trade.currentPositionSize = pos.size;
    trade.weightedAverageEntryPrice = pos.entryPrice;
    trade.secondaryFilledAt = Date.now();

    const meta = await this.adapter.getSymbolMetadata(trade.symbol);
    
    // Note: Secondary limits are disabled in Variation 4 (secondaryEntryDropPct: 0.0).
    // Using a safe fallback constant for compilation safety in case it is ever re-enabled.
    const fallbackSlPct = 0.02; 
    const fallbackTpPct = 0.05;
    
    const combinedTp = (pos.entryPrice * (1 + fallbackTpPct)).toFixed(meta!.pricePrecision);
    const combinedSl = (pos.entryPrice * (1 - fallbackSlPct)).toFixed(meta!.pricePrecision);

    // Modify existing protection in-place
    if (trade.activeTpOrderId) {
      await this.adapter.updateWholePositionProtection({
        symbol: trade.symbol,
        orderId: trade.activeTpOrderId,
        triggerPrice: combinedTp
      });
      trade.currentTpTriggerPrice = combinedTp;
    }

    if (trade.activeSlOrderId) {
      await this.adapter.updateWholePositionProtection({
        symbol: trade.symbol,
        orderId: trade.activeSlOrderId,
        triggerPrice: combinedSl
      });
      trade.currentSlTriggerPrice = combinedSl;
    }

    await this.transition(trade, TradeState.EXPANDED_PROTECTED, "Protection updated in-place for expanded position");
  }

  /**
   * Closes the active trade, cancels residual orders, and verifies zero exposure.
   */
  async closeTrade(trade: TradeRecord, reason: string): Promise<void> {
    await this.transition(trade, TradeState.CLOSING_SUBMITTED, `Closing trade: ${reason}`);

    // 1. Cancel secondary limit order if still open
    if (trade.secondaryOrderId) {
      try {
        await this.adapter.cancelOrder(trade.symbol, trade.secondaryOrderId);
      } catch (err: any) {
        logger.warn({ err: err.message }, "Error cancelling secondary limit order during close.");
      }
    }

    // 2. Submit market close order
    const pos = await this.adapter.getActivePosition(trade.symbol);
    if (pos && parseFloat(pos.size) > 0) {
      await this.adapter.closePositionMarket(trade.symbol, pos.side, pos.size);
    }

    // 3. Verify zero exposure via REST
    const verifyPos = await this.adapter.getActivePosition(trade.symbol);
    if (verifyPos && parseFloat(verifyPos.size) > 0) {
      trade.lastError = "Residual position remaining after close execution";
      await this.transition(trade, TradeState.RECONCILIATION_REQUIRED, "Close verification failed");
      return;
    }

    trade.currentPositionSize = '0';
    trade.closedAt = Date.now();
    await this.transition(trade, TradeState.CLOSED_VERIFIED, `Trade closed and 0 exposure verified (${reason})`);

    // 4. Register conditional symbol cooldown (Loss-Only)
    const isTakeProfit = reason.includes('TAKE_PROFIT') || reason.includes('PROFIT');
    if (!isTakeProfit) {
      this.cooldownTracker.setCooldown(
        trade.symbol,
        trade.strategyConfigSnapshot.symbolCooldownSec,
        `TRADE_COMPLETED_${trade.id}`
      );
    } else {
      logger.info({ symbol: trade.symbol }, "Take Profit hit. Symbol remains immediately eligible (0 cooldown).");
      this.cooldownTracker.clearCooldown(trade.symbol);
    }
  }
}
