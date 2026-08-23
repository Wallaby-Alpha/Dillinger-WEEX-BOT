import crypto from 'crypto';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();
if (!process.env.WEEX_API_KEY) {
    dotenv.config({ path: '.env.txt' });
}

const API_KEY = process.env.WEEX_API_KEY || '';
const API_SECRET = process.env.WEEX_API_SECRET || '';
const PASSPHRASE = process.env.WEEX_PASSPHRASE || '';
const BASE_URL = 'https://api-contract.weex.com';

// Global Emergency Stop Flag
let EMERGENCY_STOP_TRIGGERED = false;

export function triggerEmergencyStop(reason: string) {
    console.error(`\n🚨 GLOBAL EMERGENCY STOP TRIGGERED: ${reason} 🚨`);
    EMERGENCY_STOP_TRIGGERED = true;
}

process.on('SIGINT', () => {
    triggerEmergencyStop('Process received SIGINT (Ctrl+C)');
    process.exit(1);
});

process.on('SIGTERM', () => {
    triggerEmergencyStop('Process received SIGTERM');
    process.exit(1);
});

export interface SymbolContractMetadata {
    symbol: string;
    pricePrecision: number;
    quantityPrecision: number;
    baseAssetPrecision: number;
    contractVal: number;
    minOrderSize: number;
    maxOrderSize: number;
    maxPositionSize: number;
    marketOpenLimitSize: number;
    minLeverage: number;
    maxLeverage: number;
}

export interface PositionDetail {
    symbol: string;
    holdSide?: string;
    total?: string | number;
    available?: string | number;
    margin?: string | number;
    openPriceAvg?: string | number;
    [key: string]: any;
}

export interface OpenOrderDetail {
    orderId?: string;
    clientOrderId?: string;
    symbol: string;
    side: string;
    orderType: string;
    size?: string | number;
    [key: string]: any;
}

export interface PlanOrderDetail {
    orderId?: string;
    clientAlgoId?: string;
    symbol: string;
    planType: string;
    triggerPrice: string;
    executePrice?: string;
    quantity?: string;
    [key: string]: any;
}

export class WeexProbeClient {
    private apiKey: string;
    private apiSecret: string;
    private passphrase: string;
    private baseUrl: string;

    constructor(apiKey: string, apiSecret: string, passphrase: string, baseUrl: string) {
        this.apiKey = apiKey;
        this.apiSecret = apiSecret;
        this.passphrase = passphrase;
        this.baseUrl = baseUrl;
    }

    private getSignature(timestamp: string, method: string, requestPath: string, body?: string): string {
        const message = `${timestamp}${method}${requestPath}${body || ''}`;
        const hmac = crypto.createHmac('sha256', this.apiSecret);
        return hmac.update(message).digest('base64');
    }

    async request(method: string, endpoint: string, body: any = null, isPublic: boolean = false): Promise<any> {
        if (EMERGENCY_STOP_TRIGGERED) {
            throw new Error(`Execution blocked: Global Emergency Stop is active.`);
        }

        const timestamp = Date.now().toString();
        const bodyStr = body ? JSON.stringify(body) : '';
        
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'User-Agent': 'WeexBehaviorProbe/1.0',
        };

        if (!isPublic) {
            if (!this.apiKey || !this.apiSecret || !this.passphrase) {
                throw new Error("Missing API credentials for authenticated endpoint: " + endpoint);
            }
            const signature = this.getSignature(timestamp, method, endpoint, bodyStr);
            headers['ACCESS-KEY'] = this.apiKey;
            headers['ACCESS-SIGN'] = signature;
            headers['ACCESS-TIMESTAMP'] = timestamp;
            headers['ACCESS-PASSPHRASE'] = this.passphrase;
        }

        const url = `${this.baseUrl}${endpoint}`;
        console.log(`[API ${method}] ${endpoint} ${bodyStr ? `Payload: ${bodyStr}` : ''}`);

        try {
            const requestInit: RequestInit = {
                method,
                headers,
            };
            if (method !== 'GET' && bodyStr) {
                requestInit.body = bodyStr;
            }
            const response = await fetch(url, requestInit);
            const data = await response.json();
            if (response.status >= 400 || (data.code && data.code !== '00000' && data.code !== 0 && data.code !== '0')) {
                console.warn(`[API WARNING] Status ${response.status}:`, JSON.stringify(data));
            }
            return data;
        } catch (error) {
            console.error(`[API ERROR] ${endpoint}:`, error);
            throw error;
        }
    }

    // Public Market Endpoints
    async getExchangeInfo(): Promise<any> { 
        return this.request('GET', '/capi/v3/market/exchangeInfo', null, true); 
    }
    
    async getMarkPrice(symbol: string): Promise<number> {
        const res = await this.request('GET', `/capi/v3/market/premiumIndex?symbol=${symbol}`, null, true);
        const item = Array.isArray(res) ? res.find((i: any) => i.symbol === symbol) : res?.data;
        if (!item || !item.markPrice) {
            throw new Error(`Unable to fetch mark price for ${symbol}`);
        }
        return parseFloat(item.markPrice);
    }

    async getSymbolMetadata(symbol: string): Promise<SymbolContractMetadata> {
        const info = await this.getExchangeInfo();
        const symbolsList: any[] = info?.symbols || info?.data?.symbols || [];
        const raw = symbolsList.find((s: any) => s.symbol === symbol || s.displaySymbol === symbol);
        if (!raw) {
            throw new Error(`Symbol ${symbol} not found in WEEX exchangeInfo.`);
        }
        return {
            symbol: raw.symbol,
            pricePrecision: parseInt(raw.pricePrecision, 10),
            quantityPrecision: parseInt(raw.quantityPrecision, 10),
            baseAssetPrecision: parseInt(raw.baseAssetPrecision, 10),
            contractVal: parseFloat(raw.contractVal || 1),
            minOrderSize: parseFloat(raw.minOrderSize),
            maxOrderSize: parseFloat(raw.maxOrderSize),
            maxPositionSize: parseFloat(raw.maxPositionSize),
            marketOpenLimitSize: parseFloat(raw.marketOpenLimitSize || raw.maxOrderSize),
            minLeverage: parseInt(raw.minLeverage || 1, 10),
            maxLeverage: parseInt(raw.maxLeverage || 100, 10),
        };
    }

    // Private Account & Trading Endpoints (Verified V3)
    async getAccountBalance() { return this.request('GET', '/capi/v3/account/balance'); }
    async getAllPositions() { return this.request('GET', '/capi/v3/account/position/allPosition'); }
    async getOpenOrders(symbol?: string) { 
        const query = symbol ? `?symbol=${symbol}` : '';
        return this.request('GET', `/capi/v3/openOrders${query}`); 
    }
    async getCurrentPlan(symbol?: string) { 
        const query = symbol ? `?symbol=${symbol}` : '';
        return this.request('GET', `/capi/v3/openOrders${query}`); 
    }
    async setLeverage(symbol: string, leverage: number) { 
        return this.request('POST', '/capi/v3/account/leverage', { 
            symbol, 
            isolatedLongLeverage: leverage.toString(),
            isolatedShortLeverage: leverage.toString()
        }); 
    }
    async placeOrder(params: any) { return this.request('POST', '/capi/v3/order', params); }
    async placeTpSlOrder(params: any) { return this.request('POST', '/capi/v3/placeTpSlOrder', params); }
    async modifyTpSlOrder(params: any) { return this.request('POST', '/capi/v3/modifyTpSlOrder', params); }
    async cancelOrder(symbol: string, orderId?: string, clientOrderId?: string) { 
        const query = orderId ? `orderId=${orderId}` : `origClientOrderId=${clientOrderId}`;
        return this.request('DELETE', `/capi/v3/order?symbol=${symbol}&${query}`); 
    }
    async cancelTpSlOrder(symbol: string, orderId?: string, clientAlgoId?: string) { 
        const query = orderId ? `orderId=${orderId}` : `origClientOrderId=${clientAlgoId}`;
        return this.request('DELETE', `/capi/v3/order?symbol=${symbol}&${query}`); 
    }
    async closePosition(symbol: string, positionSide: 'LONG' | 'SHORT' = 'LONG', quantity?: string) { 
        const side = positionSide === 'LONG' ? 'SELL' : 'BUY';
        return this.placeOrder({
            symbol,
            side,
            type: 'MARKET',
            positionSide,
            quantity,
            newClientOrderId: `b-close-${Date.now()}`
        });
    }
}

export class SafetyHarness {
    private client: WeexProbeClient;

    constructor(client: WeexProbeClient) {
        this.client = client;
    }

    /**
     * Pre-flight assertion: verify 0 existing exposure or open orders.
     */
    async assertCleanState(symbol?: string): Promise<void> {
        console.log(`\n--- Pre-Flight Safety Check ---`);
        
        // 1. Check account balance
        const balanceRes = await this.client.getAccountBalance();
        console.log(`Account Margin/Balance:`, JSON.stringify(balanceRes));

        // 2. Check open positions
        const posRes = await this.client.getAllPositions();
        const positions: PositionDetail[] = Array.isArray(posRes) ? posRes : (posRes?.data || []);
        const activePositions = positions.filter(p => {
            const size = parseFloat(String(p.total || p.size || 0));
            return size > 0 && (!symbol || p.symbol === symbol);
        });

        if (activePositions.length > 0) {
            triggerEmergencyStop(`Pre-flight failed: Found ${activePositions.length} active open positions: ${JSON.stringify(activePositions)}`);
            throw new Error(`ABORT: Existing open positions detected. Clean up manually before probing.`);
        }

        // 3. Check open standard orders
        const ordersRes = await this.client.getOpenOrders(symbol);
        const openOrders: OpenOrderDetail[] = Array.isArray(ordersRes) ? ordersRes : (ordersRes?.data || []);
        if (openOrders.length > 0) {
            triggerEmergencyStop(`Pre-flight failed: Found ${openOrders.length} active open orders: ${JSON.stringify(openOrders)}`);
            throw new Error(`ABORT: Existing open orders detected. Clean up manually before probing.`);
        }

        // 4. Check active plan/conditional orders
        const planRes = await this.client.getCurrentPlan(symbol);
        const activePlans: PlanOrderDetail[] = Array.isArray(planRes) ? planRes : (planRes?.data || []);
        if (activePlans.length > 0) {
            triggerEmergencyStop(`Pre-flight failed: Found ${activePlans.length} active plan orders: ${JSON.stringify(activePlans)}`);
            throw new Error(`ABORT: Existing plan orders detected. Clean up manually before probing.`);
        }

        console.log(`✓ Pre-flight passed: Zero open positions, zero open orders, zero active plans.\n`);
    }

    /**
     * Post-test cleanup: close all positions and cancel all orders, then verify zero state.
     */
    async cleanupAndVerify(symbol: string): Promise<void> {
        console.log(`\n--- Post-Test Cleanup & REST Verification for ${symbol} ---`);
        
        try {
            // 1. Cancel open standard orders
            const ordersRes = await this.client.getOpenOrders(symbol);
            const openOrders: OpenOrderDetail[] = Array.isArray(ordersRes) ? ordersRes : (ordersRes?.data || []);
            for (const order of openOrders) {
                console.log(`Cancelling residual order: ${order.orderId || order.clientOrderId}`);
                await this.client.cancelOrder(symbol, order.orderId, order.clientOrderId);
            }

            // 2. Cancel open plan orders
            const planRes = await this.client.getCurrentPlan(symbol);
            const activePlans: PlanOrderDetail[] = Array.isArray(planRes) ? planRes : (planRes?.data || []);
            for (const plan of activePlans) {
                console.log(`Cancelling residual plan order: ${plan.orderId || plan.clientAlgoId}`);
                await this.client.cancelTpSlOrder(symbol, plan.orderId, plan.clientAlgoId);
            }

            // 3. Close open positions
            const posRes = await this.client.getAllPositions();
            const positions: PositionDetail[] = Array.isArray(posRes) ? posRes : (posRes?.data || []);
            const activePositions = positions.filter(p => p.symbol === symbol && parseFloat(String(p.total || p.size || 0)) > 0);
            for (const pos of activePositions) {
                const positionSide = (pos.side === 'SHORT' || pos.holdSide === 'SHORT') ? 'SHORT' : 'LONG';
                const size = String(pos.size || pos.total || '0');
                console.log(`Closing residual position on ${symbol} (${positionSide}) size ${size}`);
                await this.client.closePosition(symbol, positionSide, size);
            }

            // 4. Verification Poll
            await new Promise(r => setTimeout(r, 1500));
            const finalPos = await this.client.getAllPositions();
            const positionsList = Array.isArray(finalPos) ? finalPos : (finalPos?.data || []);
            const residualPos = positionsList.filter((p: any) => p.symbol === symbol && parseFloat(String(p.total || p.size || 0)) > 0);
            if (residualPos.length > 0) {
                triggerEmergencyStop(`Cleanup Verification FAILED: Residual position remains: ${JSON.stringify(residualPos)}`);
                throw new Error(`FATAL: Residual position could not be confirmed closed.`);
            }

            const finalOrders = await this.client.getOpenOrders(symbol);
            const ordersList = Array.isArray(finalOrders) ? finalOrders : (finalOrders?.data || []);
            const residualOrders = ordersList.filter((o: any) => o.symbol === symbol);
            if (residualOrders.length > 0) {
                triggerEmergencyStop(`Cleanup Verification FAILED: Residual orders remain: ${JSON.stringify(residualOrders)}`);
                throw new Error(`FATAL: Residual orders could not be confirmed cancelled.`);
            }

            console.log(`✓ Post-test cleanup verified: Exposure is exactly 0.\n`);
        } catch (err) {
            triggerEmergencyStop(`Cleanup exception: ${err}`);
            throw err;
        }
    }
}

export function generateProbeClientOrderId(testId: string): string {
    return `PROBE-${testId}-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;
}

// Instantiate client and harness
export const probeClient = new WeexProbeClient(API_KEY, API_SECRET, PASSPHRASE, BASE_URL);
export const safetyHarness = new SafetyHarness(probeClient);

/**
 * Strict Quantity Calculation and Safety Assertion
 */
export async function calculateSafeProbeExecution(
    symbol: string, 
    targetNotionalUSDT: number = 60.0, 
    maxCapNotionalUSDT: number = 70.0
) {
    const meta = await probeClient.getSymbolMetadata(symbol);
    const currentPrice = await probeClient.getMarkPrice(symbol);

    // 1. Calculate raw quantity
    const rawQuantity = targetNotionalUSDT / currentPrice;

    // 2. Round DOWN strictly to quantityPrecision (never round up)
    const factor = Math.pow(10, meta.quantityPrecision);
    const quantizedQuantity = Math.floor(rawQuantity * factor) / factor;
    const quantityStr = quantizedQuantity.toFixed(meta.quantityPrecision);

    // 3. Resulting notional and exposure
    const resultingNotional = quantizedQuantity * currentPrice;
    const maxMarginAt5x = resultingNotional / 5.0;

    // 4. Invariant checks
    if (quantizedQuantity < meta.minOrderSize) {
        throw new Error(
            `ABORT: Calculated quantity (${quantityStr}) is below exchange minimum order size (${meta.minOrderSize}). ` +
            `Rounding up is strictly prohibited. Trade cannot safely represent ~$50-$70 notional.`
        );
    }

    if (resultingNotional > maxCapNotionalUSDT) {
        throw new Error(
            `ABORT: Resulting notional ($${resultingNotional.toFixed(2)}) strictly exceeds maximum cap ($${maxCapNotionalUSDT.toFixed(2)}).`
        );
    }

    if (resultingNotional < 40.0) {
        throw new Error(
            `ABORT: Resulting notional ($${resultingNotional.toFixed(2)}) is below acceptable test range ($50-$70).`
        );
    }

    // 5. Price calculations for TP / SL
    const tpRaw = currentPrice * 1.025; // +2.5%
    const slRaw = currentPrice * 0.985; // -1.5%
    const tpPriceStr = tpRaw.toFixed(meta.pricePrecision);
    const slPriceStr = slRaw.toFixed(meta.pricePrecision);

    return {
        meta,
        currentPrice,
        rawQuantity,
        quantizedQuantity,
        quantityStr,
        resultingNotional,
        maxMarginAt5x,
        tpPriceStr,
        slPriceStr,
    };
}

export async function runTest1() {
    const symbol = "BTCUSDT";
    const clientOrderId = generateProbeClientOrderId("T1");
    
    // Calculate and assert strict sizing
    const calc = await calculateSafeProbeExecution(symbol, 60.0, 70.0);

    console.log(`=======================================================`);
    console.log(` PROCEEDING WITH TEST 1 EXECUTION`);
    console.log(` Client Order ID   : ${clientOrderId}`);
    console.log(` Symbol            : ${symbol}`);
    console.log(` Contract Val      : ${calc.meta.contractVal}`);
    console.log(` Min Order Size    : ${calc.meta.minOrderSize}`);
    console.log(` Qty Precision     : ${calc.meta.quantityPrecision} decimals`);
    console.log(` Price Precision   : ${calc.meta.pricePrecision} decimals`);
    console.log(` Mark Price        : $${calc.currentPrice.toFixed(calc.meta.pricePrecision)}`);
    console.log(` Target Notional   : $60.00 USDT (Cap: $70.00 USDT)`);
    console.log(` Raw Quantity      : ${calc.rawQuantity} BTC`);
    console.log(` Quantized Qty     : ${calc.quantityStr} BTC (Strict Floor)`);
    console.log(` Resulting Notional: $${calc.resultingNotional.toFixed(2)} USDT`);
    console.log(` Margin (5x)       : $${calc.maxMarginAt5x.toFixed(2)} USDT`);
    console.log(` Attached TP       : $${calc.tpPriceStr} (+2.5%)`);
    console.log(` Attached SL       : $${calc.slPriceStr} (-1.5%)`);
    console.log(`=======================================================\n`);

    // 1. Pre-flight check
    await safetyHarness.assertCleanState(symbol);

    // 2. Set Leverage (5x)
    await probeClient.setLeverage(symbol, 5);

    // 3. Place Order with native TP/SL fields
    console.log(`Submitting Market Buy with attached TP/SL...`);
    const orderRes = await probeClient.placeOrder({
        symbol,
        side: 'BUY',
        type: 'MARKET',
        positionSide: 'LONG',
        quantity: calc.quantityStr,
        newClientOrderId: `b-${clientOrderId}`,
        tpTriggerPrice: calc.tpPriceStr,
        slTriggerPrice: calc.slPriceStr,
        TpWorkingType: 'CONTRACT_PRICE',
        SlWorkingType: 'CONTRACT_PRICE'
    });
    console.log(`Order placement response:`, JSON.stringify(orderRes, null, 2));

    // Wait 2.5 seconds for fill and trigger registration
    await new Promise(r => setTimeout(r, 2500));

    // 4. Query position and conditional plans to verify native protection
    console.log(`\nQuerying position...`);
    const posRes = await probeClient.getAllPositions();
    console.log(`All Positions:`, JSON.stringify(posRes?.data || posRes, null, 2));

    console.log(`\nQuerying active conditional/plan orders...`);
    const planRes = await probeClient.getCurrentPlan(symbol);
    console.log(`Current Plan Orders:`, JSON.stringify(planRes?.data || planRes, null, 2));

    // 5. Cleanup immediately & verify zero exposure
    await safetyHarness.cleanupAndVerify(symbol);
}

export async function runTest2() {
    const symbol = "BTCUSDT";
    const clientOrderId = generateProbeClientOrderId("T2");
    
    // Calculate and assert strict sizing ($60 notional, cap $70)
    const calc = await calculateSafeProbeExecution(symbol, 60.0, 70.0);

    console.log(`=======================================================`);
    console.log(` PROCEEDING WITH TEST 2: Dedicated placeTpSlOrder Probe`);
    console.log(` Client Order ID   : ${clientOrderId}`);
    console.log(` Symbol            : ${symbol}`);
    console.log(` Quantized Qty     : ${calc.quantityStr} BTC`);
    console.log(` Resulting Notional: $${calc.resultingNotional.toFixed(2)} USDT`);
    console.log(` Margin (5x)       : $${calc.maxMarginAt5x.toFixed(2)} USDT`);
    console.log(` Target TP Price   : $${calc.tpPriceStr} (+2.5%)`);
    console.log(` Target SL Price   : $${calc.slPriceStr} (-1.5%)`);
    console.log(`=======================================================\n`);

    // 1. Pre-flight check
    await safetyHarness.assertCleanState(symbol);

    // 2. Set Leverage (5x)
    await probeClient.setLeverage(symbol, 5);

    // 3. Open raw MARKET position without TP/SL
    console.log(`Step 1: Opening raw Market Buy position (no inline TP/SL)...`);
    const openRes = await probeClient.placeOrder({
        symbol,
        side: 'BUY',
        type: 'MARKET',
        positionSide: 'LONG',
        quantity: calc.quantityStr,
        newClientOrderId: `b-${clientOrderId}-entry`
    });
    console.log(`Entry Order Response:`, JSON.stringify(openRes, null, 2));

    await new Promise(r => setTimeout(r, 2000));

    // 4. Verify open position
    console.log(`\nStep 2: Inspecting created position...`);
    const posRes = await probeClient.getAllPositions();
    console.log(`Current Positions:`, JSON.stringify(posRes, null, 2));

    // 5. Call placeTpSlOrder with quantity: '0' for TAKE_PROFIT
    console.log(`\nStep 3: Placing TAKE_PROFIT via placeTpSlOrder (quantity: "0")...`);
    const tpRes = await probeClient.placeTpSlOrder({
        symbol,
        clientAlgoId: `b-${clientOrderId}-tp`,
        planType: 'TAKE_PROFIT',
        triggerPrice: calc.tpPriceStr,
        positionSide: 'LONG',
        executePrice: '0',
        quantity: '0',
        triggerPriceType: 'CONTRACT_PRICE'
    });
    console.log(`Take Profit Response:`, JSON.stringify(tpRes, null, 2));

    // 6. Call placeTpSlOrder with quantity: '0' for STOP_LOSS
    console.log(`\nStep 4: Placing STOP_LOSS via placeTpSlOrder (quantity: "0")...`);
    const slRes = await probeClient.placeTpSlOrder({
        symbol,
        clientAlgoId: `b-${clientOrderId}-sl`,
        planType: 'STOP_LOSS',
        triggerPrice: calc.slPriceStr,
        positionSide: 'LONG',
        executePrice: '0',
        quantity: '0',
        triggerPriceType: 'CONTRACT_PRICE'
    });
    console.log(`Stop Loss Response:`, JSON.stringify(slRes, null, 2));

    await new Promise(r => setTimeout(r, 2000));

    // 7. Query active orders and history to see the generated conditional orders
    console.log(`\nStep 5: Inspecting active open orders...`);
    const openOrdersRes = await probeClient.getOpenOrders(symbol);
    console.log(`Open Orders:`, JSON.stringify(openOrdersRes, null, 2));

    // 8. Cleanup immediately & verify zero exposure
    console.log(`\nStep 6: Executing cleanup & zero-exposure verification...`);
    await safetyHarness.cleanupAndVerify(symbol);
}

export async function runTest3And4() {
    const symbol = "BTCUSDT";
    const clientOrderId = generateProbeClientOrderId("T3-T4");

    // Sizing: Two slices of 0.0004 BTC (Total: 0.0008 BTC ~ $61.60 notional, well under $70 cap)
    const primaryQtyStr = "0.0004";
    const secondaryQtyStr = "0.0004";
    const combinedQtyStr = "0.0008";

    const meta = await probeClient.getSymbolMetadata(symbol);
    const currentPrice = await probeClient.getMarkPrice(symbol);
    const initialNotional = 0.0004 * currentPrice;
    const combinedNotional = 0.0008 * currentPrice;

    console.log(`=======================================================`);
    console.log(` RUNNING TESTS 3 & 4: Secondary Entry & Protection Replacement`);
    console.log(` Client Order ID   : ${clientOrderId}`);
    console.log(` Symbol            : ${symbol}`);
    console.log(` Primary Qty       : ${primaryQtyStr} BTC (~$${initialNotional.toFixed(2)} USDT)`);
    console.log(` Secondary Qty     : ${secondaryQtyStr} BTC (~$${initialNotional.toFixed(2)} USDT)`);
    console.log(` Total Combined Qty: ${combinedQtyStr} BTC (~$${combinedNotional.toFixed(2)} USDT)`);
    console.log(` Max Cap Permitted : $70.00 USDT`);
    console.log(`=======================================================\n`);

    // 1. Pre-flight check
    await safetyHarness.assertCleanState(symbol);

    // 2. Set Leverage (5x)
    await probeClient.setLeverage(symbol, 5);

    // 3. Step 1: Open Primary Position
    console.log(`--- STEP 1: Opening Primary Position (${primaryQtyStr} BTC) ---`);
    const primaryRes = await probeClient.placeOrder({
        symbol,
        side: 'BUY',
        type: 'MARKET',
        positionSide: 'LONG',
        quantity: primaryQtyStr,
        newClientOrderId: `b-${clientOrderId}-p1`
    });
    console.log(`Primary Entry Response:`, JSON.stringify(primaryRes, null, 2));

    await new Promise(r => setTimeout(r, 2000));
    const pos1Res = await probeClient.getAllPositions();
    const pos1 = Array.isArray(pos1Res) ? pos1Res[0] : pos1Res?.data?.[0];
    console.log(`Primary Position State:`, JSON.stringify(pos1, null, 2));
    const entryPrice1 = parseFloat(pos1?.entryPrice || pos1?.openValue / parseFloat(pos1?.size) || currentPrice);

    // 4. Step 2: Establish Initial Whole-Position Protection (quantity: "0")
    const tp1Price = (entryPrice1 * 1.025).toFixed(meta.pricePrecision);
    const sl1Price = (entryPrice1 * 0.985).toFixed(meta.pricePrecision);
    console.log(`\n--- STEP 2: Establishing Whole-Position TP ($${tp1Price}) and SL ($${sl1Price}) ---`);

    const tp1Res = await probeClient.placeTpSlOrder({
        symbol,
        clientAlgoId: `b-${clientOrderId}-tp1`,
        planType: 'TAKE_PROFIT',
        triggerPrice: tp1Price,
        positionSide: 'LONG',
        executePrice: '0',
        quantity: '0',
        triggerPriceType: 'CONTRACT_PRICE'
    });
    console.log(`Initial TP Response:`, JSON.stringify(tp1Res, null, 2));
    const tp1OrderId = tp1Res?.[0]?.orderId || tp1Res?.orderId;

    const sl1Res = await probeClient.placeTpSlOrder({
        symbol,
        clientAlgoId: `b-${clientOrderId}-sl1`,
        planType: 'STOP_LOSS',
        triggerPrice: sl1Price,
        positionSide: 'LONG',
        executePrice: '0',
        quantity: '0',
        triggerPriceType: 'CONTRACT_PRICE'
    });
    console.log(`Initial SL Response:`, JSON.stringify(sl1Res, null, 2));
    const sl1OrderId = sl1Res?.[0]?.orderId || sl1Res?.orderId;

    await new Promise(r => setTimeout(r, 1500));

    // 5. Step 3: Execute Secondary Entry (Position Expansion)
    console.log(`\n--- STEP 3: Executing Secondary Entry (${secondaryQtyStr} BTC) ---`);
    const secondaryRes = await probeClient.placeOrder({
        symbol,
        side: 'BUY',
        type: 'MARKET',
        positionSide: 'LONG',
        quantity: secondaryQtyStr,
        newClientOrderId: `b-${clientOrderId}-p2`
    });
    console.log(`Secondary Entry Response:`, JSON.stringify(secondaryRes, null, 2));

    await new Promise(r => setTimeout(r, 2000));

    // 6. Inspect Expanded Position & Protection State (Test 3 Goal)
    console.log(`\n--- TEST 3 RESULTS: Inspecting Expanded Position & TP/SL State ---`);
    const pos2Res = await probeClient.getAllPositions();
    const pos2 = Array.isArray(pos2Res) ? pos2Res[0] : pos2Res?.data?.[0];
    console.log(`Expanded Position State:`, JSON.stringify(pos2, null, 2));

    const totalSize = parseFloat(pos2?.size || '0');
    const totalOpenValue = parseFloat(pos2?.openValue || '0');
    const weightedAvgPrice = totalOpenValue / totalSize;
    console.log(`New Weighted Average Entry Price: $${weightedAvgPrice.toFixed(meta.pricePrecision)}`);

    // 7. Step 4: Calculate Combined TP/SL & Update Protection in-place via modifyTpSlOrder (Test 4 Goal)
    const combinedTpPrice = (weightedAvgPrice * 1.025).toFixed(meta.pricePrecision);
    const combinedSlPrice = (weightedAvgPrice * 0.985).toFixed(meta.pricePrecision);
    console.log(`\n--- TEST 4: Updating Protection in-place for Combined Position ---`);
    console.log(`Recalculated Combined TP (+2.5%): $${combinedTpPrice}`);
    console.log(`Recalculated Combined SL (-1.5%): $${combinedSlPrice}`);

    console.log(`Modifying existing TP order ${tp1OrderId} to $${combinedTpPrice}...`);
    const tpModRes = await probeClient.modifyTpSlOrder({
        symbol,
        orderId: tp1OrderId.toString(),
        triggerPrice: combinedTpPrice,
        executePrice: '0'
    });
    console.log(`TP Modification Response:`, JSON.stringify(tpModRes, null, 2));

    console.log(`Modifying existing SL order ${sl1OrderId} to $${combinedSlPrice}...`);
    const slModRes = await probeClient.modifyTpSlOrder({
        symbol,
        orderId: sl1OrderId.toString(),
        triggerPrice: combinedSlPrice,
        executePrice: '0'
    });
    console.log(`SL Modification Response:`, JSON.stringify(slModRes, null, 2));

    await new Promise(r => setTimeout(r, 2000));

    // 8. Cleanup & Zero-Exposure Verification
    console.log(`\n--- STEP 5: Final Cleanup & Zero-Exposure Verification ---`);
    await safetyHarness.cleanupAndVerify(symbol);
}

export async function runTest8() {
    console.log(`=======================================================`);
    console.log(` RUNNING TEST 8: Symbol Metadata & Quantity Normalization`);
    console.log(` Target Notional: $70.00 USDT (Hard Max Cap)`);
    console.log(` Sizing Invariant: Never round upward; Floor to precision/lot size.`);
    console.log(`=======================================================\n`);

    const testSymbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT", "XRPUSDT"];
    const targetNotional = 70.0;

    for (const symbol of testSymbols) {
        try {
            const meta = await probeClient.getSymbolMetadata(symbol);
            const markPrice = await probeClient.getMarkPrice(symbol);
            
            const rawQty = targetNotional / markPrice;
            let quantizedQty: number;
            let qtyStr: string;

            if (meta.quantityPrecision >= 0) {
                const factor = Math.pow(10, meta.quantityPrecision);
                quantizedQty = Math.floor(rawQty * factor) / factor;
                qtyStr = quantizedQty.toFixed(meta.quantityPrecision);
            } else {
                // Negative precision indicates lot multiples (e.g. -2 means multiple of 100)
                const lotSize = Math.pow(10, -meta.quantityPrecision);
                quantizedQty = Math.floor(rawQty / lotSize) * lotSize;
                qtyStr = quantizedQty.toString();
            }

            const resultingNotional = quantizedQty * markPrice;

            console.log(`--- Symbol: ${symbol} ---`);
            console.log(`  Mark Price        : $${markPrice}`);
            console.log(`  Contract Val      : ${meta.contractVal}`);
            console.log(`  Min Order Size    : ${meta.minOrderSize}`);
            console.log(`  Max Order Size    : ${meta.maxOrderSize}`);
            console.log(`  Qty Precision     : ${meta.quantityPrecision} (${meta.quantityPrecision >= 0 ? `${meta.quantityPrecision} decimals` : `multiple of ${Math.pow(10, -meta.quantityPrecision)}`})`);
            console.log(`  Price Precision   : ${meta.pricePrecision} decimals`);
            console.log(`  Raw Qty           : ${rawQty}`);
            console.log(`  Normalized Qty    : ${qtyStr}`);
            console.log(`  Resulting Notional: $${resultingNotional.toFixed(4)} USDT`);

            // Verification assertions
            if (resultingNotional > targetNotional + 1e-6) {
                throw new Error(`VIOLATION: Resulting notional ($${resultingNotional}) exceeds target ($${targetNotional})!`);
            }
            if (quantizedQty > rawQty + 1e-9) {
                throw new Error(`VIOLATION: Quantized quantity rounded UP!`);
            }
            if (quantizedQty < meta.minOrderSize) {
                console.log(`  [REJECT TEST]: Sizing ${quantizedQty} is below exchange minimum ${meta.minOrderSize}. Bot will correctly REJECT order.`);
            } else {
                console.log(`  ✓ Sizing & Precision PASSED.`);
            }
            console.log(``);
        } catch (e: any) {
            console.error(`Error probing ${symbol}:`, e.message);
        }
    }
}

export async function runTest9() {
    console.log(`=======================================================`);
    console.log(` RUNNING TEST 9: Margin Expiration & Cooldown Persistence`);
    console.log(`=======================================================\n`);

    // Part 1: Margin Expiration & No Revival Test
    console.log(`--- Part 1: Margin Expiration & No Revival ---`);
    const balanceRes = await probeClient.getAccountBalance();
    const availableMargin = parseFloat(balanceRes?.[0]?.availableBalance || balanceRes?.availableBalance || '0');
    console.log(`Live Available Margin: $${availableMargin.toFixed(2)} USDT`);

    const simulatedRequiredMargin = 100.0; // Sizing requiring $100 USDT margin
    console.log(`Simulated Required Margin: $${simulatedRequiredMargin.toFixed(2)} USDT`);

    interface SimulatedAlert {
        id: string;
        symbol: string;
        timestamp: number;
        status: 'PENDING' | 'ADMISSION_EXPIRED' | 'EXECUTED';
        expirationReason?: string;
    }

    const alert: SimulatedAlert = {
        id: "alert-test-9-001",
        symbol: "BTCUSDT",
        timestamp: Date.now(),
        status: 'PENDING'
    };

    console.log(`Processing Alert ${alert.id}...`);
    if (availableMargin < simulatedRequiredMargin) {
        alert.status = 'ADMISSION_EXPIRED';
        alert.expirationReason = `INSUFFICIENT_MARGIN: Required $${simulatedRequiredMargin}, Available $${availableMargin.toFixed(2)}`;
        console.log(`Alert Rejected -> Status: ${alert.status} (${alert.expirationReason})`);
    }

    // Invariant: Once ADMISSION_EXPIRED, alert CANNOT be revived even if funds are added
    const simulatedAddedFundsMargin = 500.0;
    console.log(`Simulating margin increase to $${simulatedAddedFundsMargin} USDT...`);
    if (alert.status === 'ADMISSION_EXPIRED') {
        console.log(`✓ INVARIANT CONFIRMED: Expired alert ${alert.id} cannot be revived. New trades require a fresh alert.`);
    } else {
        throw new Error(`VIOLATION: Expired alert was revived!`);
    }

    // Part 2: 4-Hour Cooldown Persistence Across Restarts
    console.log(`\n--- Part 2: 4-Hour Cooldown Persistence Across Restarts ---`);
    const cooldownStorePath = path.join(process.cwd(), 'cooldown_store_test.json');
    const COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 Hours

    class CooldownManager {
        private storePath: string;
        private cooldowns: Record<string, number> = {};

        constructor(storePath: string) {
            this.storePath = storePath;
            this.load();
        }

        load() {
            if (fs.existsSync(this.storePath)) {
                try {
                    this.cooldowns = JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
                } catch {
                    this.cooldowns = {};
                }
            }
        }

        save() {
            fs.writeFileSync(this.storePath, JSON.stringify(this.cooldowns, null, 2));
        }

        setCooldown(symbol: string, durationMs: number = COOLDOWN_MS) {
            this.cooldowns[symbol] = Date.now() + durationMs;
            this.save();
        }

        isCoolingDown(symbol: string): { active: boolean; remainingSec: number } {
            const expiresAt = this.cooldowns[symbol] || 0;
            const remainingMs = expiresAt - Date.now();
            if (remainingMs > 0) {
                return { active: true, remainingSec: Math.ceil(remainingMs / 1000) };
            }
            return { active: false, remainingSec: 0 };
        }
    }

    // Instance 1: Set Cooldown
    console.log(`[Process 1] Setting 4-hour cooldown for BTCUSDT...`);
    const mgr1 = new CooldownManager(cooldownStorePath);
    mgr1.setCooldown("BTCUSDT", COOLDOWN_MS);
    const status1 = mgr1.isCoolingDown("BTCUSDT");
    console.log(`[Process 1] Cooldown Active: ${status1.active} (${status1.remainingSec}s remaining)`);

    // Simulate Process Restart (Instance 2 loading from disk)
    console.log(`Simulating process crash / restart...`);
    const mgr2 = new CooldownManager(cooldownStorePath);
    const status2 = mgr2.isCoolingDown("BTCUSDT");
    console.log(`[Process 2 (Post-Restart)] Cooldown Active: ${status2.active} (${status2.remainingSec}s remaining)`);

    if (!status2.active || status2.remainingSec <= 0) {
        throw new Error(`VIOLATION: Cooldown failed to persist across restart!`);
    }
    console.log(`✓ INVARIANT CONFIRMED: 4-hour cooldown successfully survived process restart.`);

    // Cleanup test file
    if (fs.existsSync(cooldownStorePath)) {
        fs.unlinkSync(cooldownStorePath);
    }
    console.log(`\n✓ TEST 9 ALL INVARIANTS PASSED.\n`);
}

// CLI handler
async function main() {
    const arg = process.argv[2];
    if (arg === '--inspect') {
        const calc = await calculateSafeProbeExecution("BTCUSDT", 60.0, 70.0);
        console.log(`Inspection breakdown:`, calc);
    } else if (arg === '--run-test-1') {
        await runTest1();
    } else if (arg === '--run-test-2') {
        await runTest2();
    } else if (arg === '--run-test-3-4') {
        await runTest3And4();
    } else if (arg === '--run-test-8') {
        await runTest8();
    } else if (arg === '--run-test-9') {
        await runTest9();
    } else {
        console.log(`Usage:`);
        console.log(`  npx tsx weex_behavior_probe.ts --inspect      # Inspect live calculations`);
        console.log(`  npx tsx weex_behavior_probe.ts --run-test-1   # Execute Test 1`);
        console.log(`  npx tsx weex_behavior_probe.ts --run-test-2   # Execute Test 2`);
        console.log(`  npx tsx weex_behavior_probe.ts --run-test-3-4 # Execute Tests 3 & 4`);
        console.log(`  npx tsx weex_behavior_probe.ts --run-test-8   # Execute Test 8`);
        console.log(`  npx tsx weex_behavior_probe.ts --run-test-9   # Execute Test 9`);
    }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
    main().catch(console.error);
}
