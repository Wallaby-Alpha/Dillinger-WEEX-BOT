import * as dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const API_KEY = process.env.WEEX_API_KEY || '';
const API_SECRET = process.env.WEEX_API_SECRET || '';
const PASSPHRASE = process.env.WEEX_PASSPHRASE || '';
const BASE_URL = 'https://api-contract.weex.com';

function sign(timestamp: string, method: string, path: string, body?: string) {
  const str = timestamp + method + path + (body || '');
  return crypto.createHmac('sha256', API_SECRET).update(str).digest('base64');
}

async function request(method: string, path: string, body?: any) {
  const timestamp = Date.now().toString();
  const bodyStr = body ? JSON.stringify(body) : '';
  const signature = sign(timestamp, method, path, bodyStr);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'ACCESS-KEY': API_KEY,
    'ACCESS-SIGN': signature,
    'ACCESS-TIMESTAMP': timestamp,
    'ACCESS-PASSPHRASE': PASSPHRASE,
    'User-Agent': 'WeexProbe/1.0'
  };
  const res = await fetch(BASE_URL + path, {
    method,
    headers,
    body: (method !== 'GET' && method !== 'DELETE') ? bodyStr : undefined
  });
  const d = await res.json();
  console.log(`[${res.status}] ${method} ${path}:`, JSON.stringify(d, null, 2));
  return { status: res.status, data: d };
}

async function testLiveModify() {
  console.log("=== STEP 1: OPENING 0.0002 BTC TEST POSITION ===");
  const openRes = await request('POST', '/capi/v3/order', {
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'MARKET',
    positionSide: 'LONG',
    quantity: '0.0002',
    newClientOrderId: `b-test-modify-${Date.now()}`
  });

  await new Promise(r => setTimeout(r, 1500));

  console.log("\n=== STEP 2: CREATING WHOLE-POSITION SL ===");
  const slRes = await request('POST', '/capi/v3/placeTpSlOrder', {
    symbol: 'BTCUSDT',
    clientAlgoId: `b-algo-sl-${Date.now()}`,
    planType: 'STOP_LOSS',
    triggerPrice: '75000.0',
    positionSide: 'LONG',
    executePrice: '0',
    quantity: '0',
    triggerPriceType: 'CONTRACT_PRICE'
  });
  const orderId = slRes.data?.[0]?.orderId || slRes.data?.orderId;
  console.log("Created SL Order ID:", orderId);

  await new Promise(r => setTimeout(r, 1500));

  console.log("\n=== STEP 3: TESTING modifyTpSlOrder ===");
  await request('POST', '/capi/v3/modifyTpSlOrder', {
    symbol: 'BTCUSDT',
    orderId: orderId.toString(),
    triggerPrice: '75500.0',
    executePrice: '0'
  });

  await new Promise(r => setTimeout(r, 1500));

  console.log("\n=== STEP 4: FLATTENING POSITION ===");
  await request('POST', '/capi/v3/order', {
    symbol: 'BTCUSDT',
    side: 'SELL',
    type: 'MARKET',
    positionSide: 'LONG',
    quantity: '0.0002',
    newClientOrderId: `b-close-modify-${Date.now()}`
  });

  console.log("\n=== STEP 5: VERIFYING ZERO POSITION ===");
  await request('GET', '/capi/v3/account/position/allPosition');
}

testLiveModify();
