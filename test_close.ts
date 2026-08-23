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

async function closeResidualPosition() {
  console.log("=== FLATTENING RESIDUAL POSITION VIA MARKET SELL ===");
  
  // 1. Check current position
  const timestamp = Date.now().toString();
  const posPath = '/capi/v3/account/position/allPosition';
  const posSign = sign(timestamp, 'GET', posPath);
  const posRes = await fetch(BASE_URL + posPath, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'ACCESS-KEY': API_KEY,
      'ACCESS-SIGN': posSign,
      'ACCESS-TIMESTAMP': timestamp,
      'ACCESS-PASSPHRASE': PASSPHRASE,
      'User-Agent': 'WeexProbe/1.0'
    }
  });
  const positions = await posRes.json();
  console.log("Current Positions:", JSON.stringify(positions, null, 2));

  const btcPos = (Array.isArray(positions) ? positions : []).find((p: any) => p.symbol === 'BTCUSDT' && parseFloat(p.size) > 0);
  if (!btcPos) {
    console.log("No open BTC position found. Total exposure is already 0.");
    return;
  }

  const size = btcPos.size;
  const side = btcPos.side === 'LONG' ? 'SELL' : 'BUY';
  const positionSide = btcPos.side;

  console.log(`Closing ${size} BTC position with opposing order: side=${side}, positionSide=${positionSide}`);

  const orderPath = '/capi/v3/order';
  const orderBody = JSON.stringify({
    symbol: 'BTCUSDT',
    side: side,
    type: 'MARKET',
    positionSide: positionSide,
    quantity: size,
    newClientOrderId: `b-probe-close-${Date.now()}`
  });

  const orderTimestamp = Date.now().toString();
  const orderSign = sign(orderTimestamp, 'POST', orderPath, orderBody);
  const orderRes = await fetch(BASE_URL + orderPath, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'ACCESS-KEY': API_KEY,
      'ACCESS-SIGN': orderSign,
      'ACCESS-TIMESTAMP': orderTimestamp,
      'ACCESS-PASSPHRASE': PASSPHRASE,
      'User-Agent': 'WeexProbe/1.0'
    },
    body: orderBody
  });

  const orderResult = await orderRes.json();
  console.log(`Close Order Result [${orderRes.status}]:`, JSON.stringify(orderResult, null, 2));

  // Wait 1.5s and verify position is 0
  await new Promise(r => setTimeout(r, 1500));
  const verifyTimestamp = Date.now().toString();
  const verifySign = sign(verifyTimestamp, 'GET', posPath);
  const verifyRes = await fetch(BASE_URL + posPath, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'ACCESS-KEY': API_KEY,
      'ACCESS-SIGN': verifySign,
      'ACCESS-TIMESTAMP': verifyTimestamp,
      'ACCESS-PASSPHRASE': PASSPHRASE,
      'User-Agent': 'WeexProbe/1.0'
    }
  });
  const finalPositions = await verifyRes.json();
  console.log("Final Positions after close:", JSON.stringify(finalPositions, null, 2));
}

closeResidualPosition();
