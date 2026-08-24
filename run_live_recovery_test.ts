import { WeexExecutionAdapter } from './src/execution/adapters/weex/weex_adapter.js';
import { PostgresTradeRepository } from './src/database/postgres_trade_repository.js';
import { StrategyEngine } from './src/strategy/strategy_engine.js';
import { TradeStateMachine } from './src/execution/trade_state_machine.js';
import { ReconciliationEngine } from './src/execution/reconciler.js';
import { getGitCommitId } from './src/utils/git_info.js';
import { TradeState } from './src/types/trade.types.js';
import { logger } from './src/utils/logger.js';
import { getDbPool } from './src/database/db.js';

async function verifyOrphan(adapter: WeexExecutionAdapter, repository: PostgresTradeRepository, strategyEngine: StrategyEngine) {
  logger.info("Executing startup exchange reconciliation...");
  try {
    const margin = await adapter.getAvailableMargin();
    logger.info({ availableMarginUsdt: margin }, "WEEX exchange connectivity verified.");

    const activeExchangePositions = await adapter.getActivePositions();
    const activeDbTrades = await repository.getActiveTrades();
    const activeDbSymbols = new Set(activeDbTrades.map(t => t.symbol));

    for (const pos of activeExchangePositions) {
      if (!activeDbSymbols.has(pos.symbol)) {
        logger.warn({ symbol: pos.symbol, size: pos.size }, "Found orphaned exchange position without active DB trade.");
        
        let isProtected = false;
        
        // Use WEEX V3 ID from payload, or search explicitly
        if (pos.activeTpOrderId || pos.activeSlOrderId) {
           const tpId = pos.activeTpOrderId;
           if (tpId) {
             const summary = await adapter.verifyProtectionOrder(pos.symbol, tpId);
             if (summary && (summary.status === 'NEW' || summary.status === 'UNTRIGGERED')) {
                isProtected = true;
             }
           }
        }
        
        if (isProtected) {
          logger.info({ symbol: pos.symbol }, "PROTECTED ORPHAN: Reconstructing trade record to resume tracking.");
          
          const reconstructedTrade = {
            id: `trade_${pos.symbol}_recovered_${Date.now()}`,
            alertId: `alert_${pos.symbol}_recovered_${Date.now()}`,
            symbol: pos.symbol,
            state: TradeState.POSITION_PROTECTED,
            gitCommitId: getGitCommitId(),
            strategyConfigSnapshot: strategyEngine.getConfig(),
            primaryQuantity: pos.size,
            primaryEntryPrice: pos.entryPrice,
            currentPositionSize: pos.size,
            weightedAverageEntryPrice: pos.entryPrice,
            activeTpOrderId: pos.activeTpOrderId,
            activeSlOrderId: pos.activeSlOrderId,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            reconciliationNotes: "Recovered from protected orphan on startup"
          };
          
          await repository.saveTrade(reconstructedTrade);
          logger.info({ tradeId: reconstructedTrade.id }, "Recovered trade persisted. Resuming normal lifecycle monitoring.");
        } else {
          logger.error({ symbol: pos.symbol }, "UNPROTECTED ORPHAN: NO UNPROTECTED POSITION INVARIANT VIOLATED. ROUTING TO EMERGENCY CLOSE.");
          
          try {
             await adapter.closePositionMarket(pos.symbol, pos.side, pos.size);
             logger.info({ symbol: pos.symbol }, "Emergency close order submitted for unprotected orphan.");
             
             // Wait briefly to allow exchange to process the market order
             await new Promise(r => setTimeout(r, 2000));
             
             // Verify zero exposure
             const remaining = await adapter.getActivePosition(pos.symbol);
             if (remaining) {
               logger.fatal({ symbol: pos.symbol, remainingSize: remaining.size }, "Exposure remains after emergency close!");
             } else {
               logger.info({ symbol: pos.symbol }, "Verified 0 exposure after emergency close.");
             }
          } catch (err: any) {
             logger.fatal({ err: err.message, symbol: pos.symbol }, "CRITICAL: Emergency close for unprotected orphan failed. Halting bot with unresolved exposure!");
             process.exit(1);
          }
        }
      }
    }

  } catch (err: any) {
    logger.error({ err: err.message }, "Failed initial exchange connectivity check on startup.");
  }
}

async function runLiveRecoveryTest() {
  const adapter = new WeexExecutionAdapter();
  const repository = new PostgresTradeRepository();
  const strategyEngine = new StrategyEngine();
  const symbol = 'BTCUSDT';

  logger.info("=========================================");
  logger.info("   LIVE CRASH RECOVERY TEST STARTED      ");
  logger.info("=========================================");

  try {
    // === SCENARIO 1: UNPROTECTED ORPHAN ===
    logger.info("--- SCENARIO 1: UNPROTECTED ORPHAN ---");
    // 1. Manually submit a tiny MARKET entry directly via adapter (simulating UI entry or crash before protection)
    logger.info("Submitting tiny unprotected live order (0.001 BTC)...");
    await adapter.submitEntryOrder({
      symbol,
      side: 'BUY',
      type: 'MARKET',
      positionSide: 'LONG',
      quantity: '0.001',
      clientOrderId: `b-test-${Date.now()}`
    });
    
    // Wait for fill
    await new Promise(r => setTimeout(r, 2000));
    const rawPos1 = await adapter.getActivePosition(symbol);
    logger.info({ rawPos1 }, "Current position state before boot (Should be UNPROTECTED)");

    // 2. Run startup reconciliation
    logger.info("--- BOOTING BOT (Should detect UNPROTECTED ORPHAN) ---");
    await verifyOrphan(adapter, repository, strategyEngine);

    // Wait and verify
    await new Promise(r => setTimeout(r, 2000));
    const zeroPos = await adapter.getActivePosition(symbol);
    logger.info({ zeroPos }, "Position state after Unprotected Orphan recovery (Should be NULL/0)");

    // === SCENARIO 2: PROTECTED ORPHAN ===
    logger.info("--- SCENARIO 2: PROTECTED ORPHAN ---");
    // 1. Manually submit entry AND protection
    logger.info("Submitting tiny protected live order (0.001 BTC)...");
    await adapter.submitEntryOrder({
      symbol,
      side: 'BUY',
      type: 'MARKET',
      positionSide: 'LONG',
      quantity: '0.001',
      clientOrderId: `b-test2-${Date.now()}`
    });
    
    await new Promise(r => setTimeout(r, 2000));
    
    logger.info("Submitting whole position protection...");
    await adapter.establishWholePositionProtection({
      symbol,
      planType: 'TAKE_PROFIT',
      triggerPrice: '100000',
      positionSide: 'LONG',
      clientAlgoId: `b-algo-${Date.now()}`
    });

    await new Promise(r => setTimeout(r, 2000));
    const rawPos2 = await adapter.getActivePosition(symbol);
    logger.info({ rawPos2 }, "Current position state before boot (Should be PROTECTED)");

    // 2. Verify protection explicitly
    if (rawPos2 && rawPos2.activeTpOrderId) {
      const summary = await adapter.verifyProtectionOrder(symbol, rawPos2.activeTpOrderId);
      logger.info({ summary }, "verifyProtectionOrder() Output just before kill/restart");
    }

    // 3. Run startup reconciliation
    logger.info("--- BOOTING BOT (Should detect PROTECTED ORPHAN) ---");
    await verifyOrphan(adapter, repository, strategyEngine);

    // Verify it was persisted
    const activeDbTrades = await repository.getActiveTrades();
    const recoveredTrade = activeDbTrades.find(t => t.symbol === symbol);
    logger.info({ recoveredTrade }, "Recovered trade record in Database");

    // Clean up
    logger.info("Cleaning up protected position...");
    await adapter.closePositionMarket(symbol, 'LONG', '0.001');
    if (rawPos2 && rawPos2.activeTpOrderId) {
       await adapter.cancelOrder(symbol, rawPos2.activeTpOrderId);
    }
    
    logger.info("LIVE CRASH RECOVERY TEST COMPLETED SUCCESSFULLY.");
  } catch (err: any) {
    logger.fatal({ err: err.message, stack: err.stack }, "Test failed.");
  } finally {
    const pool = getDbPool();
    if (pool) await pool.end();
  }
}

runLiveRecoveryTest();
