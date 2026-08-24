import 'dotenv/config';
import { WeexRestClient } from './src/execution/adapters/weex/weex_client.js';
import { WeexExecutionAdapter } from './src/execution/adapters/weex/weex_adapter.js';
import { PostgresTradeRepository } from './src/database/postgres_trade_repository.js';
import { performStartupReconciliation } from './src/index.js'; // I'll need to export this or extract the logic
import { ENV } from './src/config/env.js';
import { logger } from './src/utils/logger.js';
import { StrategyEngine } from './src/strategy/strategy_engine.js';
import { WeexMomentumBot } from './src/index.js'; // Or whatever main class

async function runScenario1() {
  console.log("=== SCENARIO 1: UNPROTECTED ORPHAN ===");
  const client = new WeexRestClient();
  const adapter = new WeexExecutionAdapter(client);
  console.log("1. Entering tiny test position (BTCUSDT LONG 0.001)...");
  await adapter.submitEntryOrder({
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'MARKET',
    positionSide: 'LONG',
    quantity: '0.001',
    clientOrderId: `test-entry-${Date.now()}`
  });
  
  console.log("2. Ensuring no DB record exists for this position...");
  // No need to delete if we just created it outside the state machine, there is no DB record.
  
  console.log("3. Triggering startup reconciliation...");
  const engine = new StrategyEngine({});
  // In index.ts, the startup logic runs on boot. We can just import and run the bot initialization or copy the logic.
  // Actually, we can just run the bot itself: `tsx src/index.ts` in a subprocess, and watch the logs.
}

async function runScenario2() {
  console.log("=== SCENARIO 2: PROTECTED ORPHAN ===");
  const client = new WeexRestClient();
  const adapter = new WeexExecutionAdapter(client);
  
  console.log("1. Entering tiny test position (BTCUSDT LONG 0.001)...");
  await adapter.submitEntryOrder({
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'MARKET',
    positionSide: 'LONG',
    quantity: '0.001',
    clientOrderId: `test-entry-${Date.now()}`
  });
  
  const pos = await adapter.getActivePosition('BTCUSDT');
  if (!pos) {
    console.error("Position not found!");
    return;
  }
  
  console.log(`2. Placing TP algo order at ${(pos.entryPrice * 1.05).toFixed(1)}...`);
  await adapter.establishWholePositionProtection({
    symbol: 'BTCUSDT',
    positionSide: 'LONG',
    planType: 'TAKE_PROFIT',
    triggerPrice: (pos.entryPrice * 1.05).toFixed(1),
    clientAlgoId: `test-tp-${Date.now()}`
  });
  
  console.log("3. Ensuring no DB record exists for this position...");
  
  console.log("4. Start bot to trigger reconciliation...");
}

const args = process.argv.slice(2);
if (args[0] === 'scenario1') {
  runScenario1().then(() => process.exit(0)).catch(console.error);
} else if (args[0] === 'scenario2') {
  runScenario2().then(() => process.exit(0)).catch(console.error);
} else {
  console.log("Usage: npx tsx test_orphan_recovery.ts [scenario1|scenario2]");
}
