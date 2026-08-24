import { 
  IExecutionAdapter, 
  SymbolMetadata, 
  EntryOrderRequest, 
  OrderResult, 
  WholePositionProtectionRequest, 
  UpdateProtectionRequest, 
  ProtectionResult, 
  PositionState, 
  ExchangeStateSnapshot,
  OpenOrderSummary 
} from '../../../types/execution.types.js';
import { WeexRestClient } from './weex_client.js';
import { logger } from '../../../utils/logger.js';

export class WeexExecutionAdapter implements IExecutionAdapter {
  readonly exchangeName = 'WEEX_V3_CONTRACT';
  private client: WeexRestClient;

  constructor(client?: WeexRestClient) {
    this.client = client || new WeexRestClient();
  }

  async getSymbolMetadata(symbol: string): Promise<SymbolMetadata | null> {
    const res = await this.client.request('GET', '/capi/v3/market/exchangeInfo', null, true);
    const symbolsList: any[] = res.data?.symbols || res.data?.data?.symbols || [];
    const raw = symbolsList.find((s: any) => s.symbol === symbol || s.displaySymbol === symbol);

    if (!raw) {
      return null;
    }

    return {
      symbol: raw.symbol,
      pricePrecision: parseInt(raw.pricePrecision, 10),
      quantityPrecision: parseInt(raw.quantityPrecision, 10),
      contractVal: parseFloat(raw.contractVal || 1),
      minOrderSize: parseFloat(raw.minOrderSize),
      maxOrderSize: parseFloat(raw.maxOrderSize),
      maxPositionSize: parseFloat(raw.maxPositionSize),
      minLeverage: parseInt(raw.minLeverage || 1, 10),
      maxLeverage: parseInt(raw.maxLeverage || 100, 10)
    };
  }

  async getMarkPrice(symbol: string): Promise<number> {
    const res = await this.client.request('GET', `/capi/v3/market/premiumIndex?symbol=${symbol}`, null, true);
    const item = Array.isArray(res.data) ? res.data.find((i: any) => i.symbol === symbol) : res.data?.data;
    if (!item || !item.markPrice) {
      throw new Error(`Unable to fetch mark price for ${symbol} from WEEX.`);
    }
    return parseFloat(item.markPrice);
  }

  async getAvailableMargin(): Promise<number> {
    const res = await this.client.request('GET', '/capi/v3/account/balance');
    const list = Array.isArray(res.data) ? res.data : (res.data?.data || []);
    const usdtAsset = list.find((a: any) => a.asset === 'USDT');
    if (!usdtAsset) {
      return 0;
    }
    return parseFloat(usdtAsset.availableBalance || usdtAsset.balance || '0');
  }

  async setLeverage(symbol: string, leverage: number): Promise<void> {
    const res = await this.client.request('POST', '/capi/v3/account/leverage', {
      symbol,
      isolatedLongLeverage: leverage.toString(),
      isolatedShortLeverage: leverage.toString()
    });

    if (res.status !== 200) {
      throw new Error(`Failed to set leverage ${leverage}x for ${symbol}: ${JSON.stringify(res.data)}`);
    }
    logger.info({ symbol, leverage }, "WEEX leverage confirmed.");
  }

  async getActivePositions(): Promise<PositionState[]> {
    const res = await this.client.request('GET', '/capi/v3/account/position/allPosition');
    const positions: any[] = Array.isArray(res.data) ? res.data : (res.data?.data || []);
    
    return positions
      .filter((p: any) => parseFloat(p.size || p.total || '0') > 0)
      .map((pos: any) => {
        const size = String(pos.size || pos.total || '0');
        const openValue = String(pos.openValue || '0');
        const entryPrice = parseFloat(size) > 0 ? parseFloat(openValue) / parseFloat(size) : 0;
        
        return {
          symbol: pos.symbol,
          side: pos.side === 'SHORT' ? 'SHORT' : 'LONG',
          size,
          openValue,
          entryPrice,
          isolatedMargin: String(pos.isolatedMargin || pos.marginSize || '0'),
          liquidatePrice: pos.liquidatePrice,
          unrealizePnl: pos.unrealizePnl,
          // WEEX V3 usually returns protection order IDs in the position payload
          activeTpOrderId: pos.stopProfitId || pos.tpOrderId || undefined,
          activeSlOrderId: pos.stopLossId || pos.slOrderId || undefined
        };
      });
  }

  async getActivePosition(symbol: string): Promise<PositionState | null> {
    const positions = await this.getActivePositions();
    return positions.find(p => p.symbol === symbol) || null;
  }

  async submitEntryOrder(req: EntryOrderRequest): Promise<OrderResult> {
    // Ensure client order ID has mandatory 'b-' prefix
    const prefixedClientId = req.clientOrderId.startsWith('b-') ? req.clientOrderId : `b-${req.clientOrderId}`;

    const payload: any = {
      symbol: req.symbol,
      side: req.side,
      type: req.type,
      positionSide: req.positionSide,
      quantity: req.quantity,
      newClientOrderId: prefixedClientId
    };

    if (req.type === 'LIMIT') {
      if (req.price) {
        payload.price = req.price;
      }
      payload.timeInForce = 'GTC';
    }

    if (req.presetTakeProfitPrice) {
      payload.tpTriggerPrice = req.presetTakeProfitPrice;
      payload.tpWorkingType = 'MARK_PRICE';
    }

    if (req.presetStopLossPrice) {
      payload.slTriggerPrice = req.presetStopLossPrice;
      payload.slWorkingType = 'MARK_PRICE';
    }

    const res = await this.client.request('POST', '/capi/v3/order', payload);
    const data = res.data;

    if (res.status === 200 && (data?.success || data?.orderId)) {
      return {
        orderId: String(data.orderId),
        clientOrderId: prefixedClientId,
        success: true
      };
    }

    return {
      orderId: '',
      clientOrderId: prefixedClientId,
      success: false,
      errorCode: String(data?.code || res.status),
      errorMessage: String(data?.msg || data?.errorMessage || 'Order submission failed')
    };
  }

  async cancelOrder(symbol: string, orderId?: string, clientOrderId?: string): Promise<void> {
    const query = orderId ? `orderId=${orderId}` : `origClientOrderId=${clientOrderId}`;
    await this.client.request('DELETE', `/capi/v3/order?symbol=${symbol}&${query}`);
  }

  async establishWholePositionProtection(req: WholePositionProtectionRequest): Promise<ProtectionResult> {
    const prefixedAlgoId = req.clientAlgoId.startsWith('b-') ? req.clientAlgoId : `b-${req.clientAlgoId}`;

    const payload = {
      symbol: req.symbol,
      clientAlgoId: prefixedAlgoId,
      planType: req.planType,
      triggerPrice: req.triggerPrice,
      positionSide: req.positionSide,
      executePrice: '0',
      quantity: '0', // In WEEX V3, quantity: "0" creates a dynamic whole-position protection order
      triggerPriceType: 'CONTRACT_PRICE'
    };

    const res = await this.client.request('POST', '/capi/v3/placeTpSlOrder', payload);
    const item = Array.isArray(res.data) ? res.data[0] : res.data;

    if (res.status === 200 && (item?.success || item?.orderId)) {
      return {
        success: true,
        orderId: String(item.orderId)
      };
    }

    return {
      success: false,
      errorCode: String(item?.code || res.status),
      errorMessage: String(item?.msg || item?.errorMessage || 'Failed to place whole-position TP/SL')
    };
  }

  async updateWholePositionProtection(req: UpdateProtectionRequest): Promise<ProtectionResult> {
    const payload = {
      symbol: req.symbol,
      orderId: req.orderId,
      triggerPrice: req.triggerPrice,
      executePrice: '0'
    };

    const res = await this.client.request('POST', '/capi/v3/modifyTpSlOrder', payload);
    const item = Array.isArray(res.data) ? res.data[0] : res.data;

    if (res.status === 200 && (item?.success || item?.orderId)) {
      return {
        success: true,
        orderId: String(item.orderId)
      };
    }

    return {
      success: false,
      errorCode: String(item?.code || res.status),
      errorMessage: String(item?.msg || item?.errorMessage || 'Failed to modify whole-position TP/SL')
    };
  }

  async verifyProtectionOrder(symbol: string, orderId: string): Promise<OpenOrderSummary | null> {
    try {
      const res = await this.client.request('GET', `/capi/v3/order?symbol=${symbol}&orderId=${orderId}`);
      if (res.status === 200 && res.data && res.data.orderId && (res.data.status === 'NEW' || res.data.status === 'UNTRIGGERED')) {
        const o = res.data;
        return {
          orderId: String(o.orderId),
          clientOrderId: o.clientOrderId,
          type: o.type,
          side: o.side,
          positionSide: o.positionSide,
          price: String(o.price || '0'),
          origQty: String(o.origQty || '0'),
          executedQty: String(o.executedQty || '0'),
          status: o.status,
          stopPrice: o.stopPrice ? String(o.stopPrice) : undefined,
          reduceOnly: o.reduceOnly
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  async listActiveProtectionOrders(symbol: string, positionSide: string): Promise<OpenOrderSummary[]> {
    const res = await this.client.request('GET', `/capi/v3/openAlgoOrders?symbol=${symbol}`);
    const orders: any[] = res.data || [];
    
    logger.info({ rawWeexResponse: res.data }, "RAW WEEX ALGO RESPONSE");
    
    return orders
      .filter((o: any) => o.positionSide === positionSide && o.algoStatus === 'UNTRIGGERED')
      .map((o: any) => ({
        orderId: o.algoId,
        status: o.algoStatus,
        filledQuantity: o.quantity || '0',
        averagePrice: o.actualPrice || '0'
      } as any as OpenOrderSummary));
  }

  async closePositionMarket(symbol: string, positionSide: 'LONG' | 'SHORT', quantity: string): Promise<OrderResult> {
    const opposingSide = positionSide === 'LONG' ? 'SELL' : 'BUY';
    return this.submitEntryOrder({
      symbol,
      side: opposingSide,
      type: 'MARKET',
      positionSide,
      quantity,
      clientOrderId: `b-close-${Date.now()}`
    });
  }

  async fetchExchangeState(symbol: string): Promise<ExchangeStateSnapshot> {
    const now = Date.now();
    const position = await this.getActivePosition(symbol);
    const availableMargin = await this.getAvailableMargin();

    // Query standard open orders
    const openOrdersRes = await this.client.request('GET', `/capi/v3/openOrders?symbol=${symbol}`);
    const openOrdersList: any[] = Array.isArray(openOrdersRes.data) ? openOrdersRes.data : (openOrdersRes.data?.data || []);

    const openOrders: OpenOrderSummary[] = openOrdersList.map(o => ({
      orderId: String(o.orderId),
      clientOrderId: o.clientOrderId,
      type: o.type,
      side: o.side,
      positionSide: o.positionSide,
      price: String(o.price || '0'),
      origQty: String(o.origQty || '0'),
      executedQty: String(o.executedQty || '0'),
      status: o.status,
      stopPrice: o.stopPrice,
      reduceOnly: o.reduceOnly
    }));

    return {
      timestamp: now,
      symbol,
      position,
      openOrders,
      activeTpOrder: null,
      activeSlOrder: null,
      availableBalanceUsdt: availableMargin
    };
  }
}
