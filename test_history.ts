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

async function inspectHistory() {
  const timestamp = Date.now().toString();
  const path = '/capi/v3/order/history?symbol=BTCUSDT';
  const s = sign(timestamp, 'GET', path);
  const res = await fetch(BASE_URL + path, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'ACCESS-KEY': API_KEY,
      'ACCESS-SIGN': s,
      'ACCESS-TIMESTAMP': timestamp,
      'ACCESS-PASSPHRASE': PASSPHRASE,
      'User-Agent': 'WeexProbe/1.0'
    }
  });
  const data = await res.json();
  console.log("ORDER HISTORY:", JSON.stringify(data, null, 2));
}

inspectHistory();
