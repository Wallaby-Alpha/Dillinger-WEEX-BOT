import * as dotenv from 'dotenv';
import crypto from 'crypto';
import { WeexExecutionAdapter } from './src/execution/adapters/weex/weex_adapter.js';

dotenv.config();

async function testCanonicalProtectionVerification() {
  console.log("===================================================================");
  console.log(" CANONICAL PROTECTION VERIFICATION POSITIVE & NEGATIVE LIVE TEST");
  console.log("===================================================================\n");

  const adapter = new WeexExecutionAdapter();

  // 1. Open 0.0001 BTC position
  console.log("1. Opening 0.0001 BTC LONG position...");
  const entryRes = await adapter.submitEntryOrder({
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'MARKET',
    positionSide: 'LONG',
    quantity: '0.0001',
    clientOrderId: `b-canon-open-${Date.now()}`
  });
  console.log("Entry Order ID:", entryRes.orderId);

  // 2. Establish Whole TP and SL
  console.log("\n2. Establishing Native Whole TP and SL...");
  const tpRes = await adapter.establishWholePositionProtection({
    symbol: 'BTCUSDT',
    positionSide: 'LONG',
    planType: 'TAKE_PROFIT',
    triggerPrice: '81500.0',
    clientAlgoId: `b-canon-tp-${Date.now()}`
  });

  const slRes = await adapter.establishWholePositionProtection({
    symbol: 'BTCUSDT',
    positionSide: 'LONG',
    planType: 'STOP_LOSS',
    triggerPrice: '73500.0',
    clientAlgoId: `b-canon-sl-${Date.now()}`
  });

  console.log(`TP Order ID: ${tpRes.orderId}, SL Order ID: ${slRes.orderId}`);

  // 3. POSITIVE VERIFICATION (Independent exchange query)
  console.log("\n3. Running POSITIVE verification via canonical verifyProtectionOrder()...");
  const tpVerify = await adapter.verifyProtectionOrder('BTCUSDT', tpRes.orderId!);
  const slVerify = await adapter.verifyProtectionOrder('BTCUSDT', slRes.orderId!);

  console.log("TP Authoritative Exchange Read:", tpVerify);
  console.log("SL Authoritative Exchange Read:", slVerify);

  if (!tpVerify || (tpVerify.status !== 'UNTRIGGERED' && tpVerify.status !== 'NEW') || tpVerify.stopPrice !== '81500.0') {
    throw new Error(`Positive check FAILED for TP: ${JSON.stringify(tpVerify)}`);
  }
  if (!slVerify || (slVerify.status !== 'UNTRIGGERED' && slVerify.status !== 'NEW') || slVerify.stopPrice !== '73500.0') {
    throw new Error(`Positive check FAILED for SL: ${JSON.stringify(slVerify)}`);
  }
  console.log("✓ Positive Check PASSED: Both TP and SL confirmed independently active ('NEW') on exchange.\n");

  // 4. NEGATIVE VERIFICATION: Close position to cancel protection
  console.log("4. Closing position (triggers automatic WEEX protection cancellation)...");
  await adapter.closePositionMarket('BTCUSDT', 'LONG', '0.0001');

  await new Promise(r => setTimeout(r, 1500));

  console.log("\n5. Running NEGATIVE verification on the cancelled order IDs...");
  const tpAfter = await adapter.verifyProtectionOrder('BTCUSDT', tpRes.orderId!);
  const slAfter = await adapter.verifyProtectionOrder('BTCUSDT', slRes.orderId!);

  console.log("TP Read After Close (Expect null):", tpAfter);
  console.log("SL Read After Close (Expect null):", slAfter);

  if (tpAfter !== null) {
    throw new Error(`Negative check FAILED: TP still active after position close! ${JSON.stringify(tpAfter)}`);
  }
  if (slAfter !== null) {
    throw new Error(`Negative check FAILED: SL still active after position close! ${JSON.stringify(slAfter)}`);
  }
  console.log("✓ Negative Check PASSED: Both TP and SL confirmed absent/inactive after position close.\n");

  console.log("===================================================================");
  console.log(" ALL POSITIVE & NEGATIVE CANONICAL VERIFICATIONS PASSED!");
  console.log("===================================================================");
}

testCanonicalProtectionVerification().catch(err => {
  console.error("FATAL ERROR IN TEST:", err);
  process.exit(1);
});
