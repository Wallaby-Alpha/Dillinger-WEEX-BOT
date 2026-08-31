import { TradeStateMachine } from './trade_state_machine.js';
import { IExecutionAdapter } from '../types/execution.types.js';
import { ITradeRepository } from '../database/trade_repository.js';
import { TradeState, TradeRecord } from '../types/trade.types.js';
import { logger } from '../utils/logger.js';

export class ReconciliationEngine {
  private stateMachine: TradeStateMachine;
  private adapter: IExecutionAdapter;
  private repository: ITradeRepository;
  private isRunning: boolean = false;
  private timer?: NodeJS.Timeout;

  constructor(
    stateMachine: TradeStateMachine,
    adapter: IExecutionAdapter,
    repository: ITradeRepository
  ) {
    this.stateMachine = stateMachine;
    this.adapter = adapter;
    this.repository = repository;
  }

  /**
   * Reconciles all active trades against the exchange state.
   */
  async reconcileCycle(): Promise<void> {
    const activeTrades = await this.repository.getActiveTrades();
    if (activeTrades.length === 0) {
      return;
    }

    for (const trade of activeTrades) {
      try {
        await this.reconcileTrade(trade);
      } catch (err: any) {
        logger.error({ tradeId: trade.id, err: err.message }, "Error during trade reconciliation.");
      }
    }
  }

  private async reconcileTrade(trade: TradeRecord): Promise<void> {
    const now = Date.now();
    const snapshot = await this.adapter.fetchExchangeState(trade.symbol);

    // 1. Timeout Check: Force close if maximum lifetime exceeded
    const ageSeconds = (now - trade.createdAt) / 1000;
    if (ageSeconds >= trade.strategyConfigSnapshot.tradeTimeoutSec) {
      logger.warn({ tradeId: trade.id, ageSeconds }, "Trade lifetime exceeded timeout. Force closing.");
      await this.stateMachine.closeTrade(trade, "LIFETIME_TIMEOUT_EXPIRED");
      return;
    }

    // 2. Unfilled Limit Order Check
    if (trade.state === TradeState.ENTRY_SUBMITTED) {
      if (snapshot.position && parseFloat(snapshot.position.size) > 0) {
        logger.info({ tradeId: trade.id }, "Primary limit order filled. Transitioning to active.");
        await this.stateMachine.handlePrimaryFill(trade);
        return;
      }
      
      const entryAgeSec = (now - trade.createdAt) / 1000;
      if (entryAgeSec >= (trade.strategyConfigSnapshot.entryOrderTimeoutSec || 900)) {
        logger.info({ tradeId: trade.id }, "Primary limit order expired without fill. Cancelling and closing.");
        await this.stateMachine.closeTrade(trade, "LIMIT_ENTRY_TIMEOUT");
        return;
      }
      return; // Still waiting for fill
    }

    // 3. Closed Position Detection (e.g. TP or SL executed natively on exchange)
    if (!snapshot.position || parseFloat(snapshot.position.size) === 0) {
      const activePositionStates = [
        TradeState.POSITION_PROTECTED,
        TradeState.SECONDARY_LIMIT_SUBMITTED,
        TradeState.EXPANDED_PROTECTED,
        TradeState.POSITION_ACTIVE_UNPROTECTED
      ];
      if (activePositionStates.includes(trade.state)) {
        const markPrice = await this.adapter.getMarkPrice(trade.symbol);
        const exitReason = markPrice > trade.weightedAverageEntryPrice ? 'TAKE_PROFIT_TRIGGERED' : 'STOP_LOSS_TRIGGERED';
        
        logger.info({ tradeId: trade.id, symbol: trade.symbol, exitReason }, "Position confirmed flat on exchange (TP/SL filled). Finalizing trade.");
        await this.stateMachine.closeTrade(trade, exitReason);
        return;
      }
    }

    // 4. Early Exit Rule (0.8% drop within first 15 mins)
    const activePositionStates = [
      TradeState.POSITION_PROTECTED,
      TradeState.SECONDARY_LIMIT_SUBMITTED,
      TradeState.EXPANDED_PROTECTED,
      TradeState.POSITION_ACTIVE_UNPROTECTED
    ];
    if (activePositionStates.includes(trade.state) && trade.primaryFilledAt) {
      const fillAgeSec = (now - trade.primaryFilledAt) / 1000;
      if (fillAgeSec <= (trade.strategyConfigSnapshot.earlyExitWindowSec || 900)) {
        const markPrice = await this.adapter.getMarkPrice(trade.symbol);
        const dropLimit = trade.primaryEntryPrice * (1 - (trade.strategyConfigSnapshot.earlyExitDropPct || 0.008));
        
        if (markPrice <= dropLimit) {
          logger.info({ tradeId: trade.id, fillAgeSec, markPrice, dropLimit }, "Early exit rule triggered (0.8% drop within 15 mins). Force closing.");
          await this.stateMachine.closeTrade(trade, "EARLY_EXIT_VELOCITY");
          return;
        }
      }
    }

    // 5. Secondary Fill Detection
    if (trade.state === TradeState.SECONDARY_LIMIT_SUBMITTED && snapshot.position) {
      const exchangeSize = parseFloat(snapshot.position.size);
      const recordedSize = parseFloat(trade.currentPositionSize);

      if (exchangeSize > recordedSize + 1e-6) {
        logger.info({ tradeId: trade.id, oldSize: recordedSize, newSize: exchangeSize }, "Secondary limit order filled. Triggering expansion recalculation.");
        await this.stateMachine.handleSecondaryFill(trade);
        return;
      }
    }

    // 6. Protection Verification Check
    if (trade.state === TradeState.POSITION_PROTECTED || trade.state === TradeState.EXPANDED_PROTECTED) {
      if (!snapshot.activeTpOrder || !snapshot.activeSlOrder) {
        logger.warn({ tradeId: trade.id, symbol: trade.symbol, snapshot }, "Authoritative protection mismatch detected during reconciliation.");
      }
    }
  }

  start(intervalMs: number = 5000): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.timer = setInterval(() => {
      this.reconcileCycle().catch(err => {
        logger.error({ err: err.message }, "Unhandled error in reconciliation cycle.");
      });
    }, intervalMs);
    logger.info({ intervalMs }, "Reconciliation engine started.");
  }

  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
    }
    logger.info("Reconciliation engine stopped.");
  }
}
