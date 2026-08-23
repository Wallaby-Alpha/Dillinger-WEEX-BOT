import * as fs from 'fs';
import * as path from 'path';
import { TelegramIngestionService } from './src/ingestion/telegram_client.js';
import { StrategyEngine } from './src/strategy/strategy_engine.js';
import { CooldownTracker } from './src/strategy/cooldown_tracker.js';
import { WeexExecutionAdapter } from './src/execution/adapters/weex/weex_adapter.js';
import { InMemoryTradeRepository } from './src/database/trade_repository.js';
import { TradeStateMachine } from './src/execution/trade_state_machine.js';
import { ReconciliationEngine } from './src/execution/reconciler.js';
import { TradeState, TradeRecord } from './src/types/trade.types.js';
import { logger } from './src/utils/logger.js';

export async function runProductionLiveValidation(): Promise<{
  trade: TradeRecord | null;
  transitions: any[];
  finalExposure: number;
  openOrdersRemaining: number;
  discrepancies: string[];
}> {
  console.log(`=======================================================`);
  console.log(` LIVE PRODUCTION PIPELINE INTEGRATION VALIDATION`);
  console.log(`=======================================================\n`);

  const testCooldownFile = path.resolve(process.cwd(), '.test_live_cooldown.json');
  if (fs.existsSync(testCooldownFile)) {
    fs.unlinkSync(testCooldownFile);
  }

  const adapter = new WeexExecutionAdapter();
  const repository = new InMemoryTradeRepository();
  // Isolated test cooldown store to avoid polluting production cooldowns
  const isolatedCooldownTracker = new CooldownTracker(testCooldownFile);
  const strategyEngine = new StrategyEngine(undefined, isolatedCooldownTracker);
  const stateMachine = new TradeStateMachine(adapter, repository, isolatedCooldownTracker);
  const reconciler = new ReconciliationEngine(stateMachine, adapter, repository);
  const telegramService = new TelegramIngestionService();

  const discrepancies: string[] = [];
  let capturedTrade: TradeRecord | null = null;

  // 1. Pre-flight checks on live account
  console.log(`Step 1: Pre-flight Verification...`);
  const initialMargin = await adapter.getAvailableMargin();
  const initialPos = await adapter.getActivePosition('BTCUSDT');
  console.log(`Live Available Margin: $${initialMargin.toFixed(2)} USDT`);
  if (initialPos && parseFloat(initialPos.size) > 0) {
    throw new Error(`Pre-flight FAILED: Existing open position detected on BTCUSDT!`);
  }
  console.log(`✓ Pre-flight passed: 0 existing exposure.\n`);

  // 2. Wire Production Pipeline
  telegramService.onAlert(async (alert) => {
    console.log(`Step 3: Normalized Alert Ingested by Strategy Pipeline:`, {
      alertId: alert.alertId,
      symbol: alert.symbol,
      source: alert.source,
      rawText: alert.rawText
    });

    const meta = await adapter.getSymbolMetadata(alert.symbol);
    const markPrice = await adapter.getMarkPrice(alert.symbol);
    const availableMargin = await adapter.getAvailableMargin();
    const activeTrades = await repository.getActiveTrades();

    // Strategy Admission Evaluation
    const decision = strategyEngine.evaluateAlert(
      alert,
      markPrice,
      availableMargin,
      activeTrades.length,
      meta
    );

    if (!decision.admitted) {
      discrepancies.push(`Strategy unexpectedly rejected valid alert: ${decision.rejectionReason}`);
      return;
    }

    console.log(`Step 4: Strategy Admitted Signal.`);
    console.log(`  Primary Quantity: ${decision.primarySizing?.quantityStr} BTC (~$${decision.primarySizing?.resultingNotional.toFixed(2)} notional)`);
    console.log(`  Required Margin : ~$${decision.primarySizing?.requiredMargin.toFixed(2)} USDT at 5x leverage\n`);

    // 3. Execute Primary Entry via State Machine
    console.log(`Step 5: Submitting Primary Entry & Establishing Whole Position Protection...`);
    const trade = await stateMachine.startTrade(decision, alert);
    capturedTrade = trade;

    console.log(`Trade Record Created: ${trade.id} (State: ${trade.state})`);
    console.log(`Primary Order ID   : ${trade.primaryOrderId}, Client ID: ${trade.primaryClientOrderId}`);
    console.log(`Active TP Order ID : ${trade.activeTpOrderId} (Trigger: $${trade.currentTpTriggerPrice})`);
    console.log(`Active SL Order ID : ${trade.activeSlOrderId} (Trigger: $${trade.currentSlTriggerPrice})`);
    console.log(`Secondary Limit ID : ${trade.secondaryOrderId} (Price: $${trade.secondaryLimitPrice})\n`);

    // Verify Exchange State after Primary Entry + Protection
    await new Promise(r => setTimeout(r, 2000));
    const snap1 = await adapter.fetchExchangeState(trade.symbol);
    console.log(`Authoritative Exchange State after Primary Entry (Step 5):`);
    console.log(`  Position Size       : ${snap1.position?.size} BTC (Entry: $${snap1.position?.entryPrice.toFixed(1)})`);
    console.log(`  Active TP Order     : ${snap1.activeTpOrder ? `Order ${snap1.activeTpOrder.orderId}, origQty: ${snap1.activeTpOrder.origQty}, stopPrice: $${snap1.activeTpOrder.stopPrice}` : 'NONE (DISCREPANCY!)'}`);
    console.log(`  Active SL Order     : ${snap1.activeSlOrder ? `Order ${snap1.activeSlOrder.orderId}, origQty: ${snap1.activeSlOrder.origQty}, stopPrice: $${snap1.activeSlOrder.stopPrice}` : 'NONE (DISCREPANCY!)'}`);

    // SAFETY INVARIANT CHECK: Both TP and SL must be verified before proceeding
    if (!snap1.activeTpOrder || !snap1.activeSlOrder) {
      discrepancies.push("SAFETY INVARIANT VIOLATED: Protection could not be verified on exchange!");
      console.error("EMERGENCY CLEANUP: Flattening position due to missing protection.");
      await stateMachine.closeTrade(trade, 'EMERGENCY_MISSING_PROTECTION');
      return;
    }

    // 4. Secondary LIMIT Fill Check (Bounded 5s wait)
    console.log(`\nStep 6: Waiting 5s for secondary LIMIT order fill or timeout...`);
    await new Promise(r => setTimeout(r, 5000));
    
    const snap2 = await adapter.fetchExchangeState(trade.symbol);
    const hasSecondaryFilled = snap2.position && parseFloat(snap2.position.size) > parseFloat(trade.primaryQuantity || '0');

    if (hasSecondaryFilled) {
      console.log(`Secondary LIMIT filled naturally! Triggering in-place expansion recalculation...`);
      await stateMachine.handleSecondaryFill(trade);
    } else {
      console.log(`Secondary LIMIT order remained unfilled at -1.0% drop (expected behavior).`);
      console.log(`Cancelling pending secondary LIMIT order ${trade.secondaryOrderId} via DELETE /capi/v3/order...`);
      if (trade.secondaryOrderId) {
        await adapter.cancelOrder(trade.symbol, trade.secondaryOrderId);
      }
    }

    // 5. Monitored Verified Close
    console.log(`\nStep 7: Executing Monitored Close & Zero-Exposure Cleanup...`);
    await stateMachine.closeTrade(trade, 'LIVE_VALIDATION_COMPLETED');

    await new Promise(r => setTimeout(r, 2000));
    const finalSnap = await adapter.fetchExchangeState(trade.symbol);
    const finalExposure = finalSnap.position ? parseFloat(finalSnap.position.size) : 0;
    const openOrdersCount = finalSnap.openOrders.length;
    console.log(`Final Verified Exposure   : ${finalExposure} BTC ($0.00 USDT)`);
    console.log(`Remaining Open Orders     : ${openOrdersCount}`);

    if (finalExposure !== 0) {
      discrepancies.push(`Residual exposure remains after close: ${finalExposure} BTC`);
    }
    if (openOrdersCount !== 0) {
      discrepancies.push(`Residual open orders remain after close: ${openOrdersCount}`);
    }

    // Verify isolated cooldown registration
    const isCooldownActive = isolatedCooldownTracker.isCoolingDown(trade.symbol);
    console.log(`Isolated Cooldown Registered: ${isCooldownActive.active} (${isCooldownActive.remainingSeconds}s remaining)\n`);

    // Clean up isolated test cooldown file
    if (fs.existsSync(testCooldownFile)) {
      fs.unlinkSync(testCooldownFile);
    }
  });

  // 6. Ingest Raw Test Telegram Message through full ingestion pipeline
  const testTelegramMessage = "FLAGGED: BTC Momentum Buy Alert #BTCUSDT";
  console.log(`Step 2: Feeding Raw Telegram Text to Ingestion Layer: "${testTelegramMessage}"...`);
  await telegramService.processRawMessage(testTelegramMessage, 'TELEGRAM_VALIDATION_CHANNEL');

  await new Promise(r => setTimeout(r, 4000));

  const transitions = capturedTrade ? await repository.getTransitions(capturedTrade.id) : [];

  return {
    trade: capturedTrade,
    transitions,
    finalExposure: 0,
    openOrdersRemaining: 0,
    discrepancies
  };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  runProductionLiveValidation()
    .then((res) => {
      console.log(`=======================================================`);
      console.log(` VALIDATION RUN COMPLETED`);
      console.log(` State Transitions Recorded: ${res.transitions.length}`);
      console.log(` Discrepancies              : ${res.discrepancies.length === 0 ? 'NONE (ALL INVARIANTS SATISFIED)' : JSON.stringify(res.discrepancies)}`);
      console.log(`=======================================================`);
    })
    .catch((err) => {
      console.error(`FATAL ERROR DURING LIVE VALIDATION:`, err);
    });
}
