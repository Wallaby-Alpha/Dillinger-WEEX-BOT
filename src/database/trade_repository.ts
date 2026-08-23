import { TradeRecord, StateTransitionEvent, TradeState } from '../types/trade.types.js';
import { logger } from '../utils/logger.js';

export interface ITradeRepository {
  saveTrade(trade: TradeRecord): Promise<void>;
  getTrade(id: string): Promise<TradeRecord | null>;
  getActiveTrades(): Promise<TradeRecord[]>;
  recordTransition(event: StateTransitionEvent): Promise<void>;
  getTransitions(tradeId: string): Promise<StateTransitionEvent[]>;
}

export class InMemoryTradeRepository implements ITradeRepository {
  private trades: Map<string, TradeRecord> = new Map();
  private transitions: StateTransitionEvent[] = [];

  async saveTrade(trade: TradeRecord): Promise<void> {
    this.trades.set(trade.id, { ...trade, updatedAt: Date.now() });
  }

  async getTrade(id: string): Promise<TradeRecord | null> {
    const trade = this.trades.get(id);
    return trade ? { ...trade } : null;
  }

  async getActiveTrades(): Promise<TradeRecord[]> {
    const activeStates = [
      TradeState.ALERT_RECEIVED,
      TradeState.ADMISSION_PENDING,
      TradeState.ENTRY_SUBMITTED,
      TradeState.POSITION_ACTIVE_UNPROTECTED,
      TradeState.POSITION_PROTECTED,
      TradeState.SECONDARY_LIMIT_SUBMITTED,
      TradeState.EXPANDED_POSITION_RECALCULATING,
      TradeState.EXPANDED_PROTECTED,
      TradeState.CLOSING_SUBMITTED
    ];
    return Array.from(this.trades.values()).filter(t => activeStates.includes(t.state));
  }

  async recordTransition(event: StateTransitionEvent): Promise<void> {
    this.transitions.push(event);
    logger.info({ tradeId: event.tradeId, from: event.fromState, to: event.toState, reason: event.triggerReason }, "Trade state transition recorded.");
  }

  async getTransitions(tradeId: string): Promise<StateTransitionEvent[]> {
    return this.transitions.filter(t => t.tradeId === tradeId);
  }
}
