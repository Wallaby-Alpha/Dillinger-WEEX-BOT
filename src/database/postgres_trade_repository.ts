import { ITradeRepository } from './trade_repository.js';
import { TradeRecord, StateTransitionEvent, TradeState } from '../types/trade.types.js';
import { logger } from '../utils/logger.js';
import { getDbPool } from './db.js';

export class PostgresTradeRepository implements ITradeRepository {
  /**
   * Internal queue processor for fire-and-forget non-blocking writes.
   * A true production implementation might use a more sophisticated queue,
   * but an asynchronous retry loop ensures writes don't block the caller.
   */
  private async executeWithRetry(queryText: string, values: any[], retries: number = 3): Promise<void> {
    const pool = getDbPool();
    if (!pool) return; // Dry run or unconfigured

    for (let i = 0; i < retries; i++) {
      try {
        await pool.query(queryText, values);
        return; // Success
      } catch (err: any) {
        logger.error({ err: err.message, query: queryText.substring(0, 50) }, `DB Write failed (attempt ${i + 1}/${retries})`);
        if (i === retries - 1) {
          logger.fatal({ err: err.message, values }, "CRITICAL: Database write completely failed after retries.");
        }
        await new Promise(res => setTimeout(res, 1000 * Math.pow(2, i))); // Exponential backoff
      }
    }
  }

  async saveTrade(trade: TradeRecord): Promise<void> {
    const query = `
      INSERT INTO trades (
        id, alert_id, symbol, state, git_commit_id, strategy_config_snapshot,
        primary_order_id, primary_client_order_id, primary_quantity, primary_entry_price, primary_filled_at,
        secondary_order_id, secondary_client_order_id, secondary_quantity, secondary_limit_price, secondary_filled_at,
        current_position_size, weighted_average_entry_price,
        active_tp_order_id, active_sl_order_id, current_tp_trigger_price, current_sl_trigger_price,
        created_at, updated_at, closed_at, last_error, reconciliation_notes
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11,
        $12, $13, $14, $15, $16,
        $17, $18,
        $19, $20, $21, $22,
        to_timestamp($23 / 1000.0), to_timestamp($24 / 1000.0), $25, $26, $27
      )
      ON CONFLICT (id) DO UPDATE SET
        state = EXCLUDED.state,
        primary_order_id = EXCLUDED.primary_order_id,
        primary_client_order_id = EXCLUDED.primary_client_order_id,
        primary_quantity = EXCLUDED.primary_quantity,
        primary_entry_price = EXCLUDED.primary_entry_price,
        primary_filled_at = EXCLUDED.primary_filled_at,
        secondary_order_id = EXCLUDED.secondary_order_id,
        secondary_client_order_id = EXCLUDED.secondary_client_order_id,
        secondary_quantity = EXCLUDED.secondary_quantity,
        secondary_limit_price = EXCLUDED.secondary_limit_price,
        secondary_filled_at = EXCLUDED.secondary_filled_at,
        current_position_size = EXCLUDED.current_position_size,
        weighted_average_entry_price = EXCLUDED.weighted_average_entry_price,
        active_tp_order_id = EXCLUDED.active_tp_order_id,
        active_sl_order_id = EXCLUDED.active_sl_order_id,
        current_tp_trigger_price = EXCLUDED.current_tp_trigger_price,
        current_sl_trigger_price = EXCLUDED.current_sl_trigger_price,
        updated_at = EXCLUDED.updated_at,
        closed_at = EXCLUDED.closed_at,
        last_error = EXCLUDED.last_error,
        reconciliation_notes = EXCLUDED.reconciliation_notes;
    `;

    const closedAt = trade.closedAt ? `to_timestamp(${trade.closedAt} / 1000.0)` : null;

    const values = [
      trade.id, trade.alertId, trade.symbol, trade.state, trade.gitCommitId, trade.strategyConfigSnapshot,
      trade.primaryOrderId || null, trade.primaryClientOrderId || null, trade.primaryQuantity || null, trade.primaryEntryPrice || null, trade.primaryFilledAt || null,
      trade.secondaryOrderId || null, trade.secondaryClientOrderId || null, trade.secondaryQuantity || null, trade.secondaryLimitPrice || null, trade.secondaryFilledAt || null,
      trade.currentPositionSize, trade.weightedAverageEntryPrice,
      trade.activeTpOrderId || null, trade.activeSlOrderId || null, trade.currentTpTriggerPrice || null, trade.currentSlTriggerPrice || null,
      trade.createdAt, trade.updatedAt || Date.now(), trade.closedAt ? new Date(trade.closedAt) : null, trade.lastError || null, trade.reconciliationNotes || null
    ];

    // FIRE AND FORGET. Do NOT await the promise chain. We just catch unhandled rejections locally.
    this.executeWithRetry(query, values).catch(err => {
      logger.error({ err: err.message }, "Unhandled rejection in saveTrade background write.");
    });
  }

  async getTrade(id: string): Promise<TradeRecord | null> {
    const pool = getDbPool();
    if (!pool) return null;

    const res = await pool.query(`SELECT * FROM trades WHERE id = $1`, [id]);
    if (res.rows.length === 0) return null;
    return this.mapRowToTradeRecord(res.rows[0]);
  }

  async getActiveTrades(): Promise<TradeRecord[]> {
    const pool = getDbPool();
    if (!pool) return [];

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

    const res = await pool.query(`SELECT * FROM trades WHERE state = ANY($1::varchar[])`, [activeStates]);
    return res.rows.map(row => this.mapRowToTradeRecord(row));
  }

  async hasSymbolBeenTraded(symbol: string): Promise<boolean> {
    const pool = getDbPool();
    if (!pool) return false;
    const res = await pool.query(`SELECT 1 FROM trades WHERE symbol = $1 LIMIT 1`, [symbol]);
    return res.rowCount !== null && res.rowCount > 0;
  }

  async recordTransition(event: StateTransitionEvent): Promise<void> {
    const query = `
      INSERT INTO state_transitions (trade_id, from_state, to_state, timestamp, trigger_reason, metadata)
      VALUES ($1, $2, $3, $4, $5, $6)
    `;
    const values = [
      event.tradeId, event.fromState, event.toState, event.timestamp, event.triggerReason, event.metadata || {}
    ];

    // FIRE AND FORGET
    this.executeWithRetry(query, values).catch(err => {
      logger.error({ err: err.message }, "Unhandled rejection in recordTransition background write.");
    });
    
    // Still log immediately to stdout for real-time visibility
    logger.info({ tradeId: event.tradeId, from: event.fromState, to: event.toState, reason: event.triggerReason }, "Trade state transition initiated.");
  }

  async getTransitions(tradeId: string): Promise<StateTransitionEvent[]> {
    const pool = getDbPool();
    if (!pool) return [];

    const res = await pool.query(`SELECT * FROM state_transitions WHERE trade_id = $1 ORDER BY timestamp ASC`, [tradeId]);
    return res.rows.map(row => ({
      tradeId: row.trade_id,
      fromState: row.from_state as TradeState,
      toState: row.to_state as TradeState,
      timestamp: Number(row.timestamp),
      triggerReason: row.trigger_reason,
      metadata: row.metadata
    }));
  }

  private mapRowToTradeRecord(row: any): TradeRecord {
    return {
      id: row.id,
      alertId: row.alert_id,
      symbol: row.symbol,
      state: row.state as TradeState,
      gitCommitId: row.git_commit_id,
      strategyConfigSnapshot: row.strategy_config_snapshot,
      
      primaryOrderId: row.primary_order_id,
      primaryClientOrderId: row.primary_client_order_id,
      primaryQuantity: row.primary_quantity,
      primaryEntryPrice: row.primary_entry_price,
      primaryFilledAt: row.primary_filled_at ? Number(row.primary_filled_at) : undefined,
      
      secondaryOrderId: row.secondary_order_id,
      secondaryClientOrderId: row.secondary_client_order_id,
      secondaryQuantity: row.secondary_quantity,
      secondaryLimitPrice: row.secondary_limit_price,
      secondaryFilledAt: row.secondary_filled_at ? Number(row.secondary_filled_at) : undefined,

      currentPositionSize: row.current_position_size,
      weightedAverageEntryPrice: row.weighted_average_entry_price,

      activeTpOrderId: row.active_tp_order_id,
      activeSlOrderId: row.active_sl_order_id,
      currentTpTriggerPrice: row.current_tp_trigger_price,
      currentSlTriggerPrice: row.current_sl_trigger_price,

      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
      closedAt: row.closed_at ? new Date(row.closed_at).getTime() : undefined,
      
      lastError: row.last_error,
      reconciliationNotes: row.reconciliation_notes
    };
  }
}
