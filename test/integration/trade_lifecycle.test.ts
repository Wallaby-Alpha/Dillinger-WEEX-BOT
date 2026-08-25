import { describe, it, expect } from 'vitest';
import { StrategyEngine } from '../../src/strategy/strategy_engine.js';
import { createStrategyConfigSnapshot } from '../../src/config/strategy.config.js';
import { CooldownTracker } from '../../src/strategy/cooldown_tracker.js';
import { MockExecutionAdapter } from '../../src/execution/adapters/mock/mock_adapter.js';
import { InMemoryTradeRepository } from '../../src/database/trade_repository.js';
import { TradeStateMachine } from '../../src/execution/trade_state_machine.js';

import { TradeState } from '../../src/types/trade.types.js';
import * as fs from 'fs';
import * as path from 'path';

describe('Phase 5: End-to-End Trade Lifecycle Integration Suite', () => {
  const cooldownPath = path.resolve(process.cwd(), '.test_lifecycle_cooldown.json');

  it('should process alert -> strategy admission -> entry -> protection -> expansion -> close -> cooldown', async () => {
    // 1. Setup decoupled layers
    const adapter = new MockExecutionAdapter();
    const repository = new InMemoryTradeRepository();
    const cooldownTracker = new CooldownTracker(cooldownPath);
    const customConfig = createStrategyConfigSnapshot({
      secondaryNotionalUsd: 35.00,
      primaryNotionalUsd: 35.00,
      secondaryEntryDropPct: 0.01
    });
    const strategyEngine = new StrategyEngine(customConfig, cooldownTracker);
    const stateMachine = new TradeStateMachine(adapter, repository, cooldownTracker);

    const alert = {
      alertId: 'alert_test_BTCUSDT',
      symbol: 'BTCUSDT',
      timestamp: Date.now(),
      source: 'TEST',
      rawText: 'FLAGGED: BTC Momentum Buy Signal'
    };

    // 3. Strategy Layer: Evaluate alert against strategy rules
    const meta = await adapter.getSymbolMetadata(alert.symbol);
    const markPrice = await adapter.getMarkPrice(alert.symbol);
    const availableMargin = await adapter.getAvailableMargin();

    const decision = strategyEngine.evaluateAlert(
      alert,
      markPrice,
      availableMargin,
      0, // active trades
      meta
    );

    expect(decision.admitted).toBe(true);
    expect(decision.configSnapshot.version).toBe('1.1.0');

    // 4. Execution Layer: Initiate trade lifecycle
    const trade = await stateMachine.startTrade(decision, alert);

    expect(trade.state).toBe(TradeState.SECONDARY_LIMIT_SUBMITTED);
    expect(trade.currentPositionSize).toBe('0.0004');
    expect(trade.activeTpOrderId).toBeDefined();
    expect(trade.activeSlOrderId).toBeDefined();
    expect(trade.gitCommitId).toBeDefined();

    // Verify native whole protection on exchange
    const snap1 = await adapter.fetchExchangeState(trade.symbol);
    expect(snap1.activeTpOrder?.origQty).toBe('0.0000');
    expect(snap1.activeSlOrder?.origQty).toBe('0.0000');

    // 5. Simulate secondary entry fill
    await adapter.submitEntryOrder({
      symbol: trade.symbol,
      side: 'BUY',
      type: 'MARKET',
      positionSide: 'LONG',
      quantity: '0.0004',
      clientOrderId: 'b-sec-sim'
    });

    await stateMachine.handleSecondaryFill(trade);
    expect(trade.state).toBe(TradeState.EXPANDED_PROTECTED);
    expect(trade.currentPositionSize).toBe('0.0008');

    // 6. Close trade and verify zero exposure and cooldown
    await stateMachine.closeTrade(trade, 'TAKE_PROFIT_TRIGGERED');
    expect(trade.state).toBe(TradeState.CLOSED_VERIFIED);
    expect(trade.closedAt).toBeDefined();

    const finalSnap = await adapter.fetchExchangeState(trade.symbol);
    expect(finalSnap.position).toBeNull();

    // Verify 0-hour cooldown for Take Profit
    const cooldownStatus = cooldownTracker.isCoolingDown(trade.symbol);
    expect(cooldownStatus.active).toBe(false);

    if (fs.existsSync(cooldownPath)) {
      fs.unlinkSync(cooldownPath);
    }
  });
});
