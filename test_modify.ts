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
  console.log(`[${res.status}] ${method} ${path}:`, JSON.stringify(d, null, 2));
  return { status: res.status, data: d };
}

async function testModify() {
  console.log("Testing modifyTpSlOrder with dummy params to inspect parameter validation...");
  await request('POST', '/capi/v3/modifyTpSlOrder', {
    symbol: 'BTCUSDT',
    orderId: '123456',
    clientAlgoId: 'b-dummy',
    triggerPrice: '80000.0',
    positionSide: 'LONG'
  });
}

testModify();
