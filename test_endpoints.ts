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

async function testLeverageParams() {
  const timestamp = Date.now().toString();
  const path = '/capi/v3/account/leverage';

  const variations = [
    {
      name: 'isolatedLongLeverage & isolatedShortLeverage',
      body: { symbol: 'BTCUSDT', isolatedLongLeverage: '5', isolatedShortLeverage: '5' }
    },
    {
      name: 'crossedLeverage',
      body: { symbol: 'BTCUSDT', crossedLeverage: '5' }
    },
    {
      name: 'leverage with marginMode',
      body: { symbol: 'BTCUSDT', leverage: '5', marginMode: 'CROSSED' }
    },
  ];

  for (const v of variations) {
    const bodyStr = JSON.stringify(v.body);
    const s = sign(timestamp, 'POST', path, bodyStr);
    const res = await fetch(BASE_URL + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ACCESS-KEY': API_KEY,
        'ACCESS-SIGN': s,
        'ACCESS-TIMESTAMP': timestamp,
        'ACCESS-PASSPHRASE': PASSPHRASE,
        'User-Agent': 'WeexProbe/1.0'
      },
      body: bodyStr
    });
    console.log(`[${v.name}] -> Status [${res.status}]:`, await res.json());
  }
}

testLeverageParams();
