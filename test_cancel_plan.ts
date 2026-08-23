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
  if (res.status !== 404) {
    console.log(`FOUND [${res.status}] ${method} ${path}:`, await res.json());
  }
}

async function discoverCancel() {
  const dummyId = '786249500753658600';
  await request('DELETE', `/capi/v3/order?symbol=BTCUSDT&orderId=${dummyId}`);
  await request('DELETE', `/capi/v3/openOrders?symbol=BTCUSDT`);
  await request('POST', `/capi/v3/order/cancel`, { symbol: 'BTCUSDT', orderId: dummyId });
  await request('POST', `/capi/v3/orders/cancel`, { symbol: 'BTCUSDT', orderId: dummyId });
  await request('POST', `/capi/v3/modifyTpSlOrder`, { symbol: 'BTCUSDT', orderId: dummyId, triggerPrice: '78000.0', positionSide: 'LONG' });
}

discoverCancel();
