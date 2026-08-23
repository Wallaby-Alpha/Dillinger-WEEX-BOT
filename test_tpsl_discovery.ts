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
    body: method !== 'GET' ? bodyStr : undefined
  });
  const d = await res.json();
  if (res.status !== 404) {
    console.log(`FOUND [${res.status}] ${method} ${path}:`, JSON.stringify(d));
  }
  return { status: res.status, data: d };
}

async function discoverMore() {
  const paths = [
    '/capi/v3/order/detail?symbol=BTCUSDT&orderId=786232347694465728',
    '/capi/v3/order?symbol=BTCUSDT&orderId=786232347694465728',
    '/capi/v3/allOrders?symbol=BTCUSDT',
    '/capi/v3/historyOrders?symbol=BTCUSDT',
    '/capi/v3/order/history?symbol=BTCUSDT',
    '/capi/v3/orders?symbol=BTCUSDT',
    '/capi/v3/tpsl?symbol=BTCUSDT',
    '/capi/v3/position/allPosition',
  ];
  for (const p of paths) {
    await request('GET', p);
  }
}

discoverMore();
