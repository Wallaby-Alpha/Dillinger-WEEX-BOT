import { describe, it, expect } from 'vitest';
import { StrategyEngine } from '../../src/strategy/strategy_engine.js';
import { DEFAULT_STRATEGY_CONFIG } from '../../src/config/strategy.config.js';
import { CooldownTracker } from '../../src/strategy/cooldown_tracker.js';
import { MockExecutionAdapter } from '../../src/execution/adapters/mock/mock_adapter.js';
import { InMemoryTradeRepository } from '../../src/database/trade_repository.js';
import { TradeStateMachine } from '../../src/execution/trade_state_machine.js';
import { ReconciliationEngine } from '../../src/execution/reconciler.js';

import { TradeState } from '../../src/types/trade.types.js';
import * as fs from 'fs';
import * as path from 'path';

describe('Phase 5: Reconciliation Engine Integration Tests', () => {
  const cooldownPath = path.resolve(process.cwd(), '.test_reconcile_cooldown.json');

  it('should detect native exchange TP/SL closure and finalize trade with cooldown', async () => {
    const adapter = new MockExecutionAdapter();
    const repository = new InMemoryTradeRepository();
    const cooldownTracker = new CooldownTracker(cooldownPath);
    const strategyEngine = new StrategyEngine(undefined, cooldownTracker);
    const stateMachine = new TradeStateMachine(adapter, repository, cooldownTracker);
    const reconciler = new ReconciliationEngine(stateMachine, adapter, repository);

    const alert = {
      alertId: 'alert_test_SOLUSDT',
      symbol: 'SOLUSDT',
      timestamp: Date.now(),
      source: 'TEST',
      rawText: '$SOL Long Signal'
    };
    const meta = await adapter.getSymbolMetadata(alert.symbol);

    const decision = strategyEngine.evaluateAlert(
      alert,
      180.0,
      100.0,
      0,
      meta
    );

    const trade = await stateMachine.startTrade(decision, alert);
    expect(trade.state).toBe(TradeState.POSITION_PROTECTED);

    // Simulate exchange executing native Stop Loss (position flattens)
    await adapter.closePositionMarket(trade.symbol, 'LONG', trade.currentPositionSize);

    // Run reconciliation cycle
    await reconciler.reconcileCycle();

    // Verify trade was transitioned to CLOSED_VERIFIED
    const updatedTrade = await repository.getTrade(trade.id);
    expect(updatedTrade?.state).toBe(TradeState.CLOSED_VERIFIED);

    const cooldown = cooldownTracker.isCoolingDown(trade.symbol);
    expect(cooldown.active).toBe(true);

    if (fs.existsSync(cooldownPath)) {
      fs.unlinkSync(cooldownPath);
    }
  });

  it('should force-close trade when lifetime exceeds tradeTimeoutSec', async () => {
    const adapter = new MockExecutionAdapter();
    const repository = new InMemoryTradeRepository();
    const cooldownTracker = new CooldownTracker(cooldownPath);
    const strategyEngine = new StrategyEngine({ ...DEFAULT_STRATEGY_CONFIG, tradeTimeoutSec: 1 }, cooldownTracker);
    const stateMachine = new TradeStateMachine(adapter, repository, cooldownTracker);
    const reconciler = new ReconciliationEngine(stateMachine, adapter, repository);

    const alert = {
      alertId: 'alert_test_ETHUSDT',
      symbol: 'ETHUSDT',
      timestamp: Date.now(),
      source: 'TEST',
      rawText: '$ETH Signal'
    };
    const meta = await adapter.getSymbolMetadata(alert.symbol);

    const decision = strategyEngine.evaluateAlert(
      alert,
      2600.0,
      100.0,
      0,
      meta
    );

    const trade = await stateMachine.startTrade(decision, alert);
    // Backdate trade creation time by 10 seconds
    trade.createdAt = Date.now() - 10000;
    await repository.saveTrade(trade);

    // Run reconciliation cycle
    await reconciler.reconcileCycle();

    const updatedTrade = await repository.getTrade(trade.id);
    expect(updatedTrade?.state).toBe(TradeState.CLOSED_VERIFIED);

    if (fs.existsSync(cooldownPath)) {
      fs.unlinkSync(cooldownPath);
    }
  });
});
