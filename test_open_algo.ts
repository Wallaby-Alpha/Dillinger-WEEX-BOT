import { WeexRestClient } from './src/execution/adapters/weex/weex_client.js';
import { WeexExecutionAdapter } from './src/execution/adapters/weex/weex_adapter.js';

async function testOpenAlgoOrders() {
  const client = new WeexRestClient();
  const adapter = new WeexExecutionAdapter(client);
  
  console.log("1. Entering a tiny test position...");
  const entry = await adapter.submitEntryOrder({
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'MARKET',
    positionSide: 'LONG',
    quantity: '0.001',
    clientOrderId: 'test-algo-entry'
  });
  console.log("Entry:", entry);

  console.log("2. Fetching position to get entry price...");
  const pos = await adapter.getActivePosition('BTCUSDT');
  console.log("Position:", pos);
  
  if (!pos) return;

  const tpPrice = (pos.entryPrice * 1.05).toFixed(1); // +5%

  console.log(`3. Placing TP algo order at ${tpPrice}...`);
  const algoRes = await adapter.establishWholePositionProtection({
    symbol: 'BTCUSDT',
    positionSide: 'LONG',
    planType: 'TAKE_PROFIT',
    triggerPrice: tpPrice,
    clientAlgoId: 'test-algo-tp'
  });
  console.log("Algo Place Result:", algoRes);

  console.log("4. Querying openAlgoOrders...");
  const openAlgo = await client.request('GET', '/capi/v3/openAlgoOrders?symbol=BTCUSDT');
  console.log("Open Algo Data:", JSON.stringify(openAlgo.data, null, 2));

  console.log("5. Closing position and cancelling algos...");
  await adapter.closePositionMarket('BTCUSDT', 'LONG', pos.size);
  console.log("Position closed.");
}

testOpenAlgoOrders();
