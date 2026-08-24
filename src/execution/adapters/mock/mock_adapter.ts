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

export class MockExecutionAdapter implements IExecutionAdapter {
  readonly exchangeName = 'MOCK_EXCHANGE';
  
  public availableMargin: number = 100.0;
  public markPrice: number = 77000.0;
  public position: PositionState | null = null;
  public openOrders: Map<string, OpenOrderSummary> = new Map();
  public activeTpOrder: OpenOrderSummary | null = null;
  public activeSlOrder: OpenOrderSummary | null = null;

  public metadata: SymbolMetadata = {
    symbol: 'BTCUSDT',
    pricePrecision: 1,
    quantityPrecision: 4,
    contractVal: 0.0001,
    minOrderSize: 0.0001,
    maxOrderSize: 1200,
    maxPositionSize: 10000,
    minLeverage: 1,
    maxLeverage: 100
  };

  async getSymbolMetadata(symbol: string): Promise<SymbolMetadata | null> {
    if (symbol === 'UNKNOWN') return null;
    return { ...this.metadata, symbol };
  }

  async getMarkPrice(_symbol: string): Promise<number> {
    return this.markPrice;
  }

  async getAvailableMargin(): Promise<number> {
    return this.availableMargin;
  }

  async setLeverage(_symbol: string, _leverage: number): Promise<void> {}

  async getActivePositions(): Promise<PositionState[]> {
    return this.position ? [this.position] : [];
  }

  async getActivePosition(_symbol: string): Promise<PositionState | null> {
    return this.position && this.position.symbol === _symbol ? this.position : null;
  }

  async submitEntryOrder(req: EntryOrderRequest): Promise<OrderResult> {
    const orderId = `mock_ord_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    
    if (req.type === 'MARKET') {
      const sizeNum = parseFloat(req.quantity);
      if (this.position) {
        // Expand position
        const currentSize = parseFloat(this.position.size);
        const currentOpenVal = parseFloat(this.position.openValue);
        const addedOpenVal = sizeNum * this.markPrice;
        const newSize = currentSize + sizeNum;
        const newOpenVal = currentOpenVal + addedOpenVal;

        this.position = {
          symbol: req.symbol,
          side: req.positionSide,
          size: newSize.toFixed(4),
          openValue: newOpenVal.toFixed(2),
          entryPrice: newOpenVal / newSize,
          isolatedMargin: (newOpenVal / 5).toFixed(2)
        };
      } else {
        // New position
        const openVal = sizeNum * this.markPrice;
        this.position = {
          symbol: req.symbol,
          side: req.positionSide,
          size: req.quantity,
          openValue: openVal.toFixed(2),
          entryPrice: this.markPrice,
          isolatedMargin: (openVal / 5).toFixed(2)
        };
      }
    } else {
      // LIMIT order
      this.openOrders.set(orderId, {
        orderId,
        clientOrderId: req.clientOrderId,
        type: 'LIMIT',
        side: req.side,
        positionSide: req.positionSide,
        price: req.price || '0',
        origQty: req.quantity,
        executedQty: '0',
        status: 'NEW'
      });
    }

    return {
      orderId,
      clientOrderId: req.clientOrderId,
      success: true
    };
  }

  async cancelOrder(_symbol: string, orderId?: string): Promise<void> {
    if (orderId) {
      this.openOrders.delete(orderId);
    }
  }

  async establishWholePositionProtection(req: WholePositionProtectionRequest): Promise<ProtectionResult> {
    const orderId = `mock_prot_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const summary: OpenOrderSummary = {
      orderId,
      clientOrderId: req.clientAlgoId,
      type: req.planType === 'TAKE_PROFIT' ? 'TAKE_PROFIT_MARKET' : 'STOP_MARKET',
      side: req.positionSide === 'LONG' ? 'SELL' : 'BUY',
      positionSide: req.positionSide,
      price: '0',
      origQty: '0.0000',
      executedQty: '0',
      status: 'NEW',
      stopPrice: req.triggerPrice,
      reduceOnly: true
    };

    if (req.planType === 'TAKE_PROFIT') {
      this.activeTpOrder = summary;
    } else {
      this.activeSlOrder = summary;
    }

    return { success: true, orderId };
  }

  async updateWholePositionProtection(req: UpdateProtectionRequest): Promise<ProtectionResult> {
    if (this.activeTpOrder && this.activeTpOrder.orderId === req.orderId) {
      this.activeTpOrder.stopPrice = req.triggerPrice;
      return { success: true, orderId: req.orderId };
    }
    if (this.activeSlOrder && this.activeSlOrder.orderId === req.orderId) {
      this.activeSlOrder.stopPrice = req.triggerPrice;
      return { success: true, orderId: req.orderId };
    }
    return { success: false, errorMessage: 'Order not found' };
  }

  async verifyProtectionOrder(_symbol: string, orderId: string): Promise<OpenOrderSummary | null> {
    if (this.activeTpOrder && this.activeTpOrder.orderId === orderId && this.activeTpOrder.status === 'NEW') {
      return this.activeTpOrder;
    }
    if (this.activeSlOrder && this.activeSlOrder.orderId === orderId && this.activeSlOrder.status === 'NEW') {
      return this.activeSlOrder;
    }
    return null;
  }

  async listActiveProtectionOrders(symbol: string, positionSide: string): Promise<OpenOrderSummary[]> {
    const result: OpenOrderSummary[] = [];
    if (this.activeTpOrder && this.activeTpOrder.positionSide === positionSide) result.push(this.activeTpOrder);
    if (this.activeSlOrder && this.activeSlOrder.positionSide === positionSide) result.push(this.activeSlOrder);
    return result;
  }

  async closePositionMarket(_symbol: string, _positionSide: 'LONG' | 'SHORT', _quantity: string): Promise<OrderResult> {
    this.position = null;
    this.activeTpOrder = null;
    this.activeSlOrder = null;
    return { orderId: `mock_close_${Date.now()}`, success: true };
  }

  async fetchExchangeState(symbol: string): Promise<ExchangeStateSnapshot> {
    return {
      timestamp: Date.now(),
      symbol,
      position: this.position,
      openOrders: Array.from(this.openOrders.values()),
      activeTpOrder: this.activeTpOrder,
      activeSlOrder: this.activeSlOrder,
      availableBalanceUsdt: this.availableMargin
    };
  }
}
